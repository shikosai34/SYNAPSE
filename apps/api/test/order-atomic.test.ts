import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { circle, event, eventUser, menu, order, preOrder, type WorkerEnv } from "@fesflow/db";
import { commitOrder, jstOrderDay, orderCommand, type CommitOrderInput } from "../src/services/order-commit";
import { updateOrderStatus } from "../src/services/order-status";
import { postJson, testDb, uid } from "./helpers";

const headers = { "User-Agent": "OpenAI File Downloader, XaiImageApiFetch/1.0" };
async function seed(stock = 100, inventoryEnabled = true) {
  const db = testDb();
  const eventId = uid("ev"), circleId = uid("same-prefix"), menuId = uid("menu"), userId = uid("visitor");
  await db.insert(event).values({ id: eventId, eventName: "Atomic order fixture" });
  await db.insert(circle).values({ id: circleId, eventId, name: "Fixture" });
  await db.insert(eventUser).values({ id: userId, eventId, displayId: 1 });
  await db.insert(menu).values({ id: menuId, circleId, name: "Item", price: 300, imagePath: "", inventoryEnabled, stockQuantity: stock });
  const input: CommitOrderInput = { id: uid("order"), circleId, userId, peopleCount: 1, totalPrice: 300,
    status: "pending", items: [{ menuId, menuName: "Item", menuPrice: 300, quantity: 1, inventoryEnabled: true, toppings: [] }] };
  const body = { circleId, userId, items: [{ menuId, quantity: 1 }] };
  return { eventId, circleId, menuId, userId, input, body };
}
async function count(sql: string, value: string) {
  return env.DB.prepare(sql).bind(value).first<number>("value");
}

// 2026-10-03: 監査で20並行中19件が500だったケースを、実Worker/D1の回帰テストとして固定する。
describe("atomic order commits", () => {
  it.each([
    ["2026-10-02T14:59:59.999Z", "20261002", "2026-10-01T15:00:00.000Z"],
    ["2026-10-02T15:00:00.000Z", "20261003", "2026-10-02T15:00:00.000Z"],
  ])("uses JST business-day boundary for %s", (instant, expectedDay, expectedStart) => {
    const result = jstOrderDay(Date.parse(instant));
    expect(result.day).toBe(expectedDay);
    expect(result.dayStart).toBe(Date.parse(expectedStart));
  });

  it("20 concurrent requests in one circle all succeed with unique numbers", async () => {
    const fixture = await seed();
    const responses = await Promise.all(Array.from({ length: 20 }, () => postJson("/api/orders", fixture.body, headers)));
    expect(responses.map(r => r.status)).toEqual(Array(20).fill(201));
    const bodies = await Promise.all(responses.map(r => r.json() as Promise<{ orderNumber: string }>));
    expect(new Set(bodies.map(b => b.orderNumber)).size).toBe(20);
    expect(await count("SELECT stock_quantity AS value FROM menu WHERE id=?", fixture.menuId)).toBe(80);
  });

  // 2026-10-03 (#81): 店舗内連番なので、同じ短い表示番号でも店舗が違えば衝突ではない。
  it("two circles can use the same daily display number while retaining distinct ULIDs", async () => {
    const fixtures = await Promise.all([seed(), seed()]);
    const responses = await Promise.all(fixtures.map(f => postJson("/api/orders", f.body, headers)));
    expect(responses.map(r => r.status)).toEqual([201, 201]);
    const bodies = await Promise.all(responses.map(r => r.json() as Promise<{ id: string; orderNumber: string }>));
    expect(bodies[0]!.orderNumber).toBe(bodies[1]!.orderNumber);
    expect(bodies[0]!.id).not.toBe(bodies[1]!.id);
  });

  it("continues from the highest legacy number on the first write of the day", async () => {
    const f = await seed();
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
    const legacyPrefix = `${f.circleId.slice(0, 4)}-${today.slice(4)}-`;
    await testDb().insert(order).values({
      id: uid("prior-year-order"), circleId: f.circleId, orderNumber: `${legacyPrefix}099`,
      peopleCount: 1, totalPrice: 300,
      createdAt: new Date(`${Number(today.slice(0, 4)) - 1}-${today.slice(4, 6)}-${today.slice(6)}T12:00:00+09:00`),
    });
    await testDb().insert(order).values({
      id: uid("legacy-order"), circleId: f.circleId, orderNumber: `${legacyPrefix}007`,
      peopleCount: 1, totalPrice: 300,
    });

    const response = await postJson("/api/orders", f.body, headers);
    expect(response.status).toBe(201);
    expect(await response.json()).toHaveProperty("orderNumber", `${f.circleId.slice(0, 4)}-${today}-008`);
  });

  // 2026-10-04 (#81): 取消後も履歴を残し、同じ店舗・営業日の表示番号を再利用しない。
  it("does not reuse a number after an order is cancelled", async () => {
    const f = await seed();
    const firstResponse = await postJson("/api/orders", f.body, headers);
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as { id: string; orderNumber: string };
    expect(await updateOrderStatus(env.DB, { orderId: first.id, expectedStatus: "pending", nextStatus: "cancelled" })).toBe(true);

    const secondResponse = await postJson("/api/orders", f.body, headers);
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as { orderNumber: string };
    expect(second.orderNumber).toBe(`${f.circleId.slice(0, 4)}-${jstOrderDay(Date.now()).day}-002`);
    expect(await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(first.id).first("status")).toBe("cancelled");
  });

  // 2026-10-03: 在庫管理を無効にした商品は注文時に残数を書き換えない。
  it("does not change stock for a menu without inventory management", async () => {
    const f = await seed(7, false);
    const response = await postJson("/api/orders", f.body, headers);
    expect(response.status).toBe(201);
    expect(await count("SELECT stock_quantity AS value FROM menu WHERE id=?", f.menuId)).toBe(7);
  });

  it("concurrent retries return one saved result and changed content conflicts", async () => {
    const f = await seed(1);
    const requestHeaders = { ...headers, "Idempotency-Key": crypto.randomUUID() };
    const responses = await Promise.all(Array.from({ length: 20 }, () => postJson("/api/orders", f.body, requestHeaders)));
    expect(responses.map(r => r.status)).toEqual(Array(20).fill(201));
    const bodies = await Promise.all(responses.map(r => r.json()));
    expect(new Set(bodies.map(b => JSON.stringify(b))).size).toBe(1);
    expect(await count("SELECT count(*) AS value FROM orders WHERE circle_id=?", f.circleId)).toBe(1);
    expect(await count("SELECT stock_quantity AS value FROM menu WHERE id=?", f.menuId)).toBe(0);
    // 2026-10-03: 保存済み再送は現在のBAN状態より優先し、初回成功の結果を再現する。
    await env.DB.prepare("UPDATE event_user SET status='banned' WHERE id=?").bind(f.userId).run();
    expect((await postJson("/api/orders", f.body, requestHeaders)).status).toBe(201);
    expect((await postJson("/api/orders", { ...f.body, peopleCount: 2 }, requestHeaders)).status).toBe(409);
  });

  it("competing independent orders cannot sell more than available stock", async () => {
    const f = await seed(5);
    const responses = await Promise.all(Array.from({ length: 20 }, () => postJson("/api/orders", f.body, headers)));
    expect(responses.filter(r => r.status === 201)).toHaveLength(5);
    expect(responses.filter(r => r.status === 400)).toHaveLength(15);
    expect(await count("SELECT stock_quantity AS value FROM menu WHERE id=?", f.menuId)).toBe(0);
  });

  // 2026-10-03: 状態更新の一括化でも競合時の上書きと重複スタンプが起きないことを固定する。
  it("updates status and awards a stamp once in one conditional batch", async () => {
    const fixture = await seed();
    const response = await postJson("/api/orders", fixture.body, headers);
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string };

    const updates = await Promise.all(Array.from({ length: 20 }, () => updateOrderStatus(env.DB, {
      orderId: created.id,
      expectedStatus: "pending",
      nextStatus: "preparing",
      stamp: { id: uid("stamp"), userId: fixture.userId, circleId: fixture.circleId },
    })));

    expect(updates.filter(Boolean)).toHaveLength(1);
    expect(await env.DB.prepare("SELECT status AS value FROM orders WHERE id=?").bind(created.id).first("value"))
      .toBe("preparing");
    expect(await count("SELECT count(*) AS value FROM user_stamp WHERE circle_id=?", fixture.circleId))
      .toBe(1);
  });

  it("claim is exactly once including stamp and stock, even across concurrent commits", async () => {
    const f = await seed();
    const preOrderId = uid("pre");
    await testDb().insert(preOrder).values({ id: preOrderId, circleId: f.circleId, userId: f.userId, totalPrice: 300 });
    const command = await orderCommand(`claim:${preOrderId}`, preOrderId, { preOrderId });
    const results = await Promise.all(Array.from({ length: 20 }, () => commitOrder(env.DB, command, {
      ...f.input, id: uid("order"), status: "preparing", preOrderId,
    })));
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    expect(await count("SELECT stock_quantity AS value FROM menu WHERE id=?", f.menuId)).toBe(99);
    expect(await count("SELECT count(*) AS value FROM user_stamp WHERE circle_id=?", f.circleId)).toBe(1);
    expect(await env.DB.prepare("SELECT status FROM pre_order WHERE id=?").bind(preOrderId).first("status")).toBe("completed");
  });

  it.each([2, 3, 5, 7])("SQL failure after batch step %i rolls back stock, order, items and claim", async (step) => {
    const f = await seed();
    const preOrderId = uid("pre");
    await testDb().insert(preOrder).values({ id: preOrderId, circleId: f.circleId, userId: f.userId, totalPrice: 300 });
    const failingDb = {
      prepare: env.DB.prepare.bind(env.DB),
      batch: (statements: Parameters<WorkerEnv["DB"]["batch"]>[0]) => env.DB.batch([
        ...statements.slice(0, step + 1),
        env.DB.prepare("INSERT INTO order_write_guard(id,valid) VALUES (?,0)").bind(uid("failure")),
        ...statements.slice(step + 1),
      ]),
    } as WorkerEnv["DB"];
    const command = await orderCommand("failure", uid("key"), f.body);
    const input = { ...f.input, status: "preparing" as const, preOrderId };
    await expect(commitOrder(failingDb, command, input)).rejects.toThrow();
    expect(await count("SELECT count(*) AS value FROM orders WHERE circle_id=?", f.circleId)).toBe(0);
    expect(await count("SELECT stock_quantity AS value FROM menu WHERE id=?", f.menuId)).toBe(100);
    expect(await count("SELECT count(*) AS value FROM user_stamp WHERE circle_id=?", f.circleId)).toBe(0);
    expect(await env.DB.prepare("SELECT status FROM pre_order WHERE id=?").bind(preOrderId).first("status")).toBe("pending");
    // rollback後に同じキーで再試行でき、部分的な冪等レコードも残らない。
    await expect(commitOrder(env.DB, command, input)).resolves.toHaveProperty("id", f.input.id);
  });
});

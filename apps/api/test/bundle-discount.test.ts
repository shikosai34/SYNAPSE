// 2026-10-23: セット割引 (N個で○円) の自動適用が、注文確定額と適用履歴に反映されることを守る。
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bundleDiscount, bundleDiscountMenu, circle, event, eventUser, menu, order, orderBundleDiscount } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

const USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0";

async function seed() {
  const db = testDb();
  const eventId = uid("bundle-event");
  const circleId = uid("bundle-circle");
  const userId = uid("bundle-visitor");
  const menuA = uid("bundle-menu-a");
  const menuB = uid("bundle-menu-b");
  const menuOther = uid("bundle-menu-other");
  await db.insert(event).values({ id: eventId, eventName: "セット割引テスト" });
  await db.insert(circle).values({ id: circleId, eventId, name: "セット割引店", settings: JSON.stringify({ mobileOrderEnabled: true }) });
  await db.insert(eventUser).values({ id: userId, eventId, displayId: 1 });
  await db.insert(menu).values([
    { id: menuA, circleId, name: "たこ焼き(ソース)", price: 400, imagePath: "" },
    { id: menuB, circleId, name: "たこ焼き(塩)", price: 400, imagePath: "" },
    { id: menuOther, circleId, name: "ドリンク", price: 150, imagePath: "" },
  ]);
  const bundleId = uid("bundle");
  await db.insert(bundleDiscount).values({ id: bundleId, circleId, title: "3個セット", kind: "set_price", bundleSize: 3, value: 1000 });
  await db.insert(bundleDiscountMenu).values([{ bundleId, menuId: menuA }, { bundleId, menuId: menuB }]);
  return { db, circleId, userId, menuA, menuB, menuOther, bundleId };
}

function mobileOrder(f: Awaited<ReturnType<typeof seed>>, items: { menuId: string; quantity: number }[], extra: object = {}) {
  return postJson("/api/orders/mobile", { circleId: f.circleId, userId: f.userId, peopleCount: 1, items, ...extra }, {
    "User-Agent": USER_AGENT,
    "Idempotency-Key": uid("bundle-key"),
  });
}

describe("セット割引の自動適用", () => {
  it("複数メニューの合算でセットが成立し、差額が引かれて履歴が残る", async () => {
    const f = await seed();
    const res = await mobileOrder(f, [
      { menuId: f.menuA, quantity: 2 },
      { menuId: f.menuB, quantity: 1 },
      { menuId: f.menuOther, quantity: 1 },
    ], { expectedTotalPrice: 1150 });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    // 通常 1200+150=1350 → 3個セット1000 + ドリンク150
    expect((await f.db.select().from(order).where(eq(order.id, id)))[0]!.totalPrice).toBe(1150);
    const rows = await f.db.select().from(orderBundleDiscount).where(eq(orderBundleDiscount.orderId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bundleId: f.bundleId, sets: 1, discountApplied: 200 });
  });

  it("個数が足りなければ割引せず、画面の想定額とずれたら 409", async () => {
    const f = await seed();
    const short = await mobileOrder(f, [{ menuId: f.menuA, quantity: 2 }], { expectedTotalPrice: 800 });
    expect(short.status).toBe(201);
    const stale = await mobileOrder(f, [{ menuId: f.menuA, quantity: 3 }], { expectedTotalPrice: 1200 });
    expect(stale.status).toBe(409);
  });

  it("無効化したセット割引は適用されない", async () => {
    const f = await seed();
    await f.db.update(bundleDiscount).set({ status: "disabled" }).where(eq(bundleDiscount.id, f.bundleId));
    const res = await mobileOrder(f, [{ menuId: f.menuA, quantity: 3 }], { expectedTotalPrice: 1200 });
    expect(res.status).toBe(201);
  });

  it("来場者向けの有効一覧は認証なしで取れ、管理用の一覧と作成は権限が必要", async () => {
    const f = await seed();
    const active = await request(`/api/discounts/circle/${f.circleId}/bundles/active`, { headers: { "User-Agent": USER_AGENT } });
    expect(active.status).toBe(200);
    expect(await active.json()).toEqual([
      { id: f.bundleId, title: "3個セット", kind: "set_price", bundleSize: 3, value: 1000, menuIds: expect.arrayContaining([f.menuA, f.menuB]) },
    ]);
    const list = await request(`/api/discounts/circle/${f.circleId}/bundles`, { headers: { "User-Agent": USER_AGENT } });
    expect(list.status).toBe(403);
    const create = await postJson(`/api/discounts/circle/${f.circleId}/bundles`,
      { title: "x", kind: "amount_off", bundleSize: 2, value: 100, menuIds: [f.menuA] }, { "User-Agent": USER_AGENT });
    expect(create.status).toBe(403);
  });

  it("事前注文の下書きにも自動適用され、保存額がセット割引後の金額になる", async () => {
    const f = await seed();
    const res = await postJson("/api/pre-orders", {
      userId: f.userId,
      circleId: f.circleId,
      draftId: uid("draft"),
      expectedUpdatedAt: null,
      items: [{ menuId: f.menuA, quantity: 2 }, { menuId: f.menuB, quantity: 1 }, { menuId: f.menuOther, quantity: 1 }],
    });
    expect(res.status).toBe(201);
    // 通常 1350 → 3個セット1000 + ドリンク150。受取 (claim) はこの保存額をそのまま請求する。
    expect((await res.json() as { totalPrice: number }).totalPrice).toBe(1150);
  });

  it("1個分割引・全体%引きも注文確定額に反映される", async () => {
    const f = await seed();
    await f.db.update(bundleDiscount).set({ status: "disabled" }).where(eq(bundleDiscount.id, f.bundleId));
    const freeId = uid("bundle-free");
    const percentId = uid("bundle-percent");
    await f.db.insert(bundleDiscount).values([
      { id: freeId, circleId: f.circleId, title: "3個で1個無料", kind: "free_cheapest", bundleSize: 3, value: 0 },
      { id: percentId, circleId: f.circleId, title: "ドリンク2個で10%", kind: "percent_off", bundleSize: 2, value: 10 },
    ]);
    await f.db.insert(bundleDiscountMenu).values([
      { bundleId: freeId, menuId: f.menuA }, { bundleId: freeId, menuId: f.menuB },
      { bundleId: percentId, menuId: f.menuOther },
    ]);
    // 通常 1200+300=1500。1個無料 -400 → 1100、その10% = 110 引き → 990
    const res = await mobileOrder(f, [{ menuId: f.menuA, quantity: 3 }, { menuId: f.menuOther, quantity: 2 }], { expectedTotalPrice: 990 });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const rows = await f.db.select().from(orderBundleDiscount).where(eq(orderBundleDiscount.orderId, id));
    expect(rows.map((row) => [row.bundleId, row.discountApplied]).sort()).toEqual([[freeId, 400], [percentId, 110]].sort());
  });

  it("割引の種類に合わない値の作成は弾く (権限より前に検証される入力)", async () => {
    const f = await seed();
    const res = await postJson(`/api/discounts/circle/${f.circleId}/bundles`,
      { title: "x", kind: "percent_off", bundleSize: 2, value: 150, menuIds: [f.menuA] }, { "User-Agent": USER_AGENT });
    expect(res.status).toBe(400);
  });
});

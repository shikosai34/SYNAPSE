// 2026-11-04: 未発行注文は双方の明示許可だけに限定し、発行必須の既定と既存の保護を回帰検証する。
import { describe, expect, it } from "vitest";
import { circle, event, eventUser, membership, menu, wristband } from "@fesflow/db";
import { eq } from "drizzle-orm";
import { postJson, request, testDb, uid } from "./helpers";

async function seed(eventAllows = false, circleAllows = false) {
  const db = testDb();
  const eventId = uid("ev");
  const circleId = uid("ci");
  const menuId = uid("menu");
  // 2026-11-04: 設定の依存関係を検証するため、既存サークルによるプラン上限の拒否を避ける。
  await db.insert(event).values({ id: eventId, eventName: eventId, maxCircles: 10, allowWristbandlessOrder: eventAllows });
  await db.insert(circle).values({ id: circleId, eventId, name: circleId,
    settings: JSON.stringify({ preOrderEnabled: true, allowWristbandlessOrder: circleAllows, preserved: "保持する" }) });
  await db.insert(menu).values({ id: menuId, circleId, name: "商品", price: 100, imagePath: "test.png" });
  return { db, eventId, circleId, menuId };
}

function draft(circleId: string, menuId: string, userId = uid("visitor")) {
  return postJson("/api/pre-orders", { userId, circleId, draftId: uid("draft"), expectedUpdatedAt: null,
    items: [{ menuId, quantity: 1 }] });
}

async function manager(eventId: string) {
  const email = `${uid("manager")}@example.com`;
  const res = await postJson("/api/auth/sign-up/email", { email, password: "correct-horse-battery-staple", name: "運営" });
  expect(res.status).toBeLessThan(400);
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  const cookie = raw.map((value) => value.split(";")[0]).join("; ");
  // 2026-11-04: 権限判定は明示された所属だけを使うため、作成した所属IDを各リクエストで送る。
  const membershipId = uid("membership");
  await testDb().insert(membership).values({ id: membershipId, eventId, userEmail: email,
    userName: "運営", role: "event_manager", isActive: true });
  return (path: string, method: string, body: unknown) => request(path, {
    method, headers: { Cookie: cookie, "X-Active-Membership-Id": membershipId, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("リストバンドなし注文", () => {
  it.each([[false, false], [true, false], [false, true]])("イベント%s・サークル%sでは未発行注文を拒否する", async (eventAllows, circleAllows) => {
    const { db, circleId, menuId } = await seed(eventAllows, circleAllows);
    const userId = uid("not-issued");
    expect((await draft(circleId, menuId, userId)).status).toBe(403);
    expect(await db.select().from(eventUser).where(eq(eventUser.id, userId))).toHaveLength(0);
  });

  it("双方許可時だけ来場者を採番し、バンドや入場完了を作成せず注文を保存する", async () => {
    const { db, eventId, circleId, menuId } = await seed(true, true);
    await db.insert(eventUser).values({ id: uid("existing"), eventId, displayId: 42 });
    const userId = uid("not-issued");
    expect((await draft(circleId, menuId, userId)).status).toBe(201);
    const [created] = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    expect(created).toMatchObject({ eventId, displayId: 43, status: "available", onboardedAt: null });
    expect(await db.select().from(wristband).where(eq(wristband.userId, userId))).toHaveLength(0);
    expect((await draft(circleId, menuId, uid("second"))).status).toBe(201);
    expect((await db.select().from(eventUser).where(eq(eventUser.eventId, eventId))).map((u) => u.displayId).sort()).toEqual([42, 43, 44]);
  });

  it("双方許可でもBANと別イベントの既存IDは拒否する", async () => {
    const { db, eventId, circleId, menuId } = await seed(true, true);
    const bannedId = uid("banned");
    await db.insert(eventUser).values({ id: bannedId, eventId, displayId: 1, status: "banned" });
    expect((await draft(circleId, menuId, bannedId)).status).toBe(403);
    const other = await seed(true, true);
    expect((await draft(other.circleId, other.menuId, bannedId)).status).toBe(403);
    const otherId = uid("other");
    await db.insert(eventUser).values({ id: otherId, eventId: other.eventId, displayId: 1 });
    expect((await draft(circleId, menuId, otherId)).status).toBe(400);
  });

  it("イベント不許可では作成・設定ONを理由付きで拒否する", async () => {
    const { circleId, eventId } = await seed();
    const call = await manager(eventId);
    for (const [path, method, body] of [
      ["/api/circles", "POST", { eventId, name: uid("new"), settings: { allowWristbandlessOrder: true } }],
      [`/api/circles/${circleId}/settings`, "PATCH", { settings: { allowWristbandlessOrder: true } }],
    ] as const) {
      const res = await call(path, method, body);
      expect(res.status).toBe(400);
      expect((await res.json() as { message: string }).message).toContain("イベント側で許可されていない");
    }
    expect((await call(`/api/circles/${circleId}/settings`, "PATCH", { settings: { allowWristbandlessOrder: "true" } })).status).toBe(400);
  });

  it("イベントOFFで全サークルをOFFへ戻し、他設定を保持して再ONでも復活させない", async () => {
    const { db, eventId, circleId } = await seed(true, true);
    const secondId = uid("second-circle");
    await db.insert(circle).values({ id: secondId, eventId, name: secondId,
      settings: JSON.stringify({ allowWristbandlessOrder: true, allowUnregisteredWristbandOrder: true }) });
    const other = await seed(true, true);
    const call = await manager(eventId);
    expect((await call(`/api/festivals/${eventId}/theme`, "PUT", { allowWristbandlessOrder: false })).status).toBe(200);
    const rows = await db.select().from(circle).where(eq(circle.eventId, eventId));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(JSON.parse(row.settings!).allowWristbandlessOrder).toBe(false);
    expect(JSON.parse(rows.find((row) => row.id === circleId)!.settings!).preserved).toBe("保持する");
    expect(JSON.parse(rows.find((row) => row.id === secondId)!.settings!).allowUnregisteredWristbandOrder).toBe(true);
    expect(JSON.parse((await db.select().from(circle).where(eq(circle.id, other.circleId)))[0]!.settings!).allowWristbandlessOrder).toBe(true);
    expect((await call(`/api/festivals/${eventId}/theme`, "PUT", { allowWristbandlessOrder: true })).status).toBe(200);
    expect(JSON.parse((await db.select().from(circle).where(eq(circle.id, circleId)))[0]!.settings!).allowWristbandlessOrder).toBe(false);
    expect((await call(`/api/circles/${circleId}/settings`, "PATCH", { settings: { allowWristbandlessOrder: true } })).status).toBe(200);
    // 2026-11-04: 作成時の許可ONも保存し、旧クライアントからのキー省略はfalseにする。
    for (const allow of [true, undefined]) {
      const created = await call("/api/circles", "POST", { eventId, name: uid("new-circle"), settings: { allowWristbandlessOrder: allow } });
      expect(created.status).toBe(201);
      const { id } = await created.json() as { id: string };
      expect(JSON.parse((await db.select().from(circle).where(eq(circle.id, id)))[0]!.settings!).allowWristbandlessOrder).toBe(allow ?? false);
    }
  });
});

/**
 * 2026-11-01: イベント終了後の個人属性削除は、注文・来場者年代集計の保存に成功した場合に限る。
 * 既存の全テーブルを実D1と同じテストWorkerで使い、再実行と権限境界も固定する。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { circle, event, eventUser, membership, order, wristband } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

function cookieOf(res: Response): string {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function signUp(prefix: string) {
  const response = await postJson("/api/auth/sign-up/email", {
    email: `${uid(prefix)}@example.com`,
    password: "correct-horse-battery-staple",
    name: prefix,
  });
  expect(response.status).toBeLessThan(400);
  return cookieOf(response);
}

describe("イベント終了後の来場者属性削除", () => {
  it("保存済みの年代別統計と注文年代を残し、全バンド・アカウントの年代とニックネームを消す", async () => {
    const cookie = await signUp("privacy-owner");
    const ev = await postJson("/api/festivals", { eventName: uid("情報消去祭") }, { Cookie: cookie });
    expect(ev.status).toBeLessThan(400);
    const { id: eventId } = await ev.json() as { id: string };
    const db = testDb();
    const [ownerRole] = await db.select().from(membership)
      .where(and(eq(membership.eventId, eventId), eq(membership.role, "event_manager")));
    const headers = { Cookie: cookie, "X-Active-Membership-Id": ownerRole!.id };
    const circleId = uid("circle");
    const ownerId = uid("owner");
    const singleId = uid("single");
    const pendingId = uid("pending");
    const onboardedAt = new Date("2026-10-24T00:00:00.000Z");

    await db.insert(circle).values({ id: circleId, eventId, name: "模擬店" });
    await db.insert(eventUser).values([
      { id: ownerId, eventId, displayId: 1, nickname: "代表者", ageGroup: "10s", onboardedAt },
      { id: singleId, eventId, displayId: 2, nickname: "単独", ageGroup: "40s", onboardedAt },
      { id: pendingId, eventId, displayId: 3, nickname: "未入場", ageGroup: "50s" },
    ]);
    await db.insert(wristband).values([
      { id: uid("wb-primary"), userId: ownerId, nickname: "代表バンド", ageGroup: "10s", status: "active" },
      { id: uid("wb-family"), userId: ownerId, nickname: "家族", ageGroup: "30s", status: "smartphone" },
      { id: uid("wb-pending"), userId: pendingId, nickname: "未入場バンド", ageGroup: "50s", status: "active" },
    ]);
    const orderIds = [uid("o1"), uid("o2")];
    await db.insert(order).values([
      { id: orderIds[0], userId: ownerId, circleId, orderNumber: uid("n1"), peopleCount: 1, totalPrice: 150 },
      { id: orderIds[1], userId: singleId, circleId, orderNumber: uid("n2"), peopleCount: 1, totalPrice: 200 },
    ]);
    await db.update(event).set({ lifecycleStatus: "ended" }).where(eq(event.id, eventId));

    const beforeResponse = await request(`/api/festivals/${eventId}/analytics`, { headers });
    expect(beforeResponse.status).toBe(200);
    const before = await beforeResponse.json() as { ageBuckets: { label: string; count: number }[]; totals: { visitorProfiles: number } };
    expect(before.totals.visitorProfiles).toBe(3);
    expect(before.ageBuckets).toEqual(expect.arrayContaining([
      { label: "10代", count: 1 }, { label: "30代", count: 1 }, { label: "40代", count: 1 },
    ]));

    const response = await request(`/api/festivals/${eventId}/scrub-visitor-profiles`, { method: "POST", headers });
    expect(response.status).toBe(200);
    const result = await response.json() as { alreadyScrubbed: boolean; ordersBackfilled: number };
    expect(result.alreadyScrubbed).toBe(false);
    expect(result.ordersBackfilled).toBe(2);

    const users = await db.select({ ageGroup: eventUser.ageGroup, nickname: eventUser.nickname })
      .from(eventUser).where(eq(eventUser.eventId, eventId));
    expect(users.every((user) => user.ageGroup === null && user.nickname === null)).toBe(true);
    const bands = await db.select({ ageGroup: wristband.ageGroup, nickname: wristband.nickname })
      .from(wristband).where(eq(wristband.userId, ownerId));
    expect(bands.every((band) => band.ageGroup === null && band.nickname === null)).toBe(true);
    const firstOrder = await db.select({ ageGroup: order.ageGroup }).from(order).where(eq(order.id, orderIds[0]!));
    const secondOrder = await db.select({ ageGroup: order.ageGroup }).from(order).where(eq(order.id, orderIds[1]!));
    expect(firstOrder[0]!.ageGroup).toBe("10s");
    expect(secondOrder[0]!.ageGroup).toBe("40s");

    const afterResponse = await request(`/api/festivals/${eventId}/analytics`, { headers });
    expect(afterResponse.status).toBe(200);
    const after = await afterResponse.json() as typeof before;
    expect(after.totals.visitorProfiles).toBe(before.totals.visitorProfiles);
    expect(after.ageBuckets).toEqual(before.ageBuckets);

    const retry = await request(`/api/festivals/${eventId}/scrub-visitor-profiles`, { method: "POST", headers });
    expect(retry.status).toBe(200);
    expect((await retry.json() as { alreadyScrubbed: boolean }).alreadyScrubbed).toBe(true);
    const reopen = await request(`/api/festivals/${eventId}/lifecycle-status`, {
      method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "live" }),
    });
    expect(reopen.status).toBe(409);
    const reRegister = await postJson("/api/wristbands/onboard", { userId: ownerId, nickname: "再登録", ageGroup: "20s" });
    expect(reRegister.status).toBe(409);
    const outsider = await signUp("privacy-outsider");
    const forbidden = await request(`/api/festivals/${eventId}/scrub-visitor-profiles`, { method: "POST", headers: { Cookie: outsider } });
    expect(forbidden.status).toBe(403);
  });

  it("開催中には個人属性の削除を拒否する", async () => {
    const cookie = await signUp("privacy-live");
    const ev = await postJson("/api/festivals", { eventName: uid("開催中祭") }, { Cookie: cookie });
    expect(ev.status).toBeLessThan(400);
    const { id: eventId } = await ev.json() as { id: string };
    const [role] = await testDb().select().from(membership)
      .where(and(eq(membership.eventId, eventId), eq(membership.role, "event_manager")));
    const result = await request(`/api/festivals/${eventId}/scrub-visitor-profiles`, {
      method: "POST", headers: { Cookie: cookie, "X-Active-Membership-Id": role!.id },
    });
    expect(result.status).toBe(409);
    const [state] = await testDb().select({ scrubbedAt: event.privacyScrubbedAt })
      .from(event).where(eq(event.id, eventId));
    expect(state!.scrubbedAt).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circle, circleVisit, event, eventUser, order, review, wristband } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

async function seedReviewData() {
  const db = testDb();
  const eventId = uid("ev");
  const otherEventId = uid("ev");
  const circleId = uid("ci");
  const otherCircleId = uid("ci");
  const foreignCircleId = uid("ci");
  const visitCircleId = uid("ci");
  const userId = uid("usr");
  const otherReviewerId = uid("usr");
  const bannedUserId = uid("usr");
  await db.insert(event).values([{ id: eventId, eventName: "レビュー祭" }, { id: otherEventId, eventName: "別の祭" }]);
  await db.insert(circle).values([
    { id: circleId, eventId, name: "利用済みサークル" },
    { id: otherCircleId, eventId, name: "未利用サークル" },
    { id: foreignCircleId, eventId: otherEventId, name: "別イベントの店" },
    { id: visitCircleId, eventId, name: "体験記録サークル" },
  ]);
  await db.insert(eventUser).values([
    { id: userId, eventId, displayId: 7 },
    { id: otherReviewerId, eventId, displayId: 8 },
    { id: bannedUserId, eventId, displayId: 9, status: "banned" },
  ]);
  await db.insert(order).values({ id: uid("ord"), userId, circleId, orderNumber: uid("num"), peopleCount: 1, totalPrice: 300, status: "completed", completed: true });
  await db.insert(order).values({ id: uid("ord"), userId, circleId: otherCircleId, orderNumber: uid("num"), peopleCount: 1, totalPrice: 300, status: "preparing", completed: false });
  // 別イベントに誤った利用ログがあっても、レビュー候補には混ぜない。
  await db.insert(circleVisit).values([
    { eventUserId: userId, circleId: visitCircleId },
    { eventUserId: userId, circleId: foreignCircleId },
  ]);
  await db.insert(review).values({ eventUserId: otherReviewerId, circleId, rating: 1, comment: "他の人の非公開コメント" });
  const wristbandId = uid("wb");
  await db.insert(wristband).values({ id: wristbandId, userId, status: "smartphone" });
  const lostWristbandId = uid("wb");
  const bannedWristbandId = uid("wb");
  await db.insert(wristband).values([
    { id: lostWristbandId, userId, status: "lost" },
    { id: bannedWristbandId, userId: bannedUserId, status: "active" },
  ]);
  return { db, eventId, circleId, otherCircleId, foreignCircleId, visitCircleId, userId, wristbandId, lostWristbandId, bannedUserId, bannedWristbandId };
}

describe("来場者レビュー", () => {
  it("体験履歴のあるサークルにだけ投稿でき、本人の投稿状態のみを返す", async () => {
    const { db, circleId, otherCircleId, foreignCircleId, visitCircleId, userId, wristbandId } = await seedReviewData();

    const denied = await postJson(`/api/reviews/visitor/${userId}`, { circleId: otherCircleId, rating: 5, comment: "対象外" });
    expect(denied.status).toBe(403);
    const crossEventDenied = await postJson(`/api/reviews/visitor/${userId}`, { circleId: foreignCircleId, rating: 5, comment: "別イベント" });
    expect(crossEventDenied.status).toBe(403);

    const beforeOwnReview = await request(`/api/reviews/visitor/${userId}`);
    const beforeRows = await beforeOwnReview.json() as any[];
    expect(beforeRows.find((row) => row.circleId === circleId).review).toBeNull();
    expect(JSON.stringify(beforeRows)).not.toContain("他の人の非公開コメント");

    const submitted = await postJson(`/api/reviews/visitor/${userId}`, { circleId, rating: 4, comment: "楽しかった" });
    expect(submitted.status).toBe(200);
    const byBand = await request(`/api/reviews/visitor/${wristbandId}`);
    expect(byBand.status).toBe(200);
    expect((await byBand.json() as any[]).map((row) => row.circleId)).toContain(circleId);
    const listResponse = await request(`/api/reviews/visitor/${userId}`);
    const firstRows = await listResponse.json() as any[];
    expect(firstRows).toHaveLength(2);
    expect(firstRows.find((row) => row.circleId === circleId).review).toEqual({ rating: 4, comment: "楽しかった" });
    expect(firstRows.some((row) => row.circleId === visitCircleId)).toBe(true);
    expect(firstRows.some((row) => row.circleId === otherCircleId)).toBe(false);

    await postJson(`/api/reviews/visitor/${userId}`, { circleId, rating: 5, comment: "更新しました" });
    const saved = await db.select().from(review).where(eq(review.eventUserId, userId));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.rating).toBe(5);
    expect(saved[0]?.comment).toBe("更新しました");
  });

  it("閲覧権限のない来場者には管理レビュー一覧を返さない", async () => {
    const { eventId, circleId } = await seedReviewData();
    expect((await request(`/api/reviews/circle/${circleId}`)).status).toBe(403);
    expect((await request(`/api/reviews/event/${eventId}`)).status).toBe(403);
  });

  it("紛失済みバンドと停止済みアカウントからレビューを参照・投稿できない", async () => {
    const { lostWristbandId, bannedUserId, bannedWristbandId, circleId } = await seedReviewData();

    await expect((await request(`/api/reviews/visitor/${lostWristbandId}`)).json()).resolves.toEqual([]);
    expect((await postJson(`/api/reviews/visitor/${lostWristbandId}`, { circleId, rating: 5 })).status).toBe(404);
    await expect((await request(`/api/reviews/visitor/${bannedUserId}`)).json()).resolves.toEqual([]);
    expect((await postJson(`/api/reviews/visitor/${bannedUserId}`, { circleId, rating: 5 })).status).toBe(404);
    await expect((await request(`/api/reviews/visitor/${bannedWristbandId}`)).json()).resolves.toEqual([]);
    expect((await postJson(`/api/reviews/visitor/${bannedWristbandId}`, { circleId, rating: 5 })).status).toBe(404);
  });

  it("評価値を1から5の整数に制限する", async () => {
    const { circleId, userId } = await seedReviewData();
    expect((await postJson(`/api/reviews/visitor/${userId}`, { circleId, rating: 6, comment: "invalid" })).status).toBe(400);
  });
});

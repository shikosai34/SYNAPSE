import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { eventUser, membership, wristband, wristbandBatch } from "@fesflow/db";
import { request, testDb, uid } from "./helpers";

function cookieOf(res: Response): string {
  const raw =
    (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function createEventManager() {
  const email = `${uid("wristband-batch")}@example.com`;
  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery-staple", name: "Batch test" }),
  });
  expect(signUp.status).toBeLessThan(400);
  const cookie = cookieOf(signUp);
  const eventResponse = await request("/api/festivals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ eventName: uid("バッチ検証") }),
  });
  expect(eventResponse.status).toBe(201);
  const { id: eventId } = (await eventResponse.json()) as { id: string };
  const db = testDb();
  const [ownerMembership] = await db
    .select()
    .from(membership)
    .where(and(eq(membership.eventId, eventId), eq(membership.role, "event_manager")));
  expect(ownerMembership).toBeDefined();
  return {
    db,
    eventId,
    headers: {
      Cookie: cookie,
      "X-Active-Membership-Id": ownerMembership!.id,
      "Content-Type": "application/json",
    },
  };
}

describe("リストバンド発行履歴", () => {
  it("物理バンドの単発発行は対象イベントの member:write を要求する", async () => {
    const target = await createEventManager();
    const unrelated = await createEventManager();
    const wristbandId = uid("physical-band");

    const denied = await request("/api/wristbands/issue", {
      method: "POST",
      headers: unrelated.headers,
      body: JSON.stringify({ eventId: target.eventId, wristbandId }),
    });
    expect(denied.status).toBe(403);
    expect(await target.db.select().from(eventUser).where(eq(eventUser.eventId, target.eventId))).toHaveLength(0);

    const allowed = await request("/api/wristbands/issue", {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify({ eventId: target.eventId, wristbandId }),
    });
    expect(allowed.status).toBe(200);
    const { userId: issuedUserId } = (await allowed.json()) as { userId: string };
    expect(await target.db.select().from(wristband).where(eq(wristband.id, wristbandId))).toHaveLength(1);

    const unrelatedProfileEdit = await request(`/api/wristbands/user/${issuedUserId}`, {
      method: "PATCH",
      headers: unrelated.headers,
      body: JSON.stringify({ status: "banned" }),
    });
    expect(unrelatedProfileEdit.status).toBe(403);
    expect((await target.db.select().from(eventUser).where(eq(eventUser.id, issuedUserId)))[0]?.status).toBe("available");

    const unrelatedBandEdit = await request(`/api/wristbands/${wristbandId}`, {
      method: "PATCH",
      headers: unrelated.headers,
      body: JSON.stringify({ status: "lost" }),
    });
    expect(unrelatedBandEdit.status).toBe(403);
    expect((await target.db.select().from(wristband).where(eq(wristband.id, wristbandId)))[0]?.status).toBe("active");

    const allowedProfileEdit = await request(`/api/wristbands/user/${issuedUserId}`, {
      method: "PATCH",
      headers: target.headers,
      body: JSON.stringify({ nickname: "same-event-edit" }),
    });
    expect(allowedProfileEdit.status).toBe(200);

    const selfIssued = await request("/api/wristbands/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: target.eventId }),
    });
    expect(selfIssued.status).toBe(200);
    const { userId } = (await selfIssued.json()) as { userId: string };
    expect(await target.db.select().from(eventUser).where(eq(eventUser.id, userId))).toHaveLength(1);
    expect(await target.db.select().from(wristband).where(eq(wristband.id, `sp_${userId}`))).toHaveLength(1);
  });

  it("別イベントの既存バンドを来場者へ付け替えない", async () => {
    const target = await createEventManager();
    const other = await createEventManager();
    const targetBandId = uid("target-event-band");
    const otherBandId = uid("other-event-band");

    const targetIssue = await request("/api/wristbands/issue", {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify({ eventId: target.eventId, wristbandId: targetBandId }),
    });
    const otherIssue = await request("/api/wristbands/issue", {
      method: "POST",
      headers: other.headers,
      body: JSON.stringify({ eventId: other.eventId, wristbandId: otherBandId }),
    });
    expect(targetIssue.status).toBe(200);
    expect(otherIssue.status).toBe(200);
    const { userId: targetUserId } = (await targetIssue.json()) as { userId: string };
    const { userId: otherUserId } = (await otherIssue.json()) as { userId: string };

    // 2026-10-08: イベントAの管理者でもイベントBのバンドをAの来場者へ移管できないことを確認する。
    const denied = await request("/api/wristbands/register", {
      method: "POST",
      headers: target.headers,
      body: JSON.stringify({ userId: targetUserId, wristbandId: otherBandId }),
    });

    expect(denied.status).toBe(403);
    expect((await target.db.select().from(wristband).where(eq(wristband.id, otherBandId)))[0]).toMatchObject({
      userId: otherUserId,
      status: "active",
    });
    expect((await target.db.select().from(wristband).where(eq(wristband.id, targetBandId)))[0]?.status).toBe("active");
  });

  it("登録前にURLを保存し、完了後も一覧とURLのみCSVから再取得できる", async () => {
    const { db, eventId, headers } = await createEventManager();
    const urls = ["https://fesflow.shikosai.net/w/test-a1", "https://fesflow.shikosai.net/w/test-a2"];
    const createdResponse = await request("/api/wristbands/batches", {
      method: "POST",
      headers,
      body: JSON.stringify({ eventId, source: "csv", urls }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string; status: string };
    expect(created.status).toBe("pending");

    const storedHistory = await db.select().from(wristbandBatch).where(eq(wristbandBatch.id, created.id));
    expect(storedHistory).toHaveLength(1);

    const processResponse = await request(`/api/wristbands/batches/${created.id}/process`, {
      method: "POST",
      headers,
    });
    expect(processResponse.status).toBe(200);
    const processed = (await processResponse.json()) as { status: string; importedCount: number };
    expect(processed.status).toBe("completed");
    expect(processed.importedCount).toBe(2);
    expect(await db.select().from(wristband).where(eq(wristband.id, "test-a1"))).toHaveLength(1);
    expect(await db.select().from(eventUser).where(eq(eventUser.eventId, eventId))).toHaveLength(2);

    const historyResponse = await request(`/api/wristbands/batches?eventId=${eventId}`, { headers });
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as { total: number; items: Array<{ id: string }> };
    expect(history.total).toBe(1);
    expect(history.items[0]?.id).toBe(created.id);

    const csvResponse = await request(`/api/wristbands/batches/${created.id}/csv`, { headers });
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers.get("content-type")).toContain("text/csv");
    expect((await csvResponse.text()).replace(/^\uFEFF/, "")).toBe(`url\r\n${urls.join("\r\n")}`);
  });

  it("既に登録されたIDを含むバッチは重複分を追加せず要確認にする", async () => {
    const { db, eventId, headers } = await createEventManager();
    const urls = ["https://fesflow.shikosai.net/w/duplicate-id"];
    const createBatch = () => request("/api/wristbands/batches", {
      method: "POST",
      headers,
      body: JSON.stringify({ eventId, source: "csv", urls }),
    });

    const first = await createBatch();
    const { id: firstId } = (await first.json()) as { id: string };
    await request(`/api/wristbands/batches/${firstId}/process`, { method: "POST", headers });
    const second = await createBatch();
    const { id: secondId } = (await second.json()) as { id: string };
    const conflictResponse = await request(`/api/wristbands/batches/${secondId}/process`, {
      method: "POST",
      headers,
    });

    const conflict = (await conflictResponse.json()) as { status: string; conflictCount: number; importedCount: number };
    expect(conflict.status).toBe("conflict");
    expect(conflict.conflictCount).toBe(1);
    expect(conflict.importedCount).toBe(0);
    expect(await db.select().from(wristband).where(eq(wristband.id, "duplicate-id"))).toHaveLength(1);
  });
});

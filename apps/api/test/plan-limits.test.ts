/**
 * Phase A (SaaS テナント/課金) の回帰テスト。
 *
 * - イベント作成のセルフサービス化: ログインユーザーが POST /api/festivals すると
 *   無料枠 (plan=free, maxCircles=1) のイベントが作られ、本人が event_manager になる。
 * - サークル数上限: 無料枠は 1 サークルまで。2つ目の作成は 403。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { event, membership } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

function extractCookieHeader(res: Response): string {
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

async function signUpAndGetCookie(): Promise<{ cookie: string; email: string }> {
	const email = `${uid("planlimit")}@example.com`;
	const res = await postJson("/api/auth/sign-up/email", {
		email,
		password: "correct-horse-battery-staple",
		name: "主催者テスト",
	});
	expect(res.status).toBeLessThan(400);
	const cookie = extractCookieHeader(res);
	expect(cookie.length).toBeGreaterThan(0);
	return { cookie, email };
}

async function createCircle(cookie: string, eventId: string, name: string) {
	return request("/api/circles", {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify({ eventId, name }),
	});
}

describe("SaaS 無料枠とサークル上限", () => {
	it("ログインユーザーがイベントを作成すると無料枠で event_manager になる", async () => {
		const { cookie, email } = await signUpAndGetCookie();

		const res = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ eventName: uid("マイ学園祭") }),
		});
		expect(res.status).toBe(201);
		const { id: eventId } = (await res.json()) as { id: string };

		const db = testDb();
		const rows = await db.select().from(event).where(eq(event.id, eventId));
		expect(rows).toHaveLength(1);
		expect(rows[0]!.plan).toBe("free");
		expect(rows[0]!.maxCircles).toBe(1);
		expect(rows[0]!.billingStatus).toBe("active");
		expect(rows[0]!.ownerEmail?.toLowerCase()).toBe(email.toLowerCase());

		const managers = await db
			.select()
			.from(membership)
			.where(and(eq(membership.eventId, eventId), eq(membership.role, "event_manager")));
		expect(managers).toHaveLength(1);
		expect(managers[0]!.userEmail.toLowerCase()).toBe(email.toLowerCase());
	});

	it("未認証でのイベント作成は 401", async () => {
		const res = await postJson("/api/festivals", { eventName: uid("無認証祭") });
		expect(res.status).toBe(401);
	});

	it("無料枠(maxCircles=1)は 2 つ目のサークル作成を 403 で拒否する", async () => {
		const { cookie } = await signUpAndGetCookie();
		const res = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ eventName: uid("上限テスト祭") }),
		});
		const { id: eventId } = (await res.json()) as { id: string };

		const first = await createCircle(cookie, eventId, uid("1つ目"));
		expect(first.status).toBe(201);

		const second = await createCircle(cookie, eventId, uid("2つ目"));
		expect(second.status).toBe(403);
	});

	it("停止中(suspended)イベントはサークル作成を 403 で拒否する", async () => {
		const { cookie } = await signUpAndGetCookie();
		const res = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ eventName: uid("停止テスト祭") }),
		});
		const { id: eventId } = (await res.json()) as { id: string };

		const db = testDb();
		await db.update(event).set({ billingStatus: "suspended" }).where(eq(event.id, eventId));

		const blocked = await createCircle(cookie, eventId, uid("停止中サークル"));
		expect(blocked.status).toBe(403);
	});
});

/**
 * サークルのセルフサービス作成 (Phase 3a) の回帰テスト。
 *
 * 新仕様: better-auth セッションを持つ任意のログインユーザーが POST /api/circles で
 * サークルを作成でき、作成と同時に自分自身 (session.user.email) が circle_manager の
 * membership として登録される (managerEmail/managerPin 等の入力は廃止)。
 *
 * better-auth の sign-up (POST /api/auth/sign-up/email) はメール確認不要設定
 * (packages/auth/src/index.ts に requireEmailVerification が無い) のため、
 * サインアップ直後に Set-Cookie でセッションが張られる。そのクッキーを後続リクエストの
 * Cookie ヘッダーに渡すことでログイン状態を再現する。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { circle, membership } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

/** better-auth sign-up のレスポンスから Set-Cookie を抽出し、Cookie ヘッダー値に変換する。 */
function extractCookieHeader(res: Response): string {
	// undici/workerd の Headers は同名ヘッダーを getSetCookie() でまとめて取得できる。
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

async function signUpAndGetCookie(): Promise<{ cookie: string; email: string }> {
	const email = `${uid("selfservice")}@example.com`;
	const res = await postJson("/api/auth/sign-up/email", {
		email,
		password: "correct-horse-battery-staple",
		name: "テストユーザー",
	});
	expect(res.status).toBeLessThan(400);
	const cookie = extractCookieHeader(res);
	expect(cookie.length).toBeGreaterThan(0);
	return { cookie, email };
}

describe("サークルのセルフサービス作成", () => {
	it("ログインユーザーがサークルを作成すると、自分が circle_manager になる", async () => {
		const { cookie, email } = await signUpAndGetCookie();

		const eventId = uid("ev");
		const db = testDb();
		const { event } = await import("@fesflow/db");
		await db.insert(event).values({ id: eventId, eventName: uid("テスト学園祭") });

		const circleName = uid("テスト模擬店");
		const res = await request("/api/circles", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ eventId, name: circleName }),
		});
		expect(res.status).toBe(201);
		const { id: circleId } = (await res.json()) as { id: string };

		const createdCircle = await db.select().from(circle).where(eq(circle.id, circleId));
		expect(createdCircle).toHaveLength(1);

		const managerMemberships = await db
			.select()
			.from(membership)
			.where(
				and(
					eq(membership.circleId, circleId),
					eq(membership.role, "circle_manager"),
				),
			);
		expect(managerMemberships).toHaveLength(1);
		expect(managerMemberships[0]!.userEmail.toLowerCase()).toBe(email.toLowerCase());
	});

	it("未認証でのサークル作成は 401", async () => {
		const res = await postJson("/api/circles", {
			eventId: uid("ev"),
			name: uid("無認証模擬店"),
		});
		expect(res.status).toBe(401);
	});
});

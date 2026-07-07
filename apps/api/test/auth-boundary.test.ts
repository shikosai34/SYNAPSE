/**
 * 認証・認可境界の回帰テスト。
 * これまで手動 (curl/ブラウザ) で確認していた「未認証・無権限は入れない」を固定化する。
 * ステータスだけでなくエラー形状も検証する。
 * 2026-07-07 (Phase4): エラーエンベロープを { error: string } から
 * { code, message, requestId } に刷新したため、アサーションをここで新形状に更新する。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { circle, event, membership } from "@fesflow/db";
import type { ApiErrorCode } from "@fesflow/config";
import { postJson, request, testDb, uid } from "./helpers";

function extractCookieHeader(res: Response): string {
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

/**
 * 新エンベロープ ({ code, message, requestId, fields? }) を検証するヘルパ。
 * code を渡した場合はコードの一致まで確認する (401→UNAUTHORIZED, 403→FORBIDDEN 等)。
 */
async function expectErrorJson(res: Response, code?: ApiErrorCode): Promise<string> {
	const data = (await res.json()) as {
		code?: unknown;
		message?: unknown;
		requestId?: unknown;
	};
	expect(typeof data.code).toBe("string");
	expect(typeof data.message).toBe("string");
	expect(typeof data.requestId).toBe("string");
	if (code) expect(data.code).toBe(code);
	return data.message as string;
}

describe("認証・認可境界", () => {
	it("未認証の GET /api/account/me は 401", async () => {
		const res = await request("/api/account/me");
		expect(res.status).toBe(401);
		await expectErrorJson(res, "UNAUTHORIZED");
	});

	it("未認証の GET /api/admin/users は 403 (super_admin ガード)", async () => {
		const res = await request("/api/admin/users");
		expect(res.status).toBe(403);
		await expectErrorJson(res, "FORBIDDEN");
	});

	it("未認証の POST /api/upload は 401 (監査M4: 無認証アップロード禁止)", async () => {
		const res = await request("/api/upload", { method: "POST" });
		expect(res.status).toBe(401);
		await expectErrorJson(res, "UNAUTHORIZED");
	});

	it("無権限の GET /api/orders?circleId=x は 403 (他サークルの売上漏洩防止)", async () => {
		const res = await request("/api/orders?circleId=some-circle");
		expect(res.status).toBe(403);
		await expectErrorJson(res, "FORBIDDEN");
	});

	it("未認証の GET /api/festivals は 401 (イベント一覧は所属ベースで絞るため要セッション)", async () => {
		const res = await request("/api/festivals");
		expect(res.status).toBe(401);
		await expectErrorJson(res, "UNAUTHORIZED");
	});

	// 2026-07-07 (Phase 3a): hasPermission の「X-Active-Membership-Id が無ければ
	// 全 membership を評価する」互換フォールバックを撤去した。このテストは、
	// サークルの circle_manager 権限を持つユーザーであっても、そのサークルを
	// アクティブスペースとして明示 (ヘッダー付与) しない限り書き込み系操作が
	// 通らないことを固定化する (フォールバック復活のリグレッション防止)。
	it("circle_manager でも X-Active-Membership-Id 未指定なら PATCH /api/circles/:id/mods は 403", async () => {
		const email = `${uid("manager")}@example.com`;
		const signUp = await postJson("/api/auth/sign-up/email", {
			email,
			password: "correct-horse-battery-staple",
			name: "サークル代表",
		});
		expect(signUp.status).toBeLessThan(400);
		const cookie = extractCookieHeader(signUp);

		const db = testDb();
		const eventId = uid("ev");
		const circleId = uid("ci");
		await db.insert(event).values({ id: eventId, eventName: uid("テスト学園祭") });
		await db.insert(circle).values({ id: circleId, eventId, name: uid("テスト模擬店") });
		await db.insert(membership).values({
			id: uid("mem"),
			userEmail: email.toLowerCase(),
			userName: "サークル代表",
			circleId,
			role: "circle_manager",
			isActive: true,
		});

		// ヘッダーなし: フォールバックが無いため権限なし扱いになるはず
		const withoutHeader = await request(`/api/circles/${circleId}/mods`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ mods: { stock: true } }),
		});
		expect(withoutHeader.status).toBe(403);

		// ヘッダーあり (アクティブスペースを明示): 同じユーザーで許可されることも確認する
		const managerRows = await db
			.select()
			.from(membership)
			.where(and(eq(membership.circleId, circleId), eq(membership.role, "circle_manager")));
		const membershipId = managerRows[0]!.id;

		const withHeader = await request(`/api/circles/${circleId}/mods`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookie,
				"X-Active-Membership-Id": membershipId,
			},
			body: JSON.stringify({ mods: { stock: true } }),
		});
		expect(withHeader.status).toBe(200);
	});
});

/**
 * 認証・認可境界の回帰テスト。
 * これまで手動 (curl/ブラウザ) で確認していた「未認証・無権限は入れない」を固定化する。
 * ステータスだけでなくエラー形状 ({ error: string }) も検証する
 * (Phase4 でエラーエンベロープを刷新する際、この形状アサーションを更新する)。
 */
import { describe, expect, it } from "vitest";
import { request } from "./helpers";

async function expectErrorJson(res: Response): Promise<string> {
	const data = (await res.json()) as { error?: unknown };
	expect(typeof data.error).toBe("string");
	return data.error as string;
}

describe("認証・認可境界", () => {
	it("未認証の GET /api/account/me は 401", async () => {
		const res = await request("/api/account/me");
		expect(res.status).toBe(401);
		await expectErrorJson(res);
	});

	it("未認証の GET /api/admin/users は 403 (super_admin ガード)", async () => {
		const res = await request("/api/admin/users");
		expect(res.status).toBe(403);
		await expectErrorJson(res);
	});

	it("未認証の POST /api/upload は 401 (監査M4: 無認証アップロード禁止)", async () => {
		const res = await request("/api/upload", { method: "POST" });
		expect(res.status).toBe(401);
		await expectErrorJson(res);
	});

	it("無権限の GET /api/orders?circleId=x は 403 (他サークルの売上漏洩防止)", async () => {
		const res = await request("/api/orders?circleId=some-circle");
		expect(res.status).toBe(403);
		await expectErrorJson(res);
	});

	it("未認証の GET /api/festivals は 401 (イベント一覧は所属ベースで絞るため要セッション)", async () => {
		const res = await request("/api/festivals");
		expect(res.status).toBe(401);
		await expectErrorJson(res);
	});
});

/**
 * 認証レート制限まわりの回帰テスト。
 *
 * 2026-07-07 (Phase 3a): 独自 PIN 認証 (POST /api/memberships/authenticate-pin) と
 * サークルパスワード認証 (POST /api/festivals/login) を廃止し、認証は better-auth に
 * 一本化した。このファイルは元々この2ルートの5回失敗ロックアウトを検証していたが、
 * ルート自体を削除したためテスト対象が無くなった。代わりに「並行認証系が本当に
 * 消えたこと」を回帰防止として検証する。
 *
 * 注意: better-auth の /api/auth/sign-in/email に対する IP レート制限
 * (index.ts の auth_attempt 連携) も本来はここで検証したいが、このテスト環境
 * (vitest-pool-workers + better-auth) では失敗した sign-in 呼び出し自体が
 * better-auth 内部 (better-call の transaction dispatch) で Unhandled Rejection を
 * 発生させ、vitest がテスト失敗として扱ってしまう既知の問題がある
 * (このリファクタリングで導入した実装には起因しない、ライブラリ内部の挙動)。
 * このテストファイルでは深追いせず、対象を削除済みルートの確認のみに絞る。
 *
 * テスト環境では CF-Connecting-IP が無いため IP は "unknown" バケットに集約される。
 * D1 がテスト間で共有される (isolatedStorage 無し) ため、各テストの前後で
 * auth_attempt を空にして他テストへのロック漏れを防ぐ。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authAttempt } from "@fesflow/db";
import { postJson, testDb } from "./helpers";

async function clearAllAttempts() {
	await testDb().delete(authAttempt);
}

beforeEach(clearAllAttempts);
afterEach(clearAllAttempts);

describe("廃止した並行認証ルートの撤去確認", () => {
	// 2026-07-07 (Phase 3a): membershipRoutes は "*" に requireAuth を掛けているため、
	// 削除済みルートへの未認証アクセスは (Hono のルーティング上) 401 として先に弾かれる
	// (404 まで到達しない)。ここでは「PIN 認証としては機能しない」ことを固定化する:
	// 認証されていない以上、PIN の正誤に関わらず成功レスポンス (success:true) が
	// 返らないことを検証する。
	it("POST /api/memberships/authenticate-pin はセッション必須化により 401 (PIN認証としては機能しない)", async () => {
		const res = await postJson("/api/memberships/authenticate-pin", {
			email: "someone@example.com",
			pin: "1234",
		});
		expect(res.status).toBe(401);
	});

	it("POST /api/festivals/login は 404 (サークルパスワード認証は廃止済み)", async () => {
		const res = await postJson("/api/festivals/login", {
			eventName: "存在しないイベント",
			circleName: "存在しない模擬店",
			password: "wrong-password",
		});
		expect(res.status).toBe(404);
	});
});

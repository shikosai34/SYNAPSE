/**
 * 認証レート制限まわりの回帰テスト。
 *
 * 2026-07-07 (Phase 3a): 独自 PIN 認証 (POST /api/memberships/authenticate-pin) と
 * サークルパスワード認証 (POST /api/festivals/login) を廃止し、認証は better-auth に
 * 一本化した。このファイルは元々この2ルートの5回失敗ロックアウトを検証していたが、
 * ルート自体を削除したためテスト対象が無くなった。代わりに「並行認証系が本当に
 * 消えたこと」を回帰防止として検証する。
 *
 * 2026-10-03 (#94): IPではなくメール/パスキーの認証識別子をHMAC化して段階遅延する。
 * D1がテスト間で共有される (isolatedStorage無し) ため、各テスト前後にauth_attemptを空にする。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authAttempt } from "@fesflow/db";
import { postJson, testDb } from "./helpers";
import { authAttemptBucket } from "../src/utils/rate-limit";

async function clearAllAttempts() {
	await testDb().delete(authAttempt);
}

beforeEach(clearAllAttempts);
afterEach(clearAllAttempts);

describe("識別子別認証バケット", () => {
	it("uses normalized email and passkey credential IDs, never an IP or OAuth provider bucket", async () => {
		const secret = "test-rate-limit-secret";
		const emailRequest = (email: string) => new Request("https://example.test/api/auth/sign-in/email", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
		});
		const upper = await authAttemptBucket(emailRequest(" Alice@Example.com "), "/api/auth/sign-in/email", secret);
		const lower = await authAttemptBucket(emailRequest("alice@example.com"), "/api/auth/sign-in/email", secret);
		expect(upper?.key).toBe(lower?.key);
		expect(upper?.key).not.toContain("alice@example.com");

		const passkey = await authAttemptBucket(new Request("https://example.test/api/auth/passkey/verify-authentication", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response: { id: "credential-id" } }),
		}), "/api/auth/passkey/verify-authentication", secret);
		expect(passkey?.scope).toBe("passkey");
		expect(passkey?.key).not.toContain("credential-id");

		const social = await authAttemptBucket(new Request("https://example.test/api/auth/sign-in/social", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "google" }),
		}), "/api/auth/sign-in/social", secret);
		expect(social).toBeNull();
	});
});

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

/**
 * レート制限 / アカウントロックアウト (監査 H4) の回帰テスト。
 * 仕様: 5回失敗で 15分ロック。IP バケットと対象バケットの2本立てで、
 * どちらかがロック中なら bcrypt 実行前に 429 + Retry-After で弾く。
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

describe("レート制限 / アカウントロックアウト (H4)", () => {
	it("サークルログイン5回失敗で 6回目以降は 429 + Retry-After", async () => {
		// 存在しないイベント/サークルでも列挙防止のため 401 (統一メッセージ) + 失敗記録される
		const body = {
			eventName: "存在しないイベント",
			circleName: "存在しない模擬店",
			password: "wrong-password",
		};

		for (let i = 0; i < 5; i++) {
			const res = await postJson("/api/festivals/login", body);
			expect(res.status).toBe(401);
		}

		const locked = await postJson("/api/festivals/login", body);
		expect(locked.status).toBe(429);
		const retryAfter = Number(locked.headers.get("Retry-After"));
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(15 * 60);
	});

	it("別の対象でも同一IPからの失敗が累積してロックされる (分散総当たり対策)", async () => {
		for (let i = 0; i < 5; i++) {
			// 対象 (eventName::circleName) を毎回変えて IP バケットのみを蓄積させる
			const res = await postJson("/api/festivals/login", {
				eventName: `ev-${i}`,
				circleName: `ci-${i}`,
				password: "wrong",
			});
			expect(res.status).toBe(401);
		}
		const locked = await postJson("/api/festivals/login", {
			eventName: "fresh-event",
			circleName: "fresh-circle",
			password: "wrong",
		});
		expect(locked.status).toBe(429);
	});
});

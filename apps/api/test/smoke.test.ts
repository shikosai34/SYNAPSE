/**
 * スモークテスト: Worker が workerd 上で起動し、D1 migration が適用されていることの確認。
 * ここが落ちる場合はテスト基盤 (vitest.config.ts / apply-migrations.ts) 側の問題。
 */
import { describe, expect, it } from "vitest";
import { request } from "./helpers";

describe("worker 起動", () => {
	it("GET / がヘルスチェックとして 200/OK を返す", async () => {
		const res = await request("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("OK");
	});

	it("GET /api/system/public が 200 を返す (migration 適用済み D1 への実クエリ)", async () => {
		const res = await request("/api/system/public");
		expect(res.status).toBe(200);
		const data = (await res.json()) as { maintenance?: unknown };
		expect(data).toHaveProperty("maintenance");
	});
});

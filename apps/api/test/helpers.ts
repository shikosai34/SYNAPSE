/**
 * テスト共通ヘルパ。
 *
 * Worker には SELF (別インスタンス) ではなく `app.fetch(req, env, ctx)` で直接
 * リクエストを入れる。ミドルウェア (ALS への db/auth 注入・CORS・レート制限) を
 * 本番と同じ経路で通しつつ、テストから env (cloudflare:test) を共有できるため、
 * シード投入と API 呼び出しが同じ D1 を見る。
 */
import {
	createExecutionContext,
	waitOnExecutionContext,
	env,
} from "cloudflare:test";
import { createDb } from "@fesflow/db";
import app from "../src/index";

export async function request(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const ctx = createExecutionContext();
	const res = await app.fetch(
		new Request(`http://localhost${path}`, init),
		env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return res;
}

export function postJson(
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return request(path, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

/** テストから直接シード/検証するための drizzle インスタンス (API と同じ D1 を参照)。 */
export function testDb() {
	return createDb(env.DB);
}

/**
 * テストごとに一意な ID を生成する。
 * vitest-pool-workers 0.18 (vitest 4 対応版) には旧版の isolatedStorage が (まだ) 無く、
 * D1 の状態が全テスト・全ファイルで共有されるため、シードは毎回一意な ID で行い
 * 他テストと衝突しないようにする。
 */
export function uid(prefix: string): string {
	return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

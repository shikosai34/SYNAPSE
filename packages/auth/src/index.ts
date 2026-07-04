/**
 * 認証 (better-auth) エントリ (2026-07-04 Worker 対応にリライト)
 *
 * 変更意図:
 * - 旧実装は db シングルトンと process.env.CORS_ORIGIN に依存した
 *   `auth` シングルトンだった。Worker では db も env もリクエスト毎なので
 *   `createAuth(db, env)` ファクトリへ変更する。
 * - 既存コード (context.ts / utils/auth.ts) は `import { auth }` を
 *   使うため、ALS のリクエストストアから実体を解決する Proxy として
 *   `auth` を公開し、呼び出し側を無改修に保つ。
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getRequestStore, type DB, type WorkerEnv } from "@fesflow/db";
import * as schema from "@fesflow/db/schema/auth";

/** db と env から better-auth インスタンスを生成する。 */
export function createAuth(db: DB, env: WorkerEnv) {
	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		// フロントは複数オリジン (visitor=apex / staff / admin)。オリジンが trustedOrigins に
		// 無いと better-auth が 403 INVALID_ORIGIN で弾く ("origin が間違ってる" エラーの正体)。
		// - 本番: fesflow.shikosai.net (apex) + そのサブドメイン全部をワイルドカードで信頼。
		//   これで staff. / admin. / 追加サブドメインを個別列挙せずに済む (2026-07-04)。
		// - CORS_ORIGIN があれば追加で信頼 (別ドメインや workers.dev で試す場合の逃げ道)。
		// - ローカル: localhost/127.0.0.1 の 3000(register) と 3001(visitor)。
		trustedOrigins: [
			...(env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",").map((s) => s.trim()) : []),
			"https://fesflow.shikosai.net",
			"https://*.fesflow.shikosai.net",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:3001",
			"http://127.0.0.1:3001",
		].filter(Boolean),
		emailAndPassword: {
			enabled: true,
		},
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
	});
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * ALS のリクエストストアから better-auth 実体を解決する Proxy。
 * 関数は実体に bind して返す (this 依存対策)。
 */
export const auth: Auth = new Proxy({} as Auth, {
	get(_target, prop) {
		const real = getRequestStore().auth as Record<PropertyKey, unknown>;
		if (!real) {
			throw new Error(
				"[auth] リクエストストアに auth がありません。ミドルウェアで createAuth を設定してください。",
			);
		}
		const value = real[prop];
		return typeof value === "function"
			? (value as (...args: unknown[]) => unknown).bind(real)
			: value;
	},
}) as Auth;

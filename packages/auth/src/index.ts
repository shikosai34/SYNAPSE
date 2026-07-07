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
import { passkey } from "@better-auth/passkey";

// createAuth の戻り値型を事前に確定させるためのダミー呼び出し型。
// TypeScript がオプション引数の具体型を推論すると .bun/ キャッシュ内の
// @simplewebauthn/server を指す非ポータブルな型名を生成してしまう。
// BetterAuthOptions を使った上位型 Auth<BetterAuthOptions> として固定し
// ポータブルな型参照だけで完結させる (2026-07-08)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Auth = ReturnType<typeof betterAuth<any>>;

/** db と env から better-auth インスタンスを生成する。 */
export function createAuth(db: DB, env: WorkerEnv): Auth {
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
		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID || "",
				clientSecret: env.GOOGLE_CLIENT_SECRET || "",
			},
		},
		plugins: [passkey()],
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
	}) as Auth;
}

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

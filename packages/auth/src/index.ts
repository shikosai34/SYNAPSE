/**
 * 認証 (better-auth) エントリ (2026-07-08 Phase5: ALS+Proxy 撤去 → 明示的 per-request DI)
 *
 * 変更意図:
 * - 旧実装 (2026-07-04) は db シングルトンと process.env.CORS_ORIGIN に依存した
 *   従来コードの都合で `createAuth(db, env)` ファクトリ化した上で、既存コード
 *   (utils/auth.ts 等) の `import { auth }` を無改修に保つため ALS のリクエスト
 *   ストアから実体を解決する Proxy を被せていた。
 * - Phase5 でこの Proxy を撤去する。呼び出し側は `c.get("auth")`
 *   (apps/api/src/index.ts の middleware で c.set("auth", createAuth(db, env)) 済み)
 *   を明示的に使うよう変更済みなので、ここでは createAuth ファクトリと Auth 型だけを
 *   提供すればよい。
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { DB, WorkerEnv } from "@fesflow/db";
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
		// オリジンが trustedOrigins に無いと better-auth が 403 INVALID_ORIGIN で弾く
		// ("origin が間違ってる" エラーの正体)。
		// - 本番: fesflow.shikosai.net (apex) + そのサブドメイン全部をワイルドカードで信頼。
		//   追加サブドメインを個別列挙せずに済む (2026-07-04)。
		// - CORS_ORIGIN があれば追加で信頼 (別ドメインや workers.dev で試す場合の逃げ道)。
		// - ローカル: localhost/127.0.0.1 の :3000。
		//   2026-07-09: visitor+register を単一 SPA(apps/app :3000) に統合したため、
		//   旧 visitor 用の :3001 エントリを撤去した (2026-07-07 単一ドメイン化の残置)。
		trustedOrigins: [
			...(env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",").map((s) => s.trim()) : []),
			"https://fesflow.shikosai.net",
			"https://*.fesflow.shikosai.net",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
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

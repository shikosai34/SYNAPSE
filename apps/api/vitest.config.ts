/**
 * API Worker の統合テスト設定 (2026-07-07 リファクタリング Phase7: テスト基盤導入)
 *
 * @cloudflare/vitest-pool-workers により、テストを Node ではなく workerd 上で実行する。
 * dev==prod (@cloudflare/vite-plugin) と同じ思想で test==prod を保つのが狙い。
 * wrangler.jsonc から D1/R2 バインディングと compatibility_flags (nodejs_compat = ALS)
 * をそのまま読み込むため、本番と同一の実行環境・バインディング構成でテストできる。
 *
 * 注意: vitest-pool-workers 0.18 (vitest 4 対応) から旧 defineWorkersConfig
 * ("./config" エントリ) は廃止され、cloudflareTest() を Vite プラグインとして
 * 挿す方式に変わっている。
 *
 * D1 はテストごとに隔離ストレージへ migration を適用する
 * (test/apply-migrations.ts + TEST_MIGRATIONS バインディング)。migration の正本は
 * packages/db/src/migrations (wrangler.jsonc の migrations_dir と同一)。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	// new URL() だと lib.dom の URL 型と node:url の URL 型が衝突するため文字列経由で解決する
	const migrationsDir = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../packages/db/src/migrations",
	);
	const migrations = await readD1Migrations(migrationsDir);

	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						// wrangler.jsonc の vars は本番値なので、テストではここで上書きする。
						// BETTER_AUTH_SECRET は本番では wrangler secret であり vars に無いため
						// テスト用のダミー値を必ず与える (無いと better-auth が初期化できない)。
						BETTER_AUTH_SECRET: "test-secret-do-not-use-in-production",
						BETTER_AUTH_URL: "http://localhost",
						CORS_ORIGIN: "http://localhost",
						// プロダクトではメール/パスワード認証を無効化した (Google + パスキーに移行) が、
						// 認可境界テストは sign-up/email でセッションを発行して検証するため、
						// テスト環境でのみ better-auth の emailAndPassword を有効化する。
						ENABLE_EMAIL_PASSWORD: "true",
					},
				},
			}),
		],
		test: {
			// tsc -b (check-types) が dist/test/*.js を出力するため、拾うのは TS 原本のみに限定する
			include: ["test/**/*.test.ts"],
			setupFiles: ["./test/apply-migrations.ts"],
		},
	};
});

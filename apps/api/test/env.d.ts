/**
 * cloudflare:test の env 型定義。
 *
 * vitest-pool-workers 0.18 の `env` は `Cloudflare.Env` 型を参照する。
 * 正式には `wrangler types` (bun run cf-typegen) が worker-configuration.d.ts に
 * Cloudflare.Env を生成するが、生成物は gitignore されておりクリーンな環境でも
 * check-types が通るよう、ここで本番の WorkerEnv + テスト専用バインディング
 * (TEST_MIGRATIONS) を宣言マージで自己完結させる。
 */
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { WorkerEnv } from "@fesflow/db";

declare global {
	namespace Cloudflare {
		// worker-configuration.d.ts (生成物) が存在する場合は宣言マージされる
		interface Env extends WorkerEnv {
			DB: D1Database;
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}

export {};

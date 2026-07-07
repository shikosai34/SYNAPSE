/**
 * テストのセットアップ: 隔離ストレージの D1 に migration を適用する。
 * 適用履歴は D1 (d1_migrations テーブル) が持つため、繰り返し実行しても冪等。
 * TEST_MIGRATIONS は vitest.config.ts が packages/db/src/migrations から読み込んで注入する。
 */
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

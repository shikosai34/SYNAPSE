/**
 * DB エントリ (2026-07-08 Phase5: ALS+Proxy 撤去 → 明示的 per-request DI)
 *
 * 変更意図:
 * - 旧実装 (2026-07-04) は Cloudflare Workers で D1 バインディングが
 *   「リクエストごとの env」経由でしか得られない制約に対応するため、
 *   AsyncLocalStorage + Proxy で `db` をモジュールシングルトンに見せかけていた。
 *   これは FesOrder (元コード) を無改修で移植するための橋渡し実装だった。
 * - Phase5 でこの「魔法」を撤去する。db は Hono の middleware (apps/api/src/index.ts)
 *   で生成し `c.set("db", db)` して各ハンドラが `c.get("db")` で明示的に受け取る、
 *   通常の per-request DI に変更した。「どこから db が来るか」がコードから直接
 *   追えるようになる (CLAUDE.md の「思想をコードに残す」方針に合致)。
 * - AsyncLocalStorage / Proxy / runWithRequest / getRequestStore / getEnv は
 *   ここでは撤去したが、createDb・createLibsqlDb・型 DB・schema re-export は
 *   そのまま利用するため残す。
 */
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as authSchema from "./schema/auth";
import * as festivalSchema from "./schema/festival";

const schema = { ...authSchema, ...festivalSchema };
export type Schema = typeof schema;

/** Worker の env バインディング。secrets/vars/D1/R2 をまとめて表す。 */
export interface WorkerEnv {
  DB: D1Database;
  BUCKET?: unknown;
  R2_PUBLIC_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  CORS_ORIGIN?: string;
  INITIAL_SUPER_ADMIN_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // 2026-07-12: メール/パスワード認証はプロダクトでは無効 (Google + パスキーに移行)。
  // このフラグは "true" のときだけ better-auth の emailAndPassword を有効化する
  // テスト専用のエスケープハッチ。テスト(vitest.config の miniflare.bindings)は
  // better-auth の sign-up/email でセッションを発行して認可境界を検証するため必要。
  // 本番/開発の wrangler.jsonc・.dev.vars では設定しないこと (設定するとメールログインが復活する)。
  ENABLE_EMAIL_PASSWORD?: string;
  PRODUCT_NAME?: string;
  // MinIO/S3 フォールバック
  S3_ENDPOINT?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_REGION?: string;
  S3_PUBLIC_URL?: string;
  [key: string]: unknown;
}

/** D1 バインディングから drizzle インスタンスを生成する (本番 Worker 経路)。 */
export function createDb(d1: D1Database) {
  return drizzleD1(d1, { schema });
}
export type DB = ReturnType<typeof createDb>;

/** libsql URL から drizzle を生成する (drizzle-kit/スクリプト/Node ローカル用)。 */
export function createLibsqlDb(url: string, authToken?: string): DB {
  const client = createClient({ url, authToken });
  return drizzleLibsql({ client, schema }) as unknown as DB;
}

export * from "./schema/auth";
export * from "./schema/festival";

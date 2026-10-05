/**
 * Hono の Variables 型 (2026-07-08 Phase5: ALS+Proxy 撤去 → 明示的 per-request DI)
 *
 * 変更意図:
 * - 旧実装は `import { db } from "@fesflow/db"` / `import { auth } from "@fesflow/auth"` で
 *   ALS 経由の Proxy を参照しており、db/auth がどこから来るかコードから追えなかった。
 * - リクエスト境界 (apps/api/src/index.ts の middleware) で `c.set("db", db)` /
 *   `c.set("auth", auth)` した実体を、各ルートが `c.get("db")` / `c.get("auth")` で
 *   明示的に受け取る設計に変更する。この型はその Variables 契約を表す。
 * - session は better-auth 必須ルート (requireAuth/requireSuperAdmin 経由) でのみ
 *   set されるため任意 (optional) にする。
 */
import type { DB, WorkerEnv } from "@fesflow/db";
import type { Auth } from "@fesflow/auth";

/** better-auth の getSession が返す型 (Awaited<ReturnType<...>>)。 */
export type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

/** 全ルートで共通の Variables。db/auth は index.ts の middleware で必ず set される。 */
export type AppVariables = {
  db: DB;
  auth: Auth;
  session?: Session;
  // 2026-10-03: 成功・失敗を同じサーバー生成IDで追跡する。
  requestId?: string;
  errorCode?: string;
};

/** Hono ジェネリクスの共通形。`new Hono<AppEnv>()` のように使う。 */
export type AppEnv = { Bindings: WorkerEnv; Variables: AppVariables };

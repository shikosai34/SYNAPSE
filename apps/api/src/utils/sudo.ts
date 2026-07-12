/**
 * SaaS 運営者の権限昇格 (sudo) / なりすまし (impersonation) / 監査 (2026-07-12 Phase D/E)
 *
 * 方針:
 * - super_admin は普段 admin 相当で、テナントの「内容」(メニュー/注文/売上) を見られない。
 * - 機微操作の前にパスキー再認証で 15 分だけ昇格 (sudoSession)。
 * - テナント内容へのアクセスは「なりすまし」経由のみ。なりすまし中は認可を「対象ロール×
 *   スコープ」として評価し、変更操作を監査ログに記録する。
 * - いずれも better-auth のセッション ID (session.session.id) に紐づく (端末=ログイン単位)。
 */
import type { Context, Next } from "hono";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { sudoSession, impersonationSession, auditLog } from "@fesflow/db";
import { apiError } from "../http-error";
import type { Session } from "../types";

export const SUDO_TTL_MS = 15 * 60 * 1000; // 昇格の有効時間
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // なりすましの有効時間
export const FRESH_AUTH_MS = 5 * 60 * 1000; // 「最近再認証した」とみなす猶予

/** better-auth のセッション ID を取り出す。 */
export function betterAuthSessionId(session: Session): string {
  return (session.session as unknown as { id: string }).id;
}

/** セッションが「最近作られた=再認証直後」かどうか (昇格の前提)。 */
export function isFreshlyAuthenticated(session: Session, now: number): boolean {
  const createdAt = (session.session as unknown as { createdAt: Date }).createdAt;
  return now - new Date(createdAt).getTime() <= FRESH_AUTH_MS;
}

/** 有効な昇格 (sudo) セッションを返す。無ければ null。 */
export async function getElevation(c: Context<any>, sessionId: string) {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(sudoSession)
    .where(and(eq(sudoSession.sessionId, sessionId), gt(sudoSession.expiresAt, new Date())));
  return rows[0] ?? null;
}

/** 有効ななりすましセッションを返す。無ければ null。 */
export async function getImpersonation(c: Context<any>, sessionId: string) {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(impersonationSession)
    .where(
      and(
        eq(impersonationSession.sessionId, sessionId),
        gt(impersonationSession.expiresAt, new Date())
      )
    );
  return rows[0] ?? null;
}

/**
 * 現在のリクエストの「実効なりすましコンテキスト」。content 認可 (hasPermission) が使う。
 * 有効ななりすましが無ければ null (=通常の membership ベース認可)。
 */
export async function getImpersonationContext(
  c: Context<any>
): Promise<{ role: string; eventId: string | null; circleId: string | null } | null> {
  const session = c.get("session");
  if (!session) return null;
  const imp = await getImpersonation(c, betterAuthSessionId(session));
  if (!imp) return null;
  return { role: imp.role, eventId: imp.eventId, circleId: imp.circleId };
}

/**
 * 昇格必須 middleware。有効な sudoSession が無ければ 403 SUDO_REQUIRED。
 * requireSuperAdmin の後段で使う (session は設定済み前提)。
 */
export async function requireSudo(c: Context<any>, next: Next) {
  const session = c.get("session");
  if (!session) apiError("UNAUTHORIZED", "認証が必要です");
  const el = await getElevation(c, betterAuthSessionId(session!));
  if (!el) {
    apiError("SUDO_REQUIRED", "この操作にはパスキー再認証による昇格が必要です");
  }
  await next();
}

/** 監査ログを1件記録する。 */
export async function audit(
  c: Context<any>,
  entry: {
    actorEmail: string;
    action: "elevate" | "impersonate_start" | "impersonate_stop" | "impersonated_write";
    asRole?: string | null;
    eventId?: string | null;
    circleId?: string | null;
    method?: string | null;
    path?: string | null;
    summary?: string | null;
  }
) {
  const db = c.get("db");
  await db.insert(auditLog).values({
    id: nanoid(),
    actorEmail: entry.actorEmail.toLowerCase(),
    action: entry.action,
    asRole: entry.asRole ?? null,
    eventId: entry.eventId ?? null,
    circleId: entry.circleId ?? null,
    method: entry.method ?? null,
    path: entry.path ?? null,
    summary: entry.summary ?? null,
  });
}

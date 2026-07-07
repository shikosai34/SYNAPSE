/**
 * 認証レート制限 / アカウントロックアウト (2026-07-05 追加, 監査 High: H4)
 *
 * 元々は PIN 総当たり (POST /api/memberships/authenticate-pin) とサークルパスワード
 * 総当たり (POST /api/festivals/login) のオンライン総当たりを抑止するために作った
 * 共通ヘルパ。2026-07-07 (Phase 3a) でこの2ルートは廃止されたが、index.ts の
 * better-auth ハンドラ (POST /api/auth/sign-in, /api/auth/sign-up) の IP レート制限に
 * 引き続き使われているため、このファイル自体は残す (pin/circle_login スコープの
 * バケットは使われなくなり、auth スコープのみが現役)。
 *
 * 設計:
 * - 状態は D1 の `auth_attempt` テーブルに保持する (Cloudflare の Rate Limiting binding は
 *   窓が 10s/60s に固定で「5回失敗→15分ロック」を表現できず、ローカル検証性でも劣るため不採用)。
 * - 1 バケット = 1 行。key は scope と識別子を結合した文字列。呼び出し側は通常
 *   「IP バケット」と「対象バケット」の 2 本を渡し、どちらかがロックしたら拒否する。
 * - 判定 (isLocked) は bcrypt 実行前に行い、CPU を使う前に弾く。
 *
 * 注意: D1(SQLite) の read-modify-write は厳密なアトミック性を持たない。極端な高並列時に
 * カウントが数回甘くなり得るが、緩和目的では許容範囲。
 */
import { db, authAttempt } from "@fesflow/db";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Context } from "hono";

/** ロックアウトのしきい値・窓・ロック時間 (既定)。 */
export interface RateLimitConfig {
  /** この回数「以上」失敗するとロックする。 */
  maxFailures: number;
  /** 失敗計数の窓 (ms)。最初の失敗からこの時間を超えると (非ロック時) 計数をリセットする。 */
  windowMs: number;
  /** ロック時間 (ms)。しきい値到達時に now+lockMs までロックする。 */
  lockMs: number;
}

/** 既定: 5 回失敗 / 15 分窓 / 15 分ロック。 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
};

/** レート制限バケット (key = 制限単位, scope = 分類ラベル)。 */
export interface Bucket {
  key: string;
  scope: string;
}

/**
 * クライアント IP を最善努力で取得する。
 * 本番 (Cloudflare) は CF-Connecting-IP が入る。ローカル (wrangler dev) では付かないため
 * X-Forwarded-For → "unknown" とフォールバックする ("unknown" 共有バケットで局所検証も可能)。
 */
export function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * 渡した key 群のいずれかが現在ロック中かを判定する。
 * @returns ロック中なら解除までの残り秒数 (最大値)。未ロックなら 0。
 */
export async function isLocked(keys: string[], now = Date.now()): Promise<number> {
  if (keys.length === 0) return 0;
  const rows = await db
    .select()
    .from(authAttempt)
    .where(inArray(authAttempt.key, keys));
  let retryAfterSec = 0;
  for (const r of rows) {
    if (r.lockedUntil && r.lockedUntil.getTime() > now) {
      const sec = Math.ceil((r.lockedUntil.getTime() - now) / 1000);
      if (sec > retryAfterSec) retryAfterSec = sec;
    }
  }
  return retryAfterSec;
}

/**
 * 各バケットに失敗を 1 件記録する。しきい値に達したバケットはロックする。
 * 窓 (windowMs) を過ぎており、かつ非ロックなら計数をリセットして 1 から数え直す。
 */
export async function recordFailure(
  buckets: Bucket[],
  cfg: RateLimitConfig = DEFAULT_RATE_LIMIT,
  now = Date.now(),
): Promise<void> {
  for (const b of buckets) {
    const existing = (
      await db.select().from(authAttempt).where(eq(authAttempt.key, b.key))
    )[0];

    if (!existing) {
      await db.insert(authAttempt).values({
        id: nanoid(),
        key: b.key,
        scope: b.scope,
        failedCount: 1,
        firstFailedAt: new Date(now),
        lastFailedAt: new Date(now),
        lockedUntil: null,
      });
      continue;
    }

    const lockActive = !!existing.lockedUntil && existing.lockedUntil.getTime() > now;
    const windowElapsed = now - existing.firstFailedAt.getTime() > cfg.windowMs;

    // 窓を過ぎ、かつロック中でなければ新しい窓として数え直す。
    const resetWindow = windowElapsed && !lockActive;
    const failedCount = resetWindow ? 1 : existing.failedCount + 1;
    const firstFailedAt = resetWindow ? new Date(now) : existing.firstFailedAt;

    // しきい値到達で (再)ロック。未到達でも既存ロックが生きていれば維持する。
    const lockedUntil =
      failedCount >= cfg.maxFailures
        ? new Date(now + cfg.lockMs)
        : lockActive
          ? existing.lockedUntil
          : null;

    await db
      .update(authAttempt)
      .set({ failedCount, firstFailedAt, lastFailedAt: new Date(now), lockedUntil })
      .where(eq(authAttempt.key, b.key));
  }
}

/**
 * 認証成功時に、対象バケットの失敗履歴を消去する (正当な利用者を巻き込まないため)。
 */
export async function clearAttempts(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(authAttempt).where(inArray(authAttempt.key, keys));
}

/**
 * 429 応答の日本語メッセージを組み立てる。
 */
export function lockoutMessage(retryAfterSec: number): string {
  const min = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `試行回数が上限に達しました。約${min}分後に再度お試しください。`;
}

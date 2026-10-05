/**
 * 認証失敗の識別子別バックオフ (2026-07-05 追加, 監査 High: H4)
 *
 * 元々は PIN 総当たり (POST /api/memberships/authenticate-pin) とサークルパスワード
 * 総当たり (POST /api/festivals/login) のオンライン総当たりを抑止するために作った
 * 共通ヘルパ。2026-07-07 (Phase 3a) でこの2ルートは廃止されたが、index.ts の
 * better-auth の認証失敗をログイン識別子別に段階遅延するために使う。
 *
 * 設計:
 * - 状態は D1 の `auth_attempt` テーブルに保持する (Cloudflare の Rate Limiting binding は
 *   窓が 10s/60s に固定で「5回失敗→15分ロック」を表現できず、ローカル検証性でも劣るため不採用)。
 * - 1 識別子 = 1 行。生のメールアドレスやパスキーIDは保存せず、secret付きHMACをkeyにする。
 * - 認証失敗後は1, 2, 4, 8...秒と待機を延ばし、最大60秒で頭打ちにする。共有NATの
 *   1人の失敗で同じIPの他の利用者を止めない。
 *
 * 2026-10-03: #94 の判断に従い、IP単位ロックを廃止して識別子別の段階遅延へ変更する。
 * 失敗記録はUPSERT一文で原子的に更新し、認証識別子の生値をD1へ残さない。
 */
import { authAttempt, type DB } from "@fesflow/db";
import { inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

// 2026-07-08 (Phase5): db はモジュール Proxy ではなく引数で受け取る。
// retryAfterSeconds/recordFailure/clearAttempts は Context を持たないトップレベル関数のため、
// (計画の「c を受け取らないトップレベル関数は db を引数で受け取る」方針に従い) 呼び出し側
// (index.ts の better-auth ハンドラ) から c.get("db") を渡してもらう形に変更した。

/** 認証失敗の段階遅延と計数窓。 */
export interface RateLimitConfig {
  /** 失敗計数の窓 (ms)。期限後の失敗は新しい窓として扱う。 */
  windowMs: number;
  /** 最初の失敗後の待機時間。以後は指数的に伸ばす。 */
  baseDelayMs: number;
  /** 待機時間の上限。長時間のアカウントロックにはしない。 */
  maxDelayMs: number;
}

/** 既定: 15分窓、1秒から開始し最大60秒まで段階的に遅らせる。 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  baseDelayMs: 1000,
  maxDelayMs: 60 * 1000,
};

/** レート制限バケット (key = 制限単位, scope = 分類ラベル)。 */
export interface Bucket {
  key: string;
  scope: string;
}

/** 認証リクエスト中で既知のログイン識別子が取得できる場合だけ、個人別バケットを返す。 */
export async function authAttemptBucket(request: Request, path: string, secret: string | undefined): Promise<Bucket | null> {
  if (request.method !== "POST" || !secret) return null;
  const isPasskeyVerify = path.endsWith("/passkey/verify-authentication");
  const isEmailAuth = path.endsWith("/sign-in/email") || path.endsWith("/sign-up/email");
  if (!isPasskeyVerify && !isEmailAuth) return null;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32 * 1024) return null;
  const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
  const response = body?.response as Record<string, unknown> | undefined;
  const candidate = isPasskeyVerify ? response?.id : body?.email;
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 2048) return null;

  const scope = isPasskeyVerify ? "passkey" : "email";
  const identity = isPasskeyVerify ? candidate : candidate.trim().toLowerCase();
  return { key: await identityAttemptKey(secret, scope, identity), scope };
}

/** 生のログイン識別子を残さず、環境secretで照合可能なバケットkeyを作る。 */
export async function identityAttemptKey(secret: string, scope: string, identity: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${scope}:${identity}`));
  const digest = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `auth:${scope}:${digest}`;
}

/**
 * 渡した key 群のいずれかが現在ロック中かを判定する。
 * @returns ロック中なら解除までの残り秒数 (最大値)。未ロックなら 0。
 */
export async function retryAfterSeconds(db: DB, keys: string[], now = Date.now()): Promise<number> {
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
 * 各識別子の失敗を原子的に記録し、待機を倍々に延ばす。期限を越えた窓は1回目から再開する。
 */
export async function recordFailure(
  db: DB,
  buckets: Bucket[],
  cfg: RateLimitConfig = DEFAULT_RATE_LIMIT,
  now = Date.now(),
): Promise<void> {
  for (const b of buckets) {
    // 2026-10-03 (#94): SELECT→UPDATE間の取りこぼしを避け、現在のDB行から遅延を原子的に更新する。
    const resetWindow = sql`(${now} - ${authAttempt.firstFailedAt} > ${cfg.windowMs}
      AND (${authAttempt.lockedUntil} IS NULL OR ${authAttempt.lockedUntil} <= ${now}))`;
    const exponent = sql`CASE WHEN ${resetWindow} THEN 0 ELSE MIN(${authAttempt.failedCount}, 30) END`;
    const nextDelayMs = sql`MIN(${cfg.maxDelayMs}, ${cfg.baseDelayMs} * (1 << ${exponent}))`;
    await db.insert(authAttempt).values({
      id: nanoid(), key: b.key, scope: b.scope, failedCount: 1,
      firstFailedAt: new Date(now), lastFailedAt: new Date(now),
      lockedUntil: new Date(now + cfg.baseDelayMs),
    }).onConflictDoUpdate({
      target: authAttempt.key,
      set: {
        failedCount: sql`CASE WHEN ${resetWindow} THEN 1 ELSE ${authAttempt.failedCount} + 1 END`,
        firstFailedAt: sql`CASE WHEN ${resetWindow} THEN ${now} ELSE ${authAttempt.firstFailedAt} END`,
        lastFailedAt: new Date(now),
        lockedUntil: sql`${now} + ${nextDelayMs}`,
      },
    });
  }
}

/**
 * 認証成功時に、対象バケットの失敗履歴を消去する (正当な利用者を巻き込まないため)。
 */
export async function clearAttempts(db: DB, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(authAttempt).where(inArray(authAttempt.key, keys));
}

/**
 * 429 応答の日本語メッセージを組み立てる。
 */
export function delayMessage(retryAfterSec: number): string {
  const seconds = Math.max(1, retryAfterSec);
  return `認証に続けて失敗しました。${seconds}秒後に再度お試しください。`;
}

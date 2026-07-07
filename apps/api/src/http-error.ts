/**
 * 統一エラーエンベロープ (Phase4: API契約再設計)
 *
 * 背景: 従来は `c.json({ error: "文字列" }, status)` を135箇所バラバラに手書きしており、
 * フロントは 401/403/429 の区別もバリデーションのフィールド単位エラーも扱えなかった。
 * ここでは:
 *   - AppError: ルートハンドラが `throw` する例外クラス。code/status/fields を保持する。
 *   - apiError(): AppError を直接 throw するのが読みにくい箇所向けのショートハンド。
 *   - registerErrorHandlers(): app.onError / app.notFound に一元的なエンベロープ整形を仕込む。
 *
 * ステータスコードは既存の 135 箇所を移行するにあたり「現状維持」する方針のため、
 * AppError 生成時に明示的な status を渡す (コードから自動導出しない)。
 */
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { nanoid } from "nanoid";
import type { ApiErrorBody, ApiErrorCode } from "@fesflow/config";

/** ルートハンドラから throw する統一エラー。 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  /** 429 応答等で Retry-After ヘッダを付与したい場合に使う (秒)。 */
  readonly retryAfterSec?: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { status?: number; fields?: Record<string, string>; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? DEFAULT_STATUS[code];
    this.fields = opts.fields;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

/** code ごとの既定ステータス (opts.status 省略時のフォールバック)。 */
const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * `throw new AppError(...)` の代わりに使えるショートハンド。
 * 呼び出し側で `return apiError(...)` と書ける (Hono ハンドラの早期 return に馴染む)。
 * 内部的には AppError を throw し、onError で捕捉させる。
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  opts: { status?: number; fields?: Record<string, string>; retryAfterSec?: number } = {},
): never {
  throw new AppError(code, message, opts);
}

/** zValidator 共通 hook 等が組み立てた fields から VALIDATION エラーを投げるショートハンド。 */
export function validationError(fields: Record<string, string>, message = "入力内容を確認してください"): never {
  throw new AppError("VALIDATION", message, { fields });
}

function buildEnvelope(code: ApiErrorCode, message: string, requestId: string, fields?: Record<string, string>): ApiErrorBody {
  return fields ? { code, message, fields, requestId } : { code, message, requestId };
}

/**
 * app.onError / app.notFound に仕込む共通エラーハンドラ群。
 * - AppError: そのまま code/status/fields を使う。
 * - HTTPException (Hono 標準): status から code を逆引きし、message はそのまま使う。
 * - 予期しない例外: 500 INTERNAL に丸め、詳細は画面に出さずサーバログにのみ requestId 付きで出す。
 *
 * better-auth (/api/auth/*) のレスポンスは auth.handler が直接返すため、Hono の onError を
 * 経由しない (auth.handler 内で例外を投げた場合のみこの経路に入り得るが、その場合も
 * このエンベロープで返して問題ない = better-auth 側の「成功レスポンス形状」とは無関係)。
 */
export function registerErrorHandlers(app: Hono<any>): void {
  app.onError((err, c) => {
    const requestId = nanoid();

    if (err instanceof AppError) {
      if (err.retryAfterSec !== undefined) {
        c.header("Retry-After", String(err.retryAfterSec));
      }
      if (err.status >= 500) {
        // 500系は予期しないエラーと同様、requestIdでサーバログを引けるようにしておく
        console.error(requestId, err);
      }
      return c.json(buildEnvelope(err.code, err.message, requestId, err.fields), err.status as any);
    }

    if (err instanceof HTTPException) {
      const code = statusToCode(err.status);
      if (err.status >= 500) console.error(requestId, err);
      return c.json(buildEnvelope(code, err.message || defaultMessage(code), requestId), err.status as any);
    }

    // 予期しない例外: 内部詳細を画面に出さず、サーバログに requestId とともに残す
    console.error(requestId, err);
    return c.json(buildEnvelope("INTERNAL", "サーバーエラーが発生しました", requestId), 500);
  });

  app.notFound((c) => {
    const requestId = nanoid();
    return c.json(buildEnvelope("NOT_FOUND", "指定されたエンドポイントが見つかりません", requestId), 404);
  });
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL" : "BAD_REQUEST";
  }
}

function defaultMessage(code: ApiErrorCode): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "認証が必要です";
    case "FORBIDDEN":
      return "権限がありません";
    case "NOT_FOUND":
      return "見つかりません";
    case "CONFLICT":
      return "競合が発生しました";
    case "RATE_LIMITED":
      return "しばらく待ってから再度お試しください";
    case "VALIDATION":
    case "BAD_REQUEST":
      return "リクエストが不正です";
    default:
      return "サーバーエラーが発生しました";
  }
}

/** ルート内で c.json({error}, status) の代わりに使う軽量ヘルパ (呼び出し側の書き換え用)。 */
export type { ApiErrorCode };

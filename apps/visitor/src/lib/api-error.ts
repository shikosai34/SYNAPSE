/**
 * フロント側の型付き API エラー (Phase4: API契約再設計)
 *
 * 背景: 従来の fetchApi は失敗時に必ず `new Error(文字列)` に潰しており、401/403/429 の
 * 区別もバリデーションのフィールド単位エラーも扱えなかった。ここでは apps/api の
 * 統一エラーエンベロープ ({ code, message, fields?, requestId }, @fesflow/config の
 * ApiErrorBody) をそのままプロパティとして保持する ApiError を定義し、
 * lib/api.ts の fetchApi と providers.tsx の共通 onError から利用する。
 *
 * visitor はログイン画面を持たない (リストバンド/QRのベアラー認証のみ) ため、
 * 401 の UX 分岐は register ほど作り込まず、トースト表示に留める (register 側の
 * ログイン誘導ロジックは移植しない)。
 */
import { toast } from "sonner";
import type { ApiErrorBody, ApiErrorCode } from "@fesflow/config";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | "NETWORK";
  readonly fields?: Record<string, string>;
  readonly requestId?: string;
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    opts: {
      status: number;
      code: ApiErrorCode | "NETWORK";
      fields?: Record<string, string>;
      requestId?: string;
      retryAfterSec?: number;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.fields = opts.fields;
    this.requestId = opts.requestId;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

/** fetch の Response (!ok) からエラー本文をエンベロープとしてパースし、ApiError を組み立てる。 */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const retryAfterHeader = response.headers.get("Retry-After");
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : undefined;

  const body = await response.json().catch(() => null) as Partial<ApiErrorBody> | null;

  if (body && typeof body.code === "string" && typeof body.message === "string") {
    return new ApiError(body.message, {
      status: response.status,
      code: body.code,
      fields: body.fields,
      requestId: body.requestId,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    });
  }

  const fallbackMessage =
    (body as { error?: string; message?: string } | null)?.error ??
    (body as { error?: string; message?: string } | null)?.message ??
    `通信エラーが発生しました (status: ${response.status})`;
  return new ApiError(fallbackMessage, {
    status: response.status,
    code: statusToFallbackCode(response.status),
  });
}

function statusToFallbackCode(status: number): ApiErrorCode {
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
      return "INTERNAL";
  }
}

/** ネットワーク断・fetch自体の失敗時に使う ApiError。デバッグ用に元の例外を cause に保持する。 */
export function networkApiError(cause?: unknown): ApiError {
  const err = new ApiError("サーバー通信エラー: ネットワーク接続を確認してください", {
    status: 0,
    code: "NETWORK",
  });
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
  return err;
}

/** fields を「フィールド: メッセージ」の複数行にまとめる (トースト表示用の最低限のフォールバック)。 */
export function formatFieldsForToast(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([field, message]) => (field === "_root" ? message : `${field}: ${message}`))
    .join("\n");
}

/**
 * QueryCache/MutationCache の onError から使う共通ハンドラ (最低限の UX 分岐)。
 * visitor はログイン画面を持たないため 401 でもログイン誘導はせず、他コードと同様に
 * トースト表示のみ行う (register の handleApiErrorToast と異なる点)。
 */
export function handleApiErrorToast(error: unknown, opts: { toastId?: string } = {}): void {
  if (!(error instanceof ApiError)) {
    toast.error(error instanceof Error ? error.message : "予期しないエラーが発生しました");
    return;
  }

  if (error.code === "RATE_LIMITED") {
    const sec = error.retryAfterSec;
    const suffix = sec ? ` (あと${sec}秒後に再試行できます)` : "";
    toast.error(`${error.message}${suffix}`, { id: opts.toastId });
    return;
  }

  if (error.code === "VALIDATION" && error.fields && Object.keys(error.fields).length > 0) {
    toast.error(`${error.message}\n${formatFieldsForToast(error.fields)}`, { id: opts.toastId });
    return;
  }

  // UNAUTHORIZED/FORBIDDEN を含め、その他は従来どおりメッセージをトースト表示。
  // requestId があればサポート問い合わせ時にログと突き合わせられるよう小さく添える。
  const suffix = error.requestId ? ` (ID: ${error.requestId})` : "";
  toast.error(`${error.message}${suffix}`, { id: opts.toastId });
}

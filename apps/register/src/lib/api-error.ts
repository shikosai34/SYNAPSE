/**
 * フロント側の型付き API エラー (Phase4: API契約再設計)
 *
 * 背景: 従来の fetchApi は失敗時に必ず `new Error(文字列)` に潰しており、401/403/429 の
 * 区別もバリデーションのフィールド単位エラーも扱えなかった。ここでは apps/api の
 * 統一エラーエンベロープ ({ code, message, fields?, requestId }, @fesflow/config の
 * ApiErrorBody) をそのままプロパティとして保持する ApiError を定義し、
 * lib/api.ts の fetchApi と providers.tsx の共通 onError から利用する。
 */
import { toast } from "sonner";
import type { ApiErrorBody, ApiErrorCode } from "@fesflow/config";

export class ApiError extends Error {
  /** HTTP ステータスコード。 */
  readonly status: number;
  /** エラー種別 (UNAUTHORIZED/FORBIDDEN/VALIDATION 等)。ネットワーク断など本文がない場合は "NETWORK"。 */
  readonly code: ApiErrorCode | "NETWORK";
  /** VALIDATION の場合のみ: フィールドパス→日本語メッセージ。 */
  readonly fields?: Record<string, string>;
  /** サーバログと突き合わせるための ID。ネットワークエラー等サーバに届かなかった場合は undefined。 */
  readonly requestId?: string;
  /** RATE_LIMITED の場合の再試行までの秒数 (Retry-After ヘッダ優先、無ければ本文から)。 */
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

  // 統一エンベロープとしてパースできた場合 (code/message が揃っている)
  if (body && typeof body.code === "string" && typeof body.message === "string") {
    return new ApiError(body.message, {
      status: response.status,
      code: body.code,
      fields: body.fields,
      requestId: body.requestId,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    });
  }

  // 移行漏れ・better-auth 等、旧形状 ({ error: string }) やそれ以外の形状のフォールバック。
  // ここに来るのは想定外だが、画面を壊さないよう最低限のメッセージ表示に丸める。
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

// ── UX 分岐 (Phase4) ──────────────────────────────────────────────────────
// register の3スペース (/circle, /event, /sys) はそれぞれ専用の /login を持つため、
// 401 誘導先は現在の URL プレフィックスから決める。/circle/login にログインすれば
// SignInForm が所属を見て自動的に適切なダッシュボードへ飛ばす (sign-in-form.tsx 既存挙動)
// ため、"どのプレフィックスでも /circle/login に飛ばす" という既存ガード (useCircleAuth.tsx の
// CircleAuthGuard 等) の慣習に合わせつつ、callbackUrl だけプレフィックスに応じて渡す。
function loginPathForCurrentSpace(): string {
  if (typeof window === "undefined") return "/circle/login";
  const path = window.location.pathname;
  if (path.startsWith("/event")) return "/event/login";
  if (path.startsWith("/sys")) return "/sys/login";
  return "/circle/login";
}

/** 現在地が既にいずれかのログイン画面かどうか (401ループ防止用)。 */
function isOnLoginPage(): boolean {
  if (typeof window === "undefined") return false;
  return /^\/(circle|event|sys)\/login/.test(window.location.pathname);
}

/**
 * QueryCache/MutationCache の onError や、呼び出し側の catch から使う共通ハンドラ。
 * ApiError の code に応じて UX を分岐する:
 * - UNAUTHORIZED: トーストではなくログイン画面へ誘導 (callbackUrl に現在地を保持)。
 *   ただしログイン画面自身での 401 (better-auth のセッション未確立チェック等、想定内) は
 *   誘導ループになるため何もしない。
 * - FORBIDDEN: 「権限がありません」を明確にトースト表示。
 * - RATE_LIMITED: retryAfterSec から残り秒数をトースト表示。
 * - VALIDATION (fields あり): フィールド内容をまとめてトースト表示 (呼び出し側フォームは
 *   error.fields を個別に参照して各フィールド下に出すことも可能)。
 * - それ以外: 従来どおりメッセージをトースト表示。末尾に requestId を小さく添える。
 */
export function handleApiErrorToast(error: unknown, opts: { toastId?: string } = {}): void {
  if (!(error instanceof ApiError)) {
    toast.error(error instanceof Error ? error.message : "予期しないエラーが発生しました");
    return;
  }

  if (error.code === "UNAUTHORIZED") {
    if (isOnLoginPage()) return; // ログイン画面自身での401はループ防止のため無視
    const callbackUrl = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    const loginPath = loginPathForCurrentSpace();
    if (typeof window !== "undefined") {
      window.location.href = `${loginPath}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    }
    return;
  }

  if (error.code === "FORBIDDEN") {
    toast.error(error.message || "権限がありません", { id: opts.toastId });
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

  // それ以外 (BAD_REQUEST/NOT_FOUND/CONFLICT/INTERNAL/NETWORK): 従来どおりトースト表示。
  // requestId があればサポート問い合わせ時にログと突き合わせられるよう小さく添える。
  const suffix = error.requestId ? ` (ID: ${error.requestId})` : "";
  toast.error(`${error.message}${suffix}`, { id: opts.toastId });
}

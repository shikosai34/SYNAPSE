import { ApiError } from "@/lib/api-error";

// 2026-10-08 Issue #49: 通信/サーバー障害だけを再試行し、競合などの4xxを繰り返さない。
export function isRetryablePreOrderSaveError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export function shouldRetryPreOrderSave(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && isRetryablePreOrderSaveError(error);
}

export function getPreOrderSaveRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  if (error.retryAfterSec === undefined || error.retryAfterSec < 0) return null;
  return error.retryAfterSec * 1000;
}

// 2026-10-08 Issue #49: サーバー指定の待ち時間があれば指数バックオフより優先する。
export function getPreOrderSaveRetryDelay(attempt: number, error: unknown): number {
  return getPreOrderSaveRetryAfterMs(error) ?? Math.min(1000 * 2 ** attempt, 5000);
}

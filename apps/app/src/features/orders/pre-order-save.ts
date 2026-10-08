import { ApiError } from "@/lib/api-error";

// 2026-10-08 Issue #49: 通信/サーバー障害だけを再試行し、競合などの4xxを繰り返さない。
export function isRetryablePreOrderSaveError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export function shouldRetryPreOrderSave(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && isRetryablePreOrderSaveError(error);
}

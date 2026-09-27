// Better Auth が明示した 401 だけを「ログアウト済み」と扱う。
// 通信障害/5xx は保存された所属の失効を意味しないため、権限情報を閉じたまま再試行する (2026-09-27)。
export function isUnauthorizedSessionError(error: { status?: number } | null | undefined): boolean {
  return error?.status === 401;
}

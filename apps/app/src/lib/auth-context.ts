/** アクティブスペースをブラウザータブごとに保存するための小さなストレージ境界。 */
export const AUTH_CONTEXT_KEY = "circleAuth";

export function readAuthContext<T>(): T | null {
  if (typeof window === "undefined") return null;

  // 2026-09-27: localStorage の同一オリジン共有が別タブのスペース選択を上書きするため、
  // タブ固有の sessionStorage を正本にし、旧 localStorage 値は初回だけ移行する。
  const session = window.sessionStorage;
  const stored = session.getItem(AUTH_CONTEXT_KEY) ?? window.localStorage.getItem(AUTH_CONTEXT_KEY);
  if (!stored) return null;

  try {
    const context = JSON.parse(stored) as T;
    if (!session.getItem(AUTH_CONTEXT_KEY)) session.setItem(AUTH_CONTEXT_KEY, stored);
    return context;
  } catch {
    return null;
  }
}

export function readLegacyCircleId(): string | null {
  if (typeof window === "undefined") return null;
  const session = window.sessionStorage;
  const circleId = session.getItem("circleId") ?? window.localStorage.getItem("circleId");
  if (circleId && !session.getItem("circleId")) session.setItem("circleId", circleId);
  return circleId;
}

export function writeAuthContext<T extends { circleId?: string | null; circleName?: string | null }>(context: T) {
  if (typeof window === "undefined") return;
  // localStorage に残る旧値が未初期化タブへ誤って復活しないよう、移行時に片付ける。
  window.localStorage.removeItem(AUTH_CONTEXT_KEY);
  window.localStorage.removeItem("circleId");
  window.localStorage.removeItem("circleName");
  window.sessionStorage.setItem(AUTH_CONTEXT_KEY, JSON.stringify(context));
  if (context.circleId) window.sessionStorage.setItem("circleId", context.circleId);
  else window.sessionStorage.removeItem("circleId");
  if (context.circleName) window.sessionStorage.setItem("circleName", context.circleName);
  else window.sessionStorage.removeItem("circleName");
}

export function clearAuthContext() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(AUTH_CONTEXT_KEY);
  window.sessionStorage.removeItem("circleId");
  window.sessionStorage.removeItem("circleName");
  window.localStorage.removeItem(AUTH_CONTEXT_KEY);
  window.localStorage.removeItem("circleId");
  window.localStorage.removeItem("circleName");
}

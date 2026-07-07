import { useEffect, useState } from "react";

/**
 * 来場者セッション (2026-07-04)。
 *
 * 来場者は better-auth の会員ではなく、リストバンド or イベント管理から配布された
 * eventUser.id を「ベアラー」として保持する匿名ユーザー。会員登録・パスワードは無い。
 * ここでは localStorage にその ID と最小プロフィールを保存し、アプリ全体で参照する。
 *
 * 旧 register の useGuestUser はクライアント生成のランダム ID だったが、来場者アプリでは
 * サーバ側 eventUser.id を正本とする (リストバンド紛失時の再紐付けもこの ID 単位)。
 */
export interface VisitorSession {
  userId: string; // eventUser.id (ベアラー)
  wristbandId: string | null;
  eventId: string | null;
  displayId: number | null;
  nickname: string | null;
  onboarded: boolean;
}

const KEY = "fes_visitor";
const EVT = "visitorChange";

export function getVisitor(): VisitorSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VisitorSession;
  } catch {
    return null;
  }
}

export function saveVisitor(s: VisitorSession) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(EVT));
}

export function clearVisitor() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}

export function useVisitor() {
  const [session, setSession] = useState<VisitorSession | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setSession(getVisitor());
    setIsLoaded(true);

    const onChange = () => setSession(getVisitor());
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", (e) => {
      if (e.key === KEY) onChange();
    });
    return () => {
      window.removeEventListener(EVT, onChange);
    };
  }, []);

  return {
    session,
    userId: session?.userId ?? null,
    isEntered: !!session?.userId,
    isOnboarded: !!session?.onboarded,
    isLoaded,
  };
}

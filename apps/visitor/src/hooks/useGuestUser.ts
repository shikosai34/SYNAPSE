import { useEffect, useState } from "react";
import { getVisitor } from "./useVisitor";

/**
 * 来場者セッション ID フック (2026-07-06 改訂)。
 *
 * 「発行しないと使えない」方針により、ランダムなゲスト/閲覧 ID の生成を廃止。
 * 入場済み (リストバンド発行済み = eventUser セッションあり) のときだけ `userId` を返す。
 * 未入場は空文字を返し、メニュー閲覧は許可しつつ注文・機能利用は呼び出し側でゲートする。
 */
export function useGuestUser() {
  const [userId, setUserId] = useState<string>("");
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const v = getVisitor();
    setUserId(v?.userId ?? "");
    setIsLoaded(true);

    const onChange = () => {
      const cur = getVisitor();
      setUserId(cur?.userId ?? "");
    };
    window.addEventListener("visitorChange", onChange);
    return () => window.removeEventListener("visitorChange", onChange);
  }, []);

  return { userId, isLoaded };
}

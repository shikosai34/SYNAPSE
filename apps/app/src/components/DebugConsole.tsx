
// 2026-07-10: スマホでのデバッグ用コンソール (eruda) をスーパー管理者向けに提供するコンポーネント。
// 条件: role === "super_admin" かつ ?debug=true がクエリに含まれる場合のみ有効。
// ページ遷移後もクエリが外れないよう sessionStorage で debug フラグを保持する。
// eruda は CDN から動的に import するため、通常ビルドのバンドルには含まれない。

import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAuthInfo } from "@/hooks/useCircleAuth";

const DEBUG_SESSION_KEY = "fesflow_debug";

/** ?debug=true を sessionStorage に記憶し、以降の遷移でも維持する */
function syncDebugFlag(search: string): boolean {
  const params = new URLSearchParams(search);
  if (params.get("debug") === "true") {
    sessionStorage.setItem(DEBUG_SESSION_KEY, "1");
    return true;
  }
  return sessionStorage.getItem(DEBUG_SESSION_KEY) === "1";
}

/** スマートフォンかどうかの簡易判定 */
function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function DebugConsole() {
  const location = useLocation();
  const navigate = useNavigate();
  const erudaLoadedRef = useRef(false);

  useEffect(() => {
    const authInfo = getAuthInfo();
    const isSuperAdmin = authInfo?.role === "super_admin";
    const debugEnabled = syncDebugFlag(location.search);

    if (!isSuperAdmin || !debugEnabled || !isMobile()) return;
    if (erudaLoadedRef.current) return;

    erudaLoadedRef.current = true;

    // eruda を動的ロード。バンドルに含めずCDNから取得する。
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => {
      // @ts-ignore — eruda はグローバル変数として inject される
      if (typeof eruda !== "undefined") {
        // @ts-ignore
        eruda.init();
      }
    };
    script.onerror = () => {
      console.warn("[DebugConsole] eruda の読み込みに失敗しました");
    };
    document.head.appendChild(script);

    return () => {
      // アンマウント時はスクリプトタグだけ除去。eruda 自体の destroy は副作用が多いため行わない。
      document.head.removeChild(script);
    };
    // location.search が変わるたびに syncDebugFlag を再実行してフラグを更新する
  }, [location.search]);

  // URLに ?debug=true がついていて sessionStorage に保存できたら、
  // クエリを除去して「きれいなURL」に書き換える（ただし debug フラグは維持）
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("debug") === "true") {
      params.delete("debug");
      const newSearch = params.toString();
      // replace で履歴を汚さずに書き換える
      navigate(
        { pathname: location.pathname, search: newSearch ? `?${newSearch}` : "" },
        { replace: true }
      );
    }
  }, [location.pathname, location.search, navigate]);

  // このコンポーネント自体は何も描画しない
  return null;
}

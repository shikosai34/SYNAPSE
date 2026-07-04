import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { saveAuthInfo } from "@/hooks/useCircleAuth";

/**
 * 権限スイッチでの「別ドメイン移動」の受け口 (2026-07-04)。
 * staff. / admin. は別オリジンで localStorage を共有しないため、遷移元が付けた
 * `?_sw=<base64(encodeURIComponent(JSON(authInfo)))>` を復元してから描画する。
 * 認証セッションは api の Cookie で全サブドメイン共通なので、ここではアクティブ
 * スペース(表示ロール等)の localStorage を復元するだけでよい。
 */
(function hydrateSwitchedSpace() {
	try {
		const params = new URLSearchParams(window.location.search);
		const sw = params.get("_sw");
		if (!sw) return;
		const payload = JSON.parse(decodeURIComponent(atob(sw)));
		saveAuthInfo(payload);
		params.delete("_sw");
		const clean =
			window.location.pathname + (params.toString() ? `?${params}` : "") + window.location.hash;
		window.history.replaceState({}, "", clean);
	} catch {
		// 壊れた _sw は無視して通常表示にフォールバック
	}
})();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</StrictMode>,
);

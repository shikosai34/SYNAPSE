import { Navigate } from "react-router-dom";

// 旧 app/circle-login/page.tsx は redirect("/login") のみ。
// 単一ドメイン化 (2026-07-07) で共通ログインは /circle/login へ移設したためそこへ転送。
export default function CircleLogin() {
	return <Navigate to="/circle/login" replace />;
}

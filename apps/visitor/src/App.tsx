import { Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Providers from "@/components/providers";
import SystemGate from "@/components/SystemGate";
import VisitorHeader from "@/components/visitor-header";
import Home from "@/pages/Home";
import Entry from "@/pages/Entry";
import Onboarding from "@/pages/Onboarding";
import Menu from "@/pages/Menu";
import MyPage from "@/pages/MyPage";
import EventMenu from "@/pages/EventMenu";

// 来場者アプリのルート (2026-07-04)。register(サークル/イベント管理)から完全分離。
// 入場は /w/:id (リストバンドQR)。管理者向けの権限/ダッシュボードは一切持たない。
export default function App() {
	return (
		<ErrorBoundary>
		<Providers>
			<SystemGate>
			<div className="grid grid-rows-[auto_1fr] min-h-svh">
				<VisitorHeader />
				<main>
					<Routes>
						<Route path="/" element={<Home />} />
						{/* リストバンド入場 */}
						<Route path="/w/:id" element={<Entry />} />
						<Route path="/onboarding" element={<Onboarding />} />
						{/* イベント メニュー横断閲覧 (下見) */}
						<Route path="/events" element={<EventMenu />} />
						<Route path="/events/:eventId" element={<EventMenu />} />
						<Route path="/menu" element={<Menu />} />
						<Route path="/mypage" element={<MyPage />} />


						<Route path="*" element={<Navigate to="/" replace />} />
					</Routes>
				</main>
			</div>
			</SystemGate>
		</Providers>
		</ErrorBoundary>
	);
}

import { Routes, Route, Outlet, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Providers from "@/components/providers";
import { DebugConsole } from "@/components/DebugConsole";

import Header from "@/components/header";
import SystemBanner from "@/components/SystemBanner";

import SystemGate from "@/components/SystemGate";
import VisitorHeader from "@/components/visitor-header";

import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Backyard from "@/pages/Backyard";
import Checkin from "@/pages/Checkin";
import Invite from "@/pages/Invite";
import Admin from "@/pages/Admin";
import EventDashboard from "@/pages/EventDashboard";
import DashboardIndex from "@/pages/dashboard/Index";
import DashboardCircle from "@/pages/dashboard/Circle";
import DashboardMembers from "@/pages/dashboard/Members";
import DashboardMenu from "@/pages/dashboard/Menu";
import DashboardQr from "@/pages/dashboard/Qr";
import DashboardSales from "@/pages/dashboard/Sales";
import DashboardStaff from "@/pages/dashboard/Staff";
import DashboardStock from "@/pages/dashboard/Stock";
import Placeholder from "@/pages/Placeholder";
import { CircleAuthGuard, SystemAdminGuard, EventAdminGuard } from "@/hooks/useCircleAuth";

import Branding from "@/pages/Branding";
import VisitorHome from "@/pages/VisitorHome";
import Entry from "@/pages/Entry";
import Onboarding from "@/pages/Onboarding";
import Menu from "@/pages/Menu";
import MyPage from "@/pages/MyPage";
import Orders from "@/pages/Orders";
import EventMenu from "@/pages/EventMenu";

function AdminLayout() {
	return (
		<div className="grid grid-rows-[auto_auto_1fr] min-h-svh">
			<Header />
			<SystemBanner />
			<main>
				<Outlet />
			</main>
		</div>
	);
}

function VisitorLayout() {
	return (
		<SystemGate>
			<div className="grid grid-rows-[auto_1fr] min-h-svh">
				<VisitorHeader />
				<main>
					<Outlet />
				</main>
			</div>
		</SystemGate>
	);
}

// ブランディング (/) 用の素のレイアウト。VisitorHeader を出さず、メンテナンス
// ゲートだけ共通で通す (2026-07-11 来場者パスを /visitor に集約しルートをブランド面に)。
function BareLayout() {
	return (
		<SystemGate>
			<Outlet />
		</SystemGate>
	);
}

export default function App() {
	return (
		<ErrorBoundary>
		<Providers>
			{/* 2026-07-10: super_admin + ?debug=true のときスマホでerudaコンソールを有効化 */}
			<DebugConsole />
			<Routes>
				{/* ドメインルートはブランディングページ (VisitorHeader なし) */}
				<Route element={<BareLayout />}>
					<Route path="/" element={<Branding />} />
				</Route>

				{/* 来場者アプリは /visitor/* に集約 (2026-07-11)。
				    入場QR (/w/:id) だけは物理バンド/発行QRに埋め込むスキャン用URLなので
				    短いまま据え置く。 */}
				<Route element={<VisitorLayout />}>
					<Route path="/w/:id" element={<Entry />} />

					<Route path="/visitor" element={<VisitorHome />} />
					<Route path="/visitor/onboarding" element={<Onboarding />} />
					<Route path="/visitor/mypage" element={<MyPage />} />
					<Route path="/visitor/orders" element={<Orders />} />

					{/* Visitor event / menu routes */}
					<Route path="/visitor/events" element={<EventMenu />} />
					<Route path="/visitor/events/:eventId" element={<EventMenu />} />
					<Route path="/visitor/menu" element={<Menu />} />

					{/* URL 統一対応 (pretty URL も /visitor 配下) */}
					<Route path="/visitor/:eventName" element={<EventMenu />} />
					<Route path="/visitor/:eventName/:circleName" element={<Menu />} />
					<Route path="/visitor/:eventName/:circleName/menu" element={<Menu />} />
				</Route>

				<Route element={<AdminLayout />}>
					{/* 管理用トップ */}
					<Route path="/sys" element={<Home />} />
					
					{/* 統合ログイン */}
					<Route path="/login" element={<Login />} />

					<Route
						path="/sys/dashboard"
						element={
							<SystemAdminGuard>
								<Admin />
							</SystemAdminGuard>
						}
					/>

					<Route
						path="/event/dashboard"
						element={
							<EventAdminGuard>
								<EventDashboard />
							</EventAdminGuard>
						}
					/>

					<Route path="/circle/checkin" element={<Checkin />} />
					<Route path="/circle/invite/:token" element={<Invite />} />
					<Route
						path="/circle/register"
						element={
							<CircleAuthGuard>
								<Register />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/backyard"
						element={
							<CircleAuthGuard>
								<Backyard />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard"
						element={
							<CircleAuthGuard>
								<DashboardIndex />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/circle"
						element={
							<CircleAuthGuard>
								<DashboardCircle />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/members"
						element={
							<CircleAuthGuard>
								<DashboardMembers />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/menu"
						element={
							<CircleAuthGuard>
								<DashboardMenu />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/qr"
						element={
							<CircleAuthGuard>
								<DashboardQr />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/sales"
						element={
							<CircleAuthGuard>
								<DashboardSales />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/staff"
						element={
							<CircleAuthGuard>
								<DashboardStaff />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/stock"
						element={
							<CircleAuthGuard>
								<DashboardStock />
							</CircleAuthGuard>
						}
					/>

					<Route path="*" element={<Placeholder />} />
				</Route>
			</Routes>
		</Providers>
		</ErrorBoundary>
	);
}

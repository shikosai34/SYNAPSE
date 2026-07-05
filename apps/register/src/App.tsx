import { Routes, Route, Navigate } from "react-router-dom";
import Providers from "@/components/providers";
import Header from "@/components/header";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import CircleLogin from "@/pages/CircleLogin";
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
import DashboardMods from "@/pages/dashboard/Mods";
import DashboardQr from "@/pages/dashboard/Qr";
import DashboardSales from "@/pages/dashboard/Sales";
import DashboardStaff from "@/pages/dashboard/Staff";
import DashboardStock from "@/pages/dashboard/Stock";
import Placeholder from "@/pages/Placeholder";
import ExternalRedirect, { VISITOR_BASE_URL } from "@/components/external-redirect";
import { CircleAuthGuard, SystemAdminGuard, EventAdminGuard } from "@/hooks/useCircleAuth";

export default function App() {
	return (
		<Providers>
			<div className="grid grid-rows-[auto_1fr] min-h-svh">
				<Header />
				<main>
					<Routes>
						{/* パブリック / 共通ルート */}
						<Route path="/" element={<Home />} />
						<Route path="/login" element={<Login />} />
						<Route path="/circle-login" element={<CircleLogin />} />
						<Route path="/checkin" element={<Checkin />} />
						<Route path="/invite/:token" element={<Invite />} />
						{/* 2026-07-05: 開発用デバッグ画面 /test-wristbands (TestWristbands) を撤去。
						    wb_admin_001 等のテスト用リストバンドを列挙する画面で本番不要のため削除。 */}

						{/* 来場者機能は apps/visitor へ分離。旧パスは来場者アプリへ転送 (2026-07-04) */}
						<Route path="/visitor/menu" element={<ExternalRedirect to={`${VISITOR_BASE_URL}/menu`} />} />
						<Route path="/visitor/my-qr" element={<ExternalRedirect to={`${VISITOR_BASE_URL}/mypage`} />} />

						{/* サークル専用ルート (/circle/*) */}
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
							path="/circle/dashboard/mods"
							element={
								<CircleAuthGuard>
									<DashboardMods />
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

						{/* イベント管理者専用ルート (/event/*) */}
						<Route
							path="/event/dashboard"
							element={
								<EventAdminGuard>
									<EventDashboard />
								</EventAdminGuard>
							}
						/>

						{/* システム管理者専用ルート (/admin/*) */}
						<Route
							path="/admin/dashboard"
							element={
								<SystemAdminGuard>
									<Admin />
								</SystemAdminGuard>
							}
						/>

						{/* 後方互換・リダイレクト処理 */}
						<Route path="/menu" element={<ExternalRedirect to={`${VISITOR_BASE_URL}/menu`} />} />
						<Route path="/my-order" element={<ExternalRedirect to={`${VISITOR_BASE_URL}/mypage`} />} />
						<Route path="/register" element={<Navigate to="/circle/register" replace />} />
						<Route path="/backyard" element={<Navigate to="/circle/backyard" replace />} />
						<Route path="/dashboard" element={<Navigate to="/circle/dashboard" replace />} />
						<Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

						<Route path="*" element={<Placeholder />} />
					</Routes>
				</main>
			</div>
		</Providers>
	);
}

import { Routes, Route, Outlet, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Providers from "@/components/providers";

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

import VisitorHome from "@/pages/VisitorHome";
import Entry from "@/pages/Entry";
import Onboarding from "@/pages/Onboarding";
import Menu from "@/pages/Menu";
import MyPage from "@/pages/MyPage";
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

export default function App() {
	return (
		<ErrorBoundary>
		<Providers>
			<Routes>
				<Route element={<VisitorLayout />}>
					<Route path="/" element={<VisitorHome />} />
					
					<Route path="/w/:id" element={<Entry />} />
					<Route path="/onboarding" element={<Onboarding />} />
					<Route path="/mypage" element={<MyPage />} />
					
					{/* Visitor event / menu routes */}
					<Route path="/events" element={<EventMenu />} />
					<Route path="/events/:eventId" element={<EventMenu />} />
					<Route path="/menu" element={<Menu />} />

					{/* URL 統一対応 */}
					<Route path="/:eventName" element={<EventMenu />} />
					<Route path="/:eventName/:circleName" element={<Menu />} />
					<Route path="/:eventName/:circleName/menu" element={<Menu />} />
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

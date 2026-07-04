import { Routes, Route } from "react-router-dom";
import Providers from "@/components/providers";
import Header from "@/components/header";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import CircleLogin from "@/pages/CircleLogin";
import Register from "@/pages/Register";
import Backyard from "@/pages/Backyard";
import Menu from "@/pages/Menu";
import MyOrder from "@/pages/MyOrder";
import Checkin from "@/pages/Checkin";
import Invite from "@/pages/Invite";
import Admin from "@/pages/Admin";
import TestWristbands from "@/pages/TestWristbands";
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

/**
 * register (模擬店向け) SPA のルート。
 * Next.js App Router から React Router へ移行 (2026-07-04)。
 * 旧 app/ の各 page.tsx を pages/ へ移植し、next/link・next/image・
 * next/script・next/navigation は互換シム経由で解決している。
 */
export default function App() {
	return (
		<Providers>
			<div className="grid grid-rows-[auto_1fr] min-h-svh">
				<Header />
				<main>
					<Routes>
						<Route path="/" element={<Home />} />
						<Route path="/login" element={<Login />} />
						<Route path="/circle-login" element={<CircleLogin />} />
						<Route path="/register" element={<Register />} />
						<Route path="/backyard" element={<Backyard />} />
						<Route path="/menu" element={<Menu />} />
						<Route path="/my-order" element={<MyOrder />} />
						<Route path="/checkin" element={<Checkin />} />
						<Route path="/invite/:token" element={<Invite />} />
						<Route path="/admin" element={<Admin />} />
						<Route path="/test-wristbands" element={<TestWristbands />} />
						<Route path="/dashboard" element={<DashboardIndex />} />
						<Route path="/dashboard/circle" element={<DashboardCircle />} />
						<Route path="/dashboard/members" element={<DashboardMembers />} />
						<Route path="/dashboard/menu" element={<DashboardMenu />} />
						<Route path="/dashboard/mods" element={<DashboardMods />} />
						<Route path="/dashboard/qr" element={<DashboardQr />} />
						<Route path="/dashboard/sales" element={<DashboardSales />} />
						<Route path="/dashboard/staff" element={<DashboardStaff />} />
						<Route path="/dashboard/stock" element={<DashboardStock />} />
						<Route path="*" element={<Placeholder />} />
					</Routes>
				</main>
			</div>
		</Providers>
	);
}

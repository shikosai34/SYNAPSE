import { Routes, Route } from "react-router-dom";
import Providers from "@/components/providers";
import Header from "@/components/header";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import CircleLogin from "@/pages/CircleLogin";
import Register from "@/pages/Register";
import Backyard from "@/pages/Backyard";
import Placeholder from "@/pages/Placeholder";

/**
 * register (模擬店向け) SPA のルート。
 * Next.js App Router から React Router へ移行中 (2026-07-04)。
 * 移植済みページのみ実ルートに配線し、未移植は Placeholder に集約する。
 * 移植が進むごとに Route を差し替えていく。
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
						{/* 以下は Phase3 で順次移植: /menu /my-order
						    /dashboard/* /admin など */}
						<Route path="*" element={<Placeholder />} />
					</Routes>
				</main>
			</div>
		</Providers>
	);
}

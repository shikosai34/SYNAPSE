import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Outlet, Navigate, useSearchParams } from "react-router-dom";
import { useVisitor } from "@/hooks/useVisitor";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Providers from "@/components/providers";
import { DebugConsole } from "@/components/DebugConsole";

import Header from "@/components/header";
import SystemBanner from "@/components/SystemBanner";

import SystemGate from "@/components/SystemGate";
import VisitorHeader from "@/components/visitor-header";
import Loader from "@/components/loader";

import { CircleAuthGuard, SystemAdminGuard, EventAdminGuard } from "@/hooks/useCircleAuth";
import { ImpersonationBanner } from "@/components/system/ImpersonationBanner";

// 2026-07-15: オフライン対応（スタッフ側）のためのプリロード対象および lazy 定義。
// 来場者とスタッフ画面を切り分けるため、インポート用関数をオブジェクトにまとめて管理する。
const pageImports = {
	// スタッフ・管理者用画面 (プリロード対象)
	Home: () => import("@/pages/Home"),
	Login: () => import("@/pages/Login"),
	Register: () => import("@/pages/Register"),
	Backyard: () => import("@/pages/Backyard"),
	Checkin: () => import("@/pages/Checkin"),
	Invite: () => import("@/pages/Invite"),
	Admin: () => import("@/pages/Admin"),
	EventDashboard: () => import("@/pages/EventDashboard"),
	DashboardIndex: () => import("@/pages/dashboard/Index"),
	DashboardCircle: () => import("@/pages/dashboard/Circle"),
	DashboardMembers: () => import("@/pages/dashboard/Members"),
	DashboardMenu: () => import("@/pages/dashboard/Menu"),
	DashboardQr: () => import("@/pages/dashboard/Qr"),
	DashboardSales: () => import("@/pages/dashboard/Sales"),
	DashboardStaff: () => import("@/pages/dashboard/Staff"),
	DashboardStock: () => import("@/pages/dashboard/Stock"),
	DashboardAnalytics: () => import("@/pages/dashboard/Analytics"),
	DashboardExport: () => import("@/pages/dashboard/Export"),
	StaffOnboarding: () => import("@/pages/StaffOnboarding"),
	Placeholder: () => import("@/pages/Placeholder"),

	// 来場者用画面 (基本プリロード不要)
	Branding: () => import("@/pages/Branding"),
	VisitorHome: () => import("@/pages/VisitorHome"),
	Entry: () => import("@/pages/Entry"),
	Onboarding: () => import("@/pages/Onboarding"),
	Menu: () => import("@/pages/Menu"),
	MyPage: () => import("@/pages/MyPage"),
	Orders: () => import("@/pages/Orders"),
	EventMenu: () => import("@/pages/EventMenu"),
};

// Lazy コンポーネント定義
const Home = lazy(pageImports.Home);
const Login = lazy(pageImports.Login);
const Register = lazy(pageImports.Register);
const Backyard = lazy(pageImports.Backyard);
const Checkin = lazy(pageImports.Checkin);
const Invite = lazy(pageImports.Invite);
const Admin = lazy(pageImports.Admin);
const EventDashboard = lazy(pageImports.EventDashboard);
const DashboardIndex = lazy(pageImports.DashboardIndex);
const DashboardCircle = lazy(pageImports.DashboardCircle);
const DashboardMembers = lazy(pageImports.DashboardMembers);
const DashboardMenu = lazy(pageImports.DashboardMenu);
const DashboardQr = lazy(pageImports.DashboardQr);
const DashboardSales = lazy(pageImports.DashboardSales);
const DashboardStaff = lazy(pageImports.DashboardStaff);
const DashboardStock = lazy(pageImports.DashboardStock);
const DashboardAnalytics = lazy(pageImports.DashboardAnalytics);
const DashboardExport = lazy(pageImports.DashboardExport);
const Placeholder = lazy(pageImports.Placeholder);

const Branding = lazy(pageImports.Branding);
const VisitorHome = lazy(pageImports.VisitorHome);
const Entry = lazy(pageImports.Entry);
const Onboarding = lazy(pageImports.Onboarding);
const StaffOnboarding = lazy(pageImports.StaffOnboarding);
const Menu = lazy(pageImports.Menu);
const MyPage = lazy(pageImports.MyPage);
const Orders = lazy(pageImports.Orders);
const EventMenu = lazy(pageImports.EventMenu);

// スタッフ用画面のプリロード関数
// 2026-07-15: スタッフ画面の読み込み開始時に、オフライン下での操作（タブ切り替え等）で ChunkLoadError が起きるのを防ぐため、
// 関連モジュールをバックグラウンドで一括ダウンロードする。
export function preloadStaffPages() {
	const staffKeys: (keyof typeof pageImports)[] = [
		"Home", "Login", "Register", "Backyard", "Checkin", "Invite", "Admin", 
		"EventDashboard", "DashboardIndex", "DashboardCircle", "DashboardMembers", 
		"DashboardMenu", "DashboardQr", "DashboardSales", "DashboardStaff", 
		"DashboardStock", "DashboardAnalytics", "DashboardExport", "StaffOnboarding", "Placeholder"
	];
	
	staffKeys.forEach((key) => {
		pageImports[key]().catch((err) => console.error(`Preload failed for ${key}:`, err));
	});
}

function AdminLayout() {
	// 2026-07-15: スタッフ用管理画面に入った時点で、オフライン運用に備えてバックグラウンドで全スタッフ画面モジュールをプリロードする。
	useEffect(() => {
		if (typeof window !== "undefined") {
			if ("requestIdleCallback" in window) {
				(window as any).requestIdleCallback(() => preloadStaffPages());
			} else {
				setTimeout(preloadStaffPages, 1000);
			}
		}
	}, []);

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

// 来場者のオンボーディング必須ゲート (2026-07-15)。
// デジタルQRの発行(/visitor/mypage?action=issue)は eventUser を onboarded:false で作るため、
// 発行後にニックネーム/お好きな日付を入れずマイページ・注文履歴へ素通りできてしまっていた。
// 入場済み(セッションあり)なのに未オンボーディングの来場者は、パーソナライズ画面に入る前に
// オンボーディングへ強制送還する。メニュー閲覧(/visitor/events, /visitor/menu)は誰でも自由なので
// このゲートは掛けない — マイページ/注文履歴のみを保護する。
function VisitorOnboardingGate() {
	const { isLoaded, isEntered, isOnboarded } = useVisitor();
	const [searchParams] = useSearchParams();

	// セッション判定は localStorage の読み込み後に確定する。読み込み前は子側のスケルトンに任せる。
	if (!isLoaded) return <Outlet />;

	// 発行アクション中は MyPage 自身が「発行 → オンボーディング遷移」を担うので素通しする
	// (ここで先回りしてリダイレクトすると発行処理そのものが走らなくなる)。
	if (searchParams.get("action") === "issue") return <Outlet />;

	if (isEntered && !isOnboarded) {
		return <Navigate to="/visitor/onboarding" replace />;
	}
	return <Outlet />;
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
			{/* なりすまし中は全ページ最上部にバナーを出す (Phase E) */}
			<ImpersonationBanner />
			<Suspense fallback={<Loader />}>
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

					{/* マイページ・注文履歴はオンボーディング必須ゲートで保護する */}
					<Route element={<VisitorOnboardingGate />}>
						<Route path="/visitor/mypage" element={<MyPage />} />
						<Route path="/visitor/orders" element={<Orders />} />
					</Route>

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

					{/* スタッフ用オンボーディング (所属ゼロの新規アカウントがサークルをセルフ作成) */}
					<Route path="/onboarding" element={<StaffOnboarding />} />
					{/* 招待コード単体のディープリンク (/join?code=XXXX)。口頭/チャットで配るコードから直接着地できる (2026-07-14 P0) */}
					<Route path="/join" element={<StaffOnboarding />} />

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
					{/* イベント招待 (共同管理者 / サークルホスト) も同じ受諾ページで種別判定する */}
					<Route path="/event/invite/:token" element={<Invite />} />
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
						path="/circle/dashboard/analytics"
						element={
							<CircleAuthGuard>
								<DashboardAnalytics />
							</CircleAuthGuard>
						}
					/>
					<Route
						path="/circle/dashboard/export"
						element={
							<CircleAuthGuard>
								<DashboardExport />
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
			</Suspense>
		</Providers>
		</ErrorBoundary>
	);
}

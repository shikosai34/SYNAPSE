import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { circleApi, eventApi, parseCircleSettings } from "@/lib/api";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Package,
  TrendingUp,
  Users,
  Settings,
  UserCheck,
  QrCode,
  Grid,
  Shield,
  Calendar,
  Lock,
  Smartphone,
  Megaphone,
  Wrench,
  ScrollText,
  BarChart3,
  MonitorCheck,
  Boxes,
  Calculator,
  CalendarCheck,
  Ticket,
  ChevronDown,
  ChevronUp,
  Download,
  IdCard,
  Activity,
  CreditCard,
} from "lucide-react";

interface MenuItem {
  title: string;
  href?: string;
  tab?: string;
  icon: any;
}

interface DashboardLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  type: "circle" | "event" | "system";
  activeTab?: string; // event/system でタブ制御する場合
  onTabChange?: (tab: string) => void;
  // 画面の主要アクション (追加/招待/更新など) をヘッダー右側に集約するスロット。
  // これを使うことで、各ページが children 内に独自の見出し行+ボタンを重ねて
  // 二重ヘッダーになるのを防ぎ、全ダッシュボード画面でボタン位置を統一する (2026-07-11)
  actions?: ReactNode;
  // イベントの抽選機能が有効なとき「抽選」タブを出す (2026-07-12)
  lotteryEnabled?: boolean;
  // type==="event" のとき対象イベントID。閲覧のみモードの判定に使う (2026-07-16)。
  // circle の場合はサークルから eventId を解決するので不要。
  eventId?: string;
}

export default function DashboardLayout({
  children,
  title,
  subtitle,
  type,
  activeTab,
  onTabChange,
  actions,
  lotteryEnabled,
  eventId,
}: DashboardLayoutProps) {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [circleId, setCircleId] = useState<string>("");

  useEffect(() => {
    if (type !== "circle") return;
    const stored = localStorage.getItem("circleId");
    if (stored) setCircleId(stored);
  }, [type]);

  // 拡張機能(在庫/スタッフ)のON/OFF判定のためサークル設定を取得
  const { data: circle } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: type === "circle" && !!circleId,
  });
  const circleSettings = parseCircleSettings(circle?.settings);

  // 閲覧のみモード (2026-07-16)。イベントが終了/保持中なら配下の変更操作はサーバで拒否されるため、
  // 全ダッシュボード共通のこの場所で理由を明示する (各画面に個別実装しないで済む)。
  // event 型は親から eventId をもらい、circle 型はサークルから親イベントを解決する。
  const resolvedEventId = type === "event" ? eventId : circle?.eventId;
  const { data: layoutEvent } = useQuery({
    queryKey: ["event", resolvedEventId],
    queryFn: () => eventApi.get(resolvedEventId!),
    enabled: !!resolvedEventId,
  });
  const lifecycle = layoutEvent?.lifecycleStatus;
  const isReadOnly = lifecycle === "ended" || lifecycle === "archived";

  // サークル管理のメニュー項目
  // 基本機能を先頭に、拡張機能(在庫/スタッフ/モッド)は末尾へ並べる。
  // 在庫・スタッフは拡張機能としてON/OFFでき、OFFのときはメニューから隠す。
  const circleMenuItems: MenuItem[] = [
    { title: "ダッシュボード", href: "/circle/dashboard", icon: LayoutDashboard },
    { title: "メニュー管理", href: "/circle/dashboard/menu", icon: UtensilsCrossed },
    { title: "売上管理", href: "/circle/dashboard/sales", icon: TrendingUp },
    { title: "統計・分析", href: "/circle/dashboard/analytics", icon: BarChart3 },
    { title: "データエクスポート", href: "/circle/dashboard/export", icon: Download },
    { title: "サークル設定", href: "/circle/dashboard/circle", icon: Settings },
    { title: "メンバー管理", href: "/circle/dashboard/members", icon: Users },
    { title: "モバイルオーダーQR", href: "/circle/dashboard/qr", icon: QrCode },
    // --- ここから拡張機能 (末尾) ---
    ...(circleSettings.extensions.stock
      ? [{ title: "在庫管理", href: "/circle/dashboard/stock", icon: Package }]
      : []),
    ...(circleSettings.extensions.staff
      ? [{ title: "スタッフ管理", href: "/circle/dashboard/staff", icon: UserCheck }]
      : []),
    // 2026-07-07: 「拡張機能 (モッド)」の独立ページは廃止。モッド管理はサークル設定内へ統合済み。
  ];

  // イベント管理のメニュー項目 (タブ切り替え)
  const eventMenuItems: MenuItem[] = [
    { title: "統計・分析", tab: "analytics", icon: BarChart3 },
    { title: "来場者行動・混雑", tab: "behavior", icon: Activity },
    { title: "データエクスポート", tab: "export", icon: Download },
    { title: "注文モニタ", tab: "order-monitor", icon: MonitorCheck },
    { title: "在庫・売り切れ", tab: "inventory", icon: Boxes },
    { title: "一斉アナウンス", tab: "announce", icon: Megaphone },
    { title: "サークル管理", tab: "circles", icon: Grid },
    { title: "全体売上管理", tab: "sales", icon: TrendingUp },
    { title: "精算", tab: "settlement", icon: Calculator },
    { title: "日次締め", tab: "daily-close", icon: CalendarCheck },
    ...(lotteryEnabled ? [{ title: "抽選", tab: "lottery", icon: Ticket }] : []),
    { title: "スタッフ管理", tab: "staff", icon: Users },
    { title: "イベント設定", tab: "settings", icon: Settings },
    { title: "契約状況", tab: "contract", icon: CreditCard },
    { title: "リストバンド管理", tab: "wristbands", icon: IdCard },
  ];

  // システム管理のメニュー項目
  const systemMenuItems: MenuItem[] = [
    { title: "運営ダッシュボード", tab: "overview", icon: LayoutDashboard },
    { title: "イベント/課金", tab: "saas-events", icon: Calendar },
    { title: "監査ログ", tab: "audit", icon: ScrollText },
    { title: "アカウント管理", tab: "accounts", icon: Users },
    { title: "お知らせ管理", tab: "announcements", icon: Megaphone },
    { title: "メンテナンス", tab: "system-settings", icon: Wrench },
  ];

  const menuItems =
    type === "circle"
      ? circleMenuItems
      : type === "event"
      ? eventMenuItems
      : systemMenuItems;

  const activeItem = menuItems.find((item) => {
    if (type === "circle") {
      return location.pathname === item.href;
    }
    return activeTab === item.tab;
  });

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 font-mono bg-background text-foreground">
      {/* 共通ヘッダー: 左にタイトル、右に画面主要アクション (actions スロット)。
          モバイルでは縦積みにしてボタンが潰れないようにする。 */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 border-b-thick border-border pb-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-black uppercase tracking-wider font-mono flex items-center gap-2">
            {type === "system" && <Shield className="h-6 w-6 text-foreground shrink-0" />}
            {type === "event" && <Calendar className="h-6 w-6 text-foreground shrink-0" />}
            <span className="truncate">{title}</span>
          </h1>
          {subtitle && (
            <p className="font-mono text-[10px] sm:text-xs uppercase tracking-[1px] mt-1 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* 閲覧のみモードの明示 (2026-07-16)。サーバ側 (hasPermission) が write/delete を
          一律拒否するため、なぜ保存できないのかをここで伝える。 */}
      {isReadOnly && (
        <div className="border-thick border-warning bg-warning/10 p-3 mb-4 flex items-start gap-2">
          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-wider">閲覧のみモード</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
              このイベントは{lifecycle === "archived" ? "保持期間中" : "終了"}のため、データの変更はできません。
              閲覧・集計・エクスポートはこれまでどおり利用できます。
              {type === "event" && "再開する場合は「イベント設定」の開催状態を「開催中」に戻してください。"}
            </p>
          </div>
        </div>
      )}

      {/* モバイルアコーディオンメニュー (md未満) */}
      <div className="md:hidden w-full border-thick border-border bg-background mb-4">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="flex items-center justify-between w-full px-4 py-3 text-xs font-bold uppercase cursor-pointer"
        >
          <span className="flex items-center gap-2">
            {activeItem ? <activeItem.icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
            {activeItem ? activeItem.title : "メニューを選択"}
          </span>
          {isMobileMenuOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {isMobileMenuOpen && (
          <nav className="border-t-thick border-border p-1.5 space-y-1 bg-background">
            {menuItems.map((item, idx) => {
              const Icon = item.icon;
              const isCircleActive = type === "circle" && location.pathname === item.href;
              const isTabActive = type !== "circle" && activeTab === item.tab;
              const isActive = isCircleActive || isTabActive;

              const baseClass = cn(
                "flex items-center gap-2 px-3 py-2.5 text-[12px] font-bold uppercase rounded-none transition-all border border-transparent w-full select-none cursor-pointer text-left",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              );

              const handleItemClick = () => {
                setIsMobileMenuOpen(false);
                if (type !== "circle" && item.tab && onTabChange) {
                  onTabChange(item.tab);
                }
              };

              if (type === "circle" && item.href) {
                return (
                  <Link key={idx} to={item.href} className="block w-full" onClick={() => setIsMobileMenuOpen(false)}>
                    <span className={baseClass}>
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.title}
                    </span>
                  </Link>
                );
              } else {
                return (
                  <button
                    key={idx}
                    onClick={handleItemClick}
                    className={baseClass}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.title}
                  </button>
                );
              }
            })}
          </nav>
        )}
      </div>

      {/* 2カラムレイアウト */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* 左サイドバー: PCでは縦並び、モバイルでは非表示 (アコーディオンがカバーするため) */}
        <aside className="hidden md:block w-full md:w-64 shrink-0 border-thick border-border bg-background p-2 rounded-none shadow-none md:sticky md:top-4">
          <nav className="flex md:flex-col gap-1">
            {menuItems.map((item, idx) => {
              const Icon = item.icon;
              const isCircleActive = type === "circle" && location.pathname === item.href;
              const isTabActive = type !== "circle" && activeTab === item.tab;
              const isActive = isCircleActive || isTabActive;

              const baseClass = cn(
                "flex items-center gap-2 px-3 py-2 text-[12px] font-bold uppercase rounded-none transition-all border border-transparent whitespace-nowrap md:w-full select-none cursor-pointer",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground hover:border-border"
              );

              if (type === "circle" && item.href) {
                return (
                  <Link key={idx} to={item.href} className="block md:w-full">
                    <span className={baseClass}>
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.title}
                    </span>
                  </Link>
                );
              } else {
                return (
                  <button
                    key={idx}
                    onClick={() => item.tab && onTabChange && onTabChange(item.tab)}
                    className={baseClass}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.title}
                  </button>
                );
              }
            })}
          </nav>
        </aside>

        {/* 右メインコンテンツ */}
        {/* min-w-0: flex 子要素の既定 min-width:auto により中身が広いと縮まず、
            ビューポートを超えて横スクロール(モバイルの横幅ズレ)が発生するのを防ぐ。 */}
        <main className="flex-1 w-full min-w-0 border-thick border-border p-4 md:p-6 bg-background rounded-none shadow-none min-h-[500px]">
          {children}
        </main>
      </div>
    </div>
  );
}

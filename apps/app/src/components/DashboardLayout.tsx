import { createContext, ReactNode, Suspense, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { circleApi, eventApi, parseCircleSettings } from "@/lib/api";
import { useAuth } from "@/hooks/useCircleAuth";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useGuardedNavigation } from "@/components/UnsavedNavigationGuard";
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
  MonitorPlay,
  Boxes,
  Calculator,
  CalendarCheck,
  Ticket,
  Tag,
  Download,
  IdCard,
  Activity,
  Star,
  CreditCard,
  X,
  MapPinned,
  Gauge,
  ShieldAlert,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// 2026-10-21: サークル画面の切替で共通ナビまで再生成されないよう、親ルートが描画する枠を共有する。
// 子ページが従来どおり DashboardLayout を使っても、ここでは中身と画面固有アクションだけを渡す。
const CircleDashboardRouteContext = createContext<{ actionsHost: HTMLDivElement | null } | null>(null);

interface MenuItem {
  title: string;
  href?: string;
  tab?: string;
  icon: any;
  // 指定時、この権限を持たないユーザーにはメニュー項目ごと出さない (2026-10-05)。
  // 各ページのガードと同じ権限を指定し、開いても「権限がありません」になる項目を出さないようにする。
  permission?: string;
  // 2026-10-25: 一方の担当権限で利用できる画面を表す。配列内は OR 条件で判定する。
  permissions?: string[];
}

// サイドメニューをカテゴリ見出し付きで表示するためのグループ単位 (2026-07-16)。
// 項目数が増えて平坦なリストでは目的の設定を探しづらくなったため導入。
// label が空文字列のグループは見出しを描画しない (例: 見出し不要な単発グループ用の逃げ道として用意)。
interface MenuGroup {
  label: string;
  items: MenuItem[];
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

export default function DashboardLayout(props: DashboardLayoutProps) {
  const routeContext = useContext(CircleDashboardRouteContext);
  if (routeContext) {
    return (
      <>
        {props.children}
        {props.actions && routeContext.actionsHost ? createPortal(props.actions, routeContext.actionsHost) : null}
      </>
    );
  }
  return <DashboardLayoutFrame {...props} />;
}

function DashboardLayoutFrame({
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
  const requestGuardedNavigation = useGuardedNavigation();
  // 2026-07-16: スマホ用メニューは以前アコーディオンでページ内に展開しており、
  // 開閉でページの高さが変わってスマホでタップ後にレイアウトが動き見失う体験だった。
  // CLAUDE.md の「入力フォームはモーダルで開く」と同じ思想で、画面左からスライドインする
  // ドロワー(オーバーレイ)に変更し、開閉でページ本体の長さが変わらないようにする。
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const publishMobileMenuState = (open: boolean) => {
    window.dispatchEvent(new CustomEvent("fesflow:dashboard-menu-state", { detail: open }));
  };
  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
    publishMobileMenuState(false);
  };

  // 2026-10-20: ロゴ横のトリガーから開き、ドロワー内の操作から閉じた時も同じ状態へ同期する。
  useEffect(() => {
    const open = () => {
      setIsMobileMenuOpen(true);
      window.dispatchEvent(new CustomEvent("fesflow:dashboard-menu-state", { detail: true }));
    };
    const close = () => {
      setIsMobileMenuOpen(false);
      window.dispatchEvent(new CustomEvent("fesflow:dashboard-menu-state", { detail: false }));
    };
    window.addEventListener("fesflow:dashboard-menu-open", open);
    window.addEventListener("fesflow:dashboard-menu-close", close);
    window.dispatchEvent(new CustomEvent("fesflow:dashboard-menu-state", { detail: false }));
    return () => {
      window.removeEventListener("fesflow:dashboard-menu-open", open);
      window.removeEventListener("fesflow:dashboard-menu-close", close);
    };
  }, []);

  useBodyScrollLock(isMobileMenuOpen);

  // Escape 閉じ・フォーカストラップは Modal.tsx と同じ共通フックを再利用する。
  const drawerFocusTrapRef = useFocusTrap<HTMLDivElement>(isMobileMenuOpen, {
    onEscape: closeMobileMenu,
  });
  // 2026-07-16: 従来は useState + useEffect(依存配列 []) で mount 時に一度だけ
  // localStorage の circleId を読んでいたため、同一パス上でヘッダーからスペースを
  // 切り替えても(再マウントされないので)ここが古いサークルIDのまま固定され、
  // 拡張機能のON/OFF出し分け(在庫/スタッフ)が切り替え前のサークルの設定で
  // 表示され続ける不具合があった。useAuth() は authChange イベント購読で常に
  // 最新の circleId を返すため、これに乗り換えて再マウント不要で反映されるようにする。
  const { circleId: authCircleId, isCircleOwner, checkPermission, isLoading: authLoading } = useAuth();
  const circleId = type === "circle" ? (authCircleId ?? "") : "";
  const sidebarScrollRef = useRef<HTMLElement>(null);
  const sidebarScrollKey = `fesflow:dashboard-sidebar:${type}:${circleId || eventId || "default"}`;

  useEffect(() => {
    const sidebar = sidebarScrollRef.current;
    if (!sidebar) return;
    try { sidebar.scrollTop = Number(window.sessionStorage.getItem(sidebarScrollKey) ?? 0); } catch { /* 保存できなくても通常操作を続ける */ }
    const savePosition = () => {
      try { window.sessionStorage.setItem(sidebarScrollKey, String(sidebar.scrollTop)); } catch { /* 保存できなくても通常操作を続ける */ }
    };
    sidebar.addEventListener("scroll", savePosition, { passive: true });
    return () => {
      savePosition();
      sidebar.removeEventListener("scroll", savePosition);
    };
  }, [sidebarScrollKey]);

  // 2026-09-27: スタッフ管理の表示判定のためサークル設定を取得。在庫管理は組み込み機能とする。
  const { data: circle } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: type === "circle" && !!circleId,
  });
  const circleSettings = parseCircleSettings(circle?.settings);

  // 2026-10-21: 上部バナーを含む固定領域の高さを測り、左メニューがヘッダーへ重ならないよう追従する。
  useEffect(() => {
    const chrome = document.querySelector<HTMLElement>("[data-app-chrome]")
      ?? document.querySelector<HTMLElement>("[data-app-header]");
    if (!chrome) return;
    const updateHeaderHeight = () => {
      document.documentElement.style.setProperty("--app-chrome-height", `${chrome.getBoundingClientRect().height}px`);
    };
    updateHeaderHeight();
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, []);

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

  // サークル管理のメニュー項目 (カテゴリ分け, 2026-07-16)。2026-09-27: レビューは売上・分析の範囲で管理者に表示する。
  // 「運営」= 日常的に開く画面、「商品・在庫」= 出す物の管理、
  // 「売上・分析」= お金と数字、「管理」= サークル自体の設定・人。
  // 2026-09-27: 在庫管理は組み込み機能、スタッフ管理は従来どおり拡張機能として表示を切り替える。
  const circleGroups: MenuGroup[] = [
    {
      label: "運営",
      items: [
        { title: "ダッシュボード", href: "/circle/dashboard", icon: LayoutDashboard },
        { title: "モバイルオーダーQR", href: "/circle/dashboard/qr", icon: QrCode, permission: "circle:read" },
        { title: "番号表示", href: "/circle/dashboard/number-display", icon: MonitorPlay, permission: "circle:write" },
      ],
    },
    {
      label: "商品・在庫",
      items: [
        { title: "メニュー管理", href: "/circle/dashboard/menu", icon: UtensilsCrossed, permission: "menu:write" },
        { title: "在庫管理", href: "/circle/dashboard/stock", icon: Package, permission: "stock:write" },
      ],
    },
    {
      label: "売上・分析",
      items: [
        { title: "売上管理", href: "/circle/dashboard/sales", icon: TrendingUp, permission: "sales:read" },
        { title: "統計・分析", href: "/circle/dashboard/analytics", icon: BarChart3, permission: "sales:read" },
        { title: "レビュー", href: "/circle/dashboard/reviews", icon: Star, permission: "sales:read" },
        { title: "データエクスポート", href: "/circle/dashboard/export", icon: Download, permission: "sales:read" },
        { title: "クーポン管理", href: "/circle/dashboard/coupons", icon: Ticket, permission: "coupon:read" },
        { title: "割引管理", href: "/circle/dashboard/discounts", icon: Tag, permission: "discount:read" },
      ],
    },
    {
      label: "管理",
      items: [
        // サークル設定は画面ごとオーナー限定 (2026-10-05)。一般スタッフには導線も出さない。
        ...(isCircleOwner ? [{ title: "サークル設定", href: "/circle/dashboard/circle", icon: Settings }] : []),
        // メンバー管理もオーナー限定 (一覧/招待 API がオーナーのみ。2026-10-05)。
        ...(isCircleOwner ? [{ title: "メンバー管理", href: "/circle/dashboard/members", icon: Users }] : []),
        ...(circleSettings.extensions.staff
          ? [{ title: "スタッフ管理", href: "/circle/dashboard/staff", icon: UserCheck, permission: "staff:read" }]
          : []),
        // 2026-07-07: 「拡張機能 (モッド)」の独立ページは廃止。モッド管理はサークル設定内へ統合済み。
      ],
    },
  ];

  // イベント管理のメニュー項目 (タブ切り替え, カテゴリ分け 2026-07-16)
  // 2026-10-18: 実行委員が開催中と開催後で見る画面を迷わないよう、運営状況と振り返りを別メニューにする。
  // 「運営」= 開催中に頻繁に触る現場オペレーション、「売上・分析」= 数字・集計系、
  // 「管理」= イベント自体の設定・契約・人、「拡張」= オプション機能 (抽選など、無効時は非表示)。
  const eventGroups: MenuGroup[] = [
    {
      label: "運営",
      items: [
        { title: "開催中の混雑・人員配置", tab: "behavior", icon: Activity, permission: "event:write" },
        { title: "混雑モニター", tab: "congestion", icon: Gauge, permission: "event:write" },
        { title: "注文モニタ", tab: "order-monitor", icon: MonitorCheck, permission: "order:read" },
        { title: "在庫・売り切れ", tab: "inventory", icon: Boxes, permission: "stock:read" },
        { title: "一斉アナウンス", tab: "announce", icon: Megaphone, permission: "member:write" },
        { title: "リストバンド管理", tab: "wristbands", icon: IdCard, permissions: ["member:write", "wristband:replace", "stamp-rally:operate"] },
        { title: "紛失バンド交換", tab: "wristband-loss", icon: ShieldAlert, permission: "wristband:replace" },
        { title: "景品交換受付", tab: "stamp-redemptions", icon: Ticket, permission: "stamp-rally:operate" },
        { title: "スタンプラリー", tab: "stamp-rally", icon: Ticket, permission: "event:write" },
      ],
    },
    {
      label: "開催後の振り返り",
      items: [
        { title: "イベント全体レポート", tab: "analytics", icon: BarChart3, permission: "sales:read" },
      ],
    },
    {
      label: "売上・分析",
      items: [
        { title: "レビュー", tab: "reviews", icon: Star, permission: "sales:read" },
        { title: "全体売上管理", tab: "sales", icon: TrendingUp, permission: "sales:read" },
        { title: "精算", tab: "settlement", icon: Calculator, permission: "sales:read" },
        { title: "日次締め", tab: "daily-close", icon: CalendarCheck, permission: "sales:read" },
        { title: "データエクスポート", tab: "export", icon: Download, permission: "sales:read" },
      ],
    },
    {
      label: "管理",
      items: [
        { title: "サークル管理", tab: "circles", icon: Grid, permission: "circle:read" },
        { title: "店舗エリア", tab: "store-areas", icon: MapPinned, permission: "event:write" },
        { title: "スタッフ管理", tab: "staff", icon: Users, permission: "staff:read" },
        { title: "イベント設定", tab: "settings", icon: Settings, permission: "event:write" },
        { title: "契約状況", tab: "contract", icon: CreditCard, permission: "event:write" },
      ],
    },
    {
      label: "拡張",
      items: [
        ...(lotteryEnabled ? [{ title: "抽選", tab: "lottery", icon: Ticket, permission: "event:write" }] : []),
      ],
    },
  ];

  // システム管理のメニュー項目 (カテゴリ分け, 2026-07-16)
  const systemGroups: MenuGroup[] = [
    {
      label: "運営",
      items: [
        { title: "運営ダッシュボード", tab: "overview", icon: LayoutDashboard },
        { title: "イベント/課金", tab: "saas-events", icon: Calendar },
      ],
    },
    {
      label: "管理",
      items: [
        { title: "アカウント管理", tab: "accounts", icon: Users },
        { title: "お知らせ管理", tab: "announcements", icon: Megaphone },
      ],
    },
    {
      label: "システム",
      items: [
        { title: "監査ログ", tab: "audit", icon: ScrollText },
        { title: "メンテナンス", tab: "system-settings", icon: Wrench },
      ],
    },
  ];

  const menuGroups =
    type === "circle"
      ? circleGroups
      : type === "event"
      ? eventGroups
      : systemGroups;

  // 空グループ (抽選OFFなど拡張機能が全て無効な場合) は見出しごと出さない
  // 権限のない項目は出さない (permission 指定項目。権限の読み込み中は全項目を出して
  // 一瞬メニューが空になるのを避ける)。可否の最終判定は各ページのガードと API が行う。
  const visibleMenuGroups = menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.permission && !item.permissions)
          || authLoading
          || (item.permission ? checkPermission(item.permission as any) : false)
          || (item.permissions?.some((permission) => checkPermission(permission as any)) ?? false)
      ),
    }))
    .filter((group) => group.items.length > 0);

  // アコーディオンの現在地表示や href/tab のアクティブ判定は、グループを問わずフラットに探索すれば足りる
  const menuItems = visibleMenuGroups.flatMap((group) => group.items);

  const activeItem = menuItems.find((item) => {
    if (type === "circle") {
      return location.pathname === item.href;
    }
    return activeTab === item.tab;
  });
  const firstVisibleTab = menuItems.find((item) => item.tab)?.tab;

  useEffect(() => {
    if (type !== "event" || authLoading || activeItem || !firstVisibleTab || !onTabChange) return;
    // 2026-10-20: URL直入力でも権限外のタブを描画せず、そのスタッフが使える最初の画面へ移す。
    onTabChange(firstVisibleTab);
  }, [type, authLoading, activeItem?.tab, firstVisibleTab, onTabChange]);
  // 2026-10-21: 短い設定画面でサイドバーだけが画面下まで伸びたり、本文スクロールへ追従したりしないよう自然高で表示する。
  const renderMenuGroups = (isMobile: boolean) => visibleMenuGroups.map((group) => {
    return (
      <div key={group.label} className={cn("pt-3 first:pt-0", !isMobile && "md:w-full")}>
        <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {group.label}
        </p>
        <div className="ml-2 space-y-0.5 border-l border-border pl-2">
          {group.items.map((item, itemIndex) => {
            const Icon = item.icon;
            const isCircleActive = type === "circle" && location.pathname === item.href;
            const isTabActive = type !== "circle" && activeTab === item.tab;
            const isActive = isCircleActive || isTabActive;
            const itemClass = cn(
              "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-bold uppercase transition-all border border-transparent select-none cursor-pointer",
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
              !isMobile && "md:min-h-10",
            );
            const handleItemClick = () => {
              if (isMobile) closeMobileMenu();
              if (type !== "circle" && item.tab && onTabChange) {
                // 2026-10-16: システム/イベントのタブ切り替えも未保存確認を通す。
                requestGuardedNavigation(() => onTabChange(item.tab!));
              }
            };

            return type === "circle" && item.href ? (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => isMobile && closeMobileMenu()}
                className={itemClass}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words whitespace-normal">{item.title}</span>
              </Link>
            ) : (
              <button key={item.tab ?? itemIndex} type="button" onClick={handleItemClick} className={itemClass}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words whitespace-normal">{item.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  });

  return (
    <div className="mx-auto box-border w-full min-w-0 max-w-7xl p-3 sm:p-4 md:px-6 md:pt-6 md:pb-4 font-mono bg-background text-foreground">
      {/* 共通ヘッダー: 左にタイトル、右に画面主要アクション (actions スロット)。
          モバイルでは縦積みにしてボタンが潰れないようにする。 */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 border-b-thick border-border pb-3 mb-6">
        <div className="min-w-0">
          <h1 className="min-w-0 break-words text-lg sm:text-2xl font-black uppercase tracking-wider font-mono flex items-center gap-2">
            {type === "system" && <Shield className="h-6 w-6 text-foreground shrink-0" />}
            {type === "event" && <Calendar className="h-6 w-6 text-foreground shrink-0" />}
            <span className="min-w-0 break-words">{title}</span>
          </h1>
          {subtitle && (
            <p className="font-mono text-[10px] sm:text-xs uppercase tracking-[1px] mt-1 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
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

      {/* 2026-10-21: 固定ヘッダーや親の overflow の重なり順から独立させるため body 直下へ描画する。
          モバイルメニュー ドロワー (md未満)。トリガーとは別要素として常にマウントしておき、
          開閉は translate-x の CSS transition のみで行う (アンマウント方式だと閉じるアニメーションが
          出せないため)。閉じている間は `inert` で背景要素としてフォーカス/操作を無効化し、
          スライドアウト先 (画面外) にあるリンク/ボタンが Tab で拾われないようにする。
          z-index はヘッダーの sticky z-50 より上 (z-[60]) にして必ず前面に出す。 */}
      {createPortal((
      <div
        className={cn(
          "md:hidden fixed inset-0 z-[60] transition-opacity duration-200",
          isMobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!isMobileMenuOpen}
      >
        {/* オーバーレイ: タップで閉じる。背景はスクロールロック済み (useEffect 参照)。 */}
        <div
          className="absolute inset-0 bg-foreground/80 backdrop-blur-sm"
          onClick={closeMobileMenu}
        />

        <div
          ref={drawerFocusTrapRef}
          id="dashboard-mobile-menu"
          inert={!isMobileMenuOpen}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="メニュー"
          className={cn(
            "absolute inset-y-0 left-0 w-[82vw] max-w-xs bg-background border-r-thick border-border pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-none flex flex-col transition-transform duration-200 ease-out",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="relative flex items-center px-4 py-3 border-b-thick border-border shrink-0">
            <span className="pl-12 text-xs font-bold uppercase">メニュー</span>
            <button
              onClick={closeMobileMenu}
              aria-label="閉じる"
              className="absolute left-2 top-2 z-[70] inline-flex h-9 w-9 items-center justify-center border-thick border-border bg-background p-1 transition-all hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 2026-10-20: モバイルのドロワーでも全カテゴリを見せ、項目探しのための開閉操作をなくす。 */}
          <nav className="p-1.5 space-y-0.5 overflow-y-auto flex-1">
            {renderMenuGroups(true)}
          </nav>
        </div>
      </div>
      ), document.body)}

      {/* 2カラムレイアウト */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* 2026-10-21: 長いサイドメニューはヘッダー下に固定し、右のページとは独立してスクロールさせる。
            親の下端に押し上げられてヘッダーへ重ならないよう、sticky枠と外側の下余白を合計16pxに揃える。 */}
        <aside
          ref={sidebarScrollRef}
          className="sticky top-[calc(var(--app-chrome-height,4rem)+1rem)] hidden w-full shrink-0 overflow-y-auto overscroll-contain border-thick border-border bg-background p-2 pb-5 shadow-none md:block md:max-h-[calc(100dvh-var(--app-chrome-height,4rem)-2rem)] md:w-64 md:self-start"
        >
          <nav className="flex md:flex-col gap-1">
            {renderMenuGroups(false)}
          </nav>
        </aside>

        {/* 右メインコンテンツ */}
        {/* min-w-0: flex 子要素の既定 min-width:auto により中身が広いと縮まず、
            ビューポートを超えて横スクロール(モバイルの横幅ズレ)が発生するのを防ぐ。 */}
        <main className="box-border flex-1 w-full min-w-0 max-w-full border-thick border-border p-3 sm:p-4 md:p-6 bg-background rounded-none shadow-none min-h-[500px]">
          {type === "event" && !authLoading && !activeItem ? (
            <p className="border-thick border-warning bg-warning/10 p-4 text-sm" role="status">
              この画面を利用する権限がありません。利用できる管理画面へ移動しています。
            </p>
          ) : children}
        </main>
      </div>
    </div>
  );
}

const circleDashboardSubtitles: Record<string, string> = {
  "/circle/dashboard": "ダッシュボード概要",
  "/circle/dashboard/circle": "サークル設定",
  "/circle/dashboard/number-display": "厨房・プロジェクターに表示する番号とメディアを設定",
  "/circle/dashboard/members": "メンバー管理",
  "/circle/dashboard/menu": "メニュー・トッピング管理",
  "/circle/dashboard/qr": "モバイルオーダーQR",
  "/circle/dashboard/sales": "売上管理",
  "/circle/dashboard/analytics": "統計・分析",
  "/circle/dashboard/reviews": "来場者の評価・感想",
  "/circle/dashboard/export": "データエクスポート",
  "/circle/dashboard/staff": "スタッフ管理",
  "/circle/dashboard/stock": "在庫管理",
  "/circle/dashboard/coupons": "クーポン管理",
  "/circle/dashboard/discounts": "割引管理",
};

function CircleDashboardRouteLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <p className="text-xs text-muted-foreground">画面を読み込んでいます…</p>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

// 2026-10-21: ページチャンクの遅延読込は共通枠の内側で受け、白画面へ置換せず現在のナビを保つ。
export function CircleDashboardRouteLayout() {
  const location = useLocation();
  const { circleName } = useAuth();
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const path = location.pathname.replace(/\/+$/, "") || "/circle/dashboard";
  const title = path === "/circle/dashboard/number-display" ? "番号表示" : circleName ?? "サークルダッシュボード";

  return (
    <CircleDashboardRouteContext.Provider value={{ actionsHost }}>
      <DashboardLayoutFrame
        title={title}
        subtitle={circleDashboardSubtitles[path] ?? "サークル管理"}
        type="circle"
        actions={<div ref={setActionsHost} className="contents" />}
      >
        <Suspense fallback={<CircleDashboardRouteLoading />}>
          <Outlet />
        </Suspense>
      </DashboardLayoutFrame>
    </CircleDashboardRouteContext.Provider>
  );
}

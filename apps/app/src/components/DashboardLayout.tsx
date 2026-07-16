import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { circleApi, eventApi, parseCircleSettings } from "@/lib/api";
import { useAuth } from "@/hooks/useCircleAuth";
import { useFocusTrap } from "@/hooks/useFocusTrap";
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
  Download,
  IdCard,
  Activity,
  CreditCard,
  X,
} from "lucide-react";

interface MenuItem {
  title: string;
  href?: string;
  tab?: string;
  icon: any;
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
  // 2026-07-16: スマホ用メニューは以前アコーディオンでページ内に展開しており、
  // 開閉でページの高さが変わってスマホでタップ後にレイアウトが動き見失う体験だった。
  // CLAUDE.md の「入力フォームはモーダルで開く」と同じ思想で、画面左からスライドインする
  // ドロワー(オーバーレイ)に変更し、開閉でページ本体の長さが変わらないようにする。
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // 背景スクロールロック (Modal.tsx と同じパターン)。アンマウント/クローズ時に必ず元へ戻す。
  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isMobileMenuOpen]);

  // Escape 閉じ・フォーカストラップは Modal.tsx と同じ共通フックを再利用する。
  const drawerFocusTrapRef = useFocusTrap<HTMLDivElement>(isMobileMenuOpen, {
    onEscape: () => setIsMobileMenuOpen(false),
  });
  // 2026-07-16: 従来は useState + useEffect(依存配列 []) で mount 時に一度だけ
  // localStorage の circleId を読んでいたため、同一パス上でヘッダーからスペースを
  // 切り替えても(再マウントされないので)ここが古いサークルIDのまま固定され、
  // 拡張機能のON/OFF出し分け(在庫/スタッフ)が切り替え前のサークルの設定で
  // 表示され続ける不具合があった。useAuth() は authChange イベント購読で常に
  // 最新の circleId を返すため、これに乗り換えて再マウント不要で反映されるようにする。
  const { circleId: authCircleId } = useAuth();
  const circleId = type === "circle" ? (authCircleId ?? "") : "";

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

  // サークル管理のメニュー項目 (カテゴリ分け, 2026-07-16)
  // 「運営」= 日常的に開く画面、「商品・在庫」= 出す物の管理、
  // 「売上・分析」= お金と数字、「管理」= サークル自体の設定・人。
  // 在庫管理/スタッフ管理は拡張機能のON/OFFで出し分けるため、該当グループの配列末尾に条件付きで足す。
  const circleGroups: MenuGroup[] = [
    {
      label: "運営",
      items: [
        { title: "ダッシュボード", href: "/circle/dashboard", icon: LayoutDashboard },
        { title: "モバイルオーダーQR", href: "/circle/dashboard/qr", icon: QrCode },
      ],
    },
    {
      label: "商品・在庫",
      items: [
        { title: "メニュー管理", href: "/circle/dashboard/menu", icon: UtensilsCrossed },
        ...(circleSettings.extensions.stock
          ? [{ title: "在庫管理", href: "/circle/dashboard/stock", icon: Package }]
          : []),
      ],
    },
    {
      label: "売上・分析",
      items: [
        { title: "売上管理", href: "/circle/dashboard/sales", icon: TrendingUp },
        { title: "統計・分析", href: "/circle/dashboard/analytics", icon: BarChart3 },
        { title: "データエクスポート", href: "/circle/dashboard/export", icon: Download },
      ],
    },
    {
      label: "管理",
      items: [
        { title: "サークル設定", href: "/circle/dashboard/circle", icon: Settings },
        { title: "メンバー管理", href: "/circle/dashboard/members", icon: Users },
        ...(circleSettings.extensions.staff
          ? [{ title: "スタッフ管理", href: "/circle/dashboard/staff", icon: UserCheck }]
          : []),
        // 2026-07-07: 「拡張機能 (モッド)」の独立ページは廃止。モッド管理はサークル設定内へ統合済み。
      ],
    },
  ];

  // イベント管理のメニュー項目 (タブ切り替え, カテゴリ分け 2026-07-16)
  // 「運営」= 開催中に頻繁に触る現場オペレーション、「売上・分析」= 数字・集計系、
  // 「管理」= イベント自体の設定・契約・人、「拡張」= オプション機能 (抽選など、無効時は非表示)。
  const eventGroups: MenuGroup[] = [
    {
      label: "運営",
      items: [
        { title: "注文モニタ", tab: "order-monitor", icon: MonitorCheck },
        { title: "在庫・売り切れ", tab: "inventory", icon: Boxes },
        { title: "一斉アナウンス", tab: "announce", icon: Megaphone },
        { title: "リストバンド管理", tab: "wristbands", icon: IdCard },
      ],
    },
    {
      label: "売上・分析",
      items: [
        { title: "統計・分析", tab: "analytics", icon: BarChart3 },
        { title: "来場者行動・混雑", tab: "behavior", icon: Activity },
        { title: "全体売上管理", tab: "sales", icon: TrendingUp },
        { title: "精算", tab: "settlement", icon: Calculator },
        { title: "日次締め", tab: "daily-close", icon: CalendarCheck },
        { title: "データエクスポート", tab: "export", icon: Download },
      ],
    },
    {
      label: "管理",
      items: [
        { title: "サークル管理", tab: "circles", icon: Grid },
        { title: "スタッフ管理", tab: "staff", icon: Users },
        { title: "イベント設定", tab: "settings", icon: Settings },
        { title: "契約状況", tab: "contract", icon: CreditCard },
      ],
    },
    {
      label: "拡張",
      items: [
        ...(lotteryEnabled ? [{ title: "抽選", tab: "lottery", icon: Ticket }] : []),
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
  const visibleMenuGroups = menuGroups.filter((group) => group.items.length > 0);

  // アコーディオンの現在地表示や href/tab のアクティブ判定は、グループを問わずフラットに探索すれば足りる
  const menuItems = visibleMenuGroups.flatMap((group) => group.items);

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

      {/* モバイルメニュー トリガー (md未満)。押すと下のドロワーが画面左からスライドインする。
          トリガー自体はページ内に留まる (差し込み型ではない) のでページの高さは変わらない。 */}
      <div className="md:hidden w-full border-thick border-border bg-background mb-4">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          aria-expanded={isMobileMenuOpen}
          aria-haspopup="dialog"
          aria-label="メニューを開く"
          className="flex items-center justify-between w-full px-4 py-3 text-xs font-bold uppercase cursor-pointer"
        >
          <span className="flex items-center gap-2">
            {activeItem ? <activeItem.icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
            {activeItem ? activeItem.title : "メニューを選択"}
          </span>
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* モバイルメニュー ドロワー (md未満)。トリガーとは別要素として常にマウントしておき、
          開閉は translate-x の CSS transition のみで行う (アンマウント方式だと閉じるアニメーションが
          出せないため)。閉じている間は `inert` で背景要素としてフォーカス/操作を無効化し、
          スライドアウト先 (画面外) にあるリンク/ボタンが Tab で拾われないようにする。
          z-index はヘッダーの sticky z-50 より上 (z-[60]) にして必ず前面に出す。 */}
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
          onClick={() => setIsMobileMenuOpen(false)}
        />

        <div
          ref={drawerFocusTrapRef}
          inert={!isMobileMenuOpen}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="メニュー"
          className={cn(
            "absolute inset-y-0 left-0 w-[82vw] max-w-xs bg-background border-r-thick border-border shadow-none flex flex-col transition-transform duration-200 ease-out",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b-thick border-border shrink-0">
            <span className="text-xs font-bold uppercase">メニュー</span>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              aria-label="閉じる"
              className="p-1 hover:bg-muted border-thick border-transparent hover:border-border transition-all shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* カテゴリ見出し付きで描画。ドロワー内で完結してスクロールできるようにする。 */}
          <nav className="p-1.5 space-y-0.5 overflow-y-auto flex-1">
            {visibleMenuGroups.map((group, gIdx) => (
              <div key={group.label} className={gIdx === 0 ? "" : "pt-2"}>
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item, idx) => {
                    const Icon = item.icon;
                    const isCircleActive = type === "circle" && location.pathname === item.href;
                    const isTabActive = type !== "circle" && activeTab === item.tab;
                    const isActive = isCircleActive || isTabActive;

                    const baseClass = cn(
                      "flex items-center gap-2 px-3 py-2 text-[12px] font-bold uppercase rounded-none transition-all border border-transparent w-full select-none cursor-pointer text-left",
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
                        <Link
                          key={idx}
                          to={item.href}
                          className="block w-full"
                          onClick={() => setIsMobileMenuOpen(false)}
                        >
                          <span className={baseClass}>
                            <Icon className="h-4 w-4 shrink-0" />
                            {item.title}
                          </span>
                        </Link>
                      );
                    } else {
                      return (
                        <button key={idx} onClick={handleItemClick} className={baseClass}>
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.title}
                        </button>
                      );
                    }
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </div>

      {/* 2カラムレイアウト */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* 左サイドバー: PCでは縦並び、モバイルでは非表示 (アコーディオンがカバーするため) */}
        <aside className="hidden md:block w-full md:w-64 shrink-0 border-thick border-border bg-background p-2 rounded-none shadow-none md:sticky md:top-4">
          <nav className="flex md:flex-col gap-1">
            {visibleMenuGroups.map((group, gIdx) => (
              <div key={group.label} className={cn("md:w-full", gIdx === 0 ? "" : "md:mt-2")}>
                {/* カテゴリ見出し: RawBlockの太字uppercaseなメイン項目と区別するため、
                    小さく控えめな muted テキストにする */}
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                {group.items.map((item, idx) => {
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
              </div>
            ))}
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

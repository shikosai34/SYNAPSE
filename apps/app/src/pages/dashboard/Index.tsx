import { useQuery } from "@tanstack/react-query";
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
} from "@/hooks/useCircleAuth";
import { circleApi, parseCircleSettings } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import { visitorUrl } from "@/lib/visitor-url";
import {
  BarChart3,
  Download,
  LayoutDashboard,
  MonitorPlay,
  Package,
  QrCode,
  Settings,
  Star,
  Tag,
  Ticket,
  TrendingUp,
  UserCheck,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DashboardLayout from "@/components/DashboardLayout";

function DashboardContent() {
  const location = useLocation();
  // 2026-07-16: circleId は独自の useState+useEffect(mount時一度きり) をやめ、
  // authChange 購読で常に最新値を返す useAuth() に統一。同一パス上でのスペース
  // 切り替え時に古い circleId が残らないようにする。
  const { role, roleName, userName, circleName, circleId: authCircleId, isCircleOwner, checkPermission, isLoading: authLoading } = useAuth();
  const circleId = authCircleId ?? "";
  const { data: circle } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
  });
  const settings = parseCircleSettings(circle?.settings);

  // 2026-09-27: 在庫管理は組み込み機能として常時表示し、スタッフ管理だけ拡張設定に従う。
  // 2026-10-25: ホームの管理メニューも左ナビと同じカテゴリ・アイコン・行表示で探しやすくする。
  const menuGroups = [
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
        ...(isCircleOwner ? [{ title: "サークル設定", href: "/circle/dashboard/circle", icon: Settings }] : []),
        ...(isCircleOwner ? [{ title: "メンバー管理", href: "/circle/dashboard/members", icon: Users }] : []),
        ...(settings.extensions.staff
          ? [{ title: "スタッフ管理", href: "/circle/dashboard/staff", icon: UserCheck, permission: "staff:read" }]
          : []),
      ],
    },
    // 2026-07-11: 「拡張機能 (モッド)」カードを撤去。独立ページ /circle/dashboard/mods は
    // 既に廃止 (モッド管理はサークル設定へ統合) されており、App.tsx にルートが無いため
    // このカードは押すと * → Placeholder に落ちる死リンクになっていた。
  ];
  // 左メニューと同じ権限条件で絞り、権限の読み込み中は項目が消えて見えない状態を避ける。
  const visibleMenuGroups = menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || authLoading || checkPermission(item.permission as any)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <DashboardLayout
      title={circleName || "サークルダッシュボード"}
      subtitle="ダッシュボード概要"
      type="circle"
    >
      <div className="space-y-6">
        <div className="flex justify-between items-center border-b-thick border-border pb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">[管理メニュー一覧]</h2>
          {role && (
            <div className="flex items-center gap-2">
              {userName && (
                <span className="text-[11px] font-bold uppercase tracking-[1px]">
                  {userName}
                </span>
              )}
              <Badge variant="default" className="rounded-none text-[9px] font-mono px-2 py-0.5">{roleName}</Badge>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {visibleMenuGroups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <nav aria-label={`${group.label}の管理メニュー`} className="ml-2 space-y-0.5 border-l border-border pl-2">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-2 border border-transparent px-3 py-2 text-left text-[12px] font-bold uppercase transition-all select-none cursor-pointer",
                        isActive
                          ? "bg-primary text-primary-foreground border-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 break-words whitespace-normal">{item.title}</span>
                    </Link>
                  );
                })}
              </nav>
            </section>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className=" rounded-none shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs uppercase font-bold">[クイックアクション]</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <PermissionGuard permission="order:write">
                <Link to="/circle/register">
                  <Button className="w-full rounded-none border-thick border-border text-xs font-bold h-9 bg-background text-foreground hover:bg-primary hover:text-primary-foreground shadow-none" variant="outline">
                    レジを開く
                  </Button>
                </Link>
              </PermissionGuard>
              <PermissionGuard permission="order:read">
                <Link to="/circle/backyard">
                  <Button className="w-full rounded-none border-thick border-border text-xs font-bold h-9 bg-background text-foreground hover:bg-primary hover:text-primary-foreground shadow-none" variant="outline">
                    厨房ビューを開く
                  </Button>
                </Link>
              </PermissionGuard>
              <a href={visitorUrl("/visitor/menu")}>
                <Button className="w-full rounded-none border-thick border-border text-xs font-bold h-9 bg-background text-foreground hover:bg-primary hover:text-primary-foreground shadow-none" variant="outline">
                  来場者メニューを見る
                </Button>
              </a>
              <PermissionGuard permission="circle:read">
                <Link to="/circle/dashboard/qr">
                  <Button className="w-full bg-primary text-primary-foreground hover:bg-background hover:text-foreground font-bold rounded-none text-xs h-9 shadow-none border-thick border-transparent hover:border-border">
                    モバイルオーダーQRを表示・印刷
                  </Button>
                </Link>
              </PermissionGuard>
            </CardContent>
          </Card>

          <Card className=" rounded-none shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs uppercase font-bold">[お知らせ]</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-[11px] font-mono leading-[1.5] text-muted-foreground">
                新しいお知らせはありません
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function DashboardPage() {
  return (
    <CircleAuthGuard>
      <DashboardContent />
    </CircleAuthGuard>
  );
}

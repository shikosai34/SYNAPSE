import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
} from "@/hooks/useCircleAuth";
import Link from "@/components/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DashboardLayout from "@/components/DashboardLayout";

function DashboardContent() {
  const { role, roleName, userName, circleName } = useAuth();

  const menuItems = [
    {
      title: "メニュー管理",
      description: "メニューとトッピングの追加・編集",
      href: "/circle/dashboard/menu",
      index: "01",
      permission: "menu:read" as const,
    },
    {
      title: "在庫管理",
      description: "在庫の確認と更新",
      href: "/circle/dashboard/stock",
      index: "02",
      permission: "stock:read" as const,
    },
    {
      title: "売上管理",
      description: "売上データの確認と分析 (グラフ表示対応)",
      href: "/circle/dashboard/sales",
      index: "03",
      permission: "sales:read" as const,
    },
    {
      title: "スタッフ管理",
      description: "シフトとスタッフの管理",
      href: "/circle/dashboard/staff",
      index: "04",
      permission: "staff:read" as const,
    },
    {
      title: "サークル設定",
      description: "サークル情報の編集",
      href: "/circle/dashboard/circle",
      index: "05",
      permission: "circle:read" as const,
    },
    {
      title: "メンバー管理",
      description: "メンバーの追加・権限設定",
      href: "/circle/dashboard/members",
      index: "06",
      permission: "member:read" as const,
    },
    {
      title: "モバイルオーダーQR",
      description: "店頭掲示用POPシートの表示・印刷",
      href: "/circle/dashboard/qr",
      index: "07",
      permission: "circle:read" as const,
    },
    {
      title: "拡張機能 (モッド)",
      description: "サークル専用の拡張機能の管理・有効化",
      href: "/circle/dashboard/mods",
      index: "08",
      permission: "circle:read" as const,
    },
  ];

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

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {menuItems.map((item) => (
            <PermissionGuard key={item.href} permission={item.permission}>
              <Link href={item.href as any}>
                <Card className="cursor-pointer border-thick border-border rounded-none shadow-none hover:bg-primary hover:text-primary-foreground group h-full transition-all">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-black leading-none">
                        {item.index}
                      </span>
                      <CardTitle className="text-xs font-bold uppercase tracking-wider">{item.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <CardDescription className="group-hover:text-primary-foreground text-[10px]">
                      {item.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            </PermissionGuard>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className=" rounded-none shadow-none">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs uppercase font-bold">[クイックアクション]</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <PermissionGuard permission="order:write">
                <Link href="/circle/register">
                  <Button className="w-full rounded-none border-thick border-border text-xs font-bold h-9 bg-background text-foreground hover:bg-primary hover:text-primary-foreground shadow-none" variant="outline">
                    レジを開く
                  </Button>
                </Link>
              </PermissionGuard>
              <PermissionGuard permission="order:read">
                <Link href="/circle/backyard">
                  <Button className="w-full rounded-none border-thick border-border text-xs font-bold h-9 bg-background text-foreground hover:bg-primary hover:text-primary-foreground shadow-none" variant="outline">
                    厨房ビューを開く
                  </Button>
                </Link>
              </PermissionGuard>
              <Link href="/visitor/menu">
                <Button className="w-full rounded-none border-thick border-border text-xs font-bold h-9 bg-background text-foreground hover:bg-primary hover:text-primary-foreground shadow-none" variant="outline">
                  来場者メニューを見る
                </Button>
              </Link>
              <PermissionGuard permission="circle:read">
                <Link href="/circle/dashboard/qr">
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

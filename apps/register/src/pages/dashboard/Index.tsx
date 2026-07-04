
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
  ROLE_NAMES,
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

function DashboardContent() {
  const { role, roleName, userName } = useAuth();

  const menuItems = [
    {
      title: "メニュー管理",
      description: "メニューとトッピングの追加・編集",
      href: "/dashboard/menu",
      index: "01",
      permission: "menu:read" as const,
    },
    {
      title: "在庫管理",
      description: "在庫の確認と更新",
      href: "/dashboard/stock",
      index: "02",
      permission: "stock:read" as const,
    },
    {
      title: "売上管理",
      description: "売上データの確認と分析",
      href: "/dashboard/sales",
      index: "03",
      permission: "sales:read" as const,
    },
    {
      title: "スタッフ管理",
      description: "シフトとスタッフの管理",
      href: "/dashboard/staff",
      index: "04",
      permission: "staff:read" as const,
    },
    {
      title: "サークル設定",
      description: "サークル情報の編集",
      href: "/dashboard/circle",
      index: "05",
      permission: "circle:read" as const,
    },
    {
      title: "メンバー管理",
      description: "メンバーの追加・権限設定",
      href: "/dashboard/members",
      index: "06",
      permission: "member:read" as const,
    },
    {
      title: "モバイルオーダーQR",
      description: "店頭掲示用POPシートの表示・印刷",
      href: "/dashboard/qr",
      index: "07",
      permission: "circle:read" as const,
    },
    {
      title: "拡張機能 (モッド)",
      description: "サークル専用の拡張機能の管理・有効化",
      href: "/dashboard/mods",
      index: "08",
      permission: "circle:write" as const,
    },
  ];



  return (
    <div className="max-w-6xl mx-auto p-sp-4 space-y-sp-5">
      <div className="flex items-end justify-between border-b-thick border-border pb-sp-3">
        <div>
          <h1 className="text-[48px] font-headline uppercase tracking-tight leading-[1.0]">
            ダッシュボード
          </h1>
          <p className="font-mono text-[14px] uppercase tracking-[1px] mt-sp-1">
            サークル管理システムへようこそ
          </p>
        </div>
        {role && (
          <div className="text-right flex items-center gap-sp-2">
            {userName && (
              <span className="text-[14px] font-headline uppercase tracking-[1px]">
                {userName}
              </span>
            )}
            <Badge variant="default">{roleName}</Badge>
          </div>
        )}
      </div>

      <div className="grid gap-sp-3 md:grid-cols-2 lg:grid-cols-3">
        {menuItems.map((item) => (
          <PermissionGuard key={item.href} permission={item.permission}>
            <Link href={item.href as any}>
              <Card className="cursor-pointer hover:bg-primary hover:text-primary-foreground group h-full">
                <CardHeader>
                  <div className="flex items-center gap-sp-3">
                    <span className="font-mono text-[24px] font-bold leading-none">
                      {item.index}
                    </span>
                    <CardTitle>{item.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="group-hover:text-primary-foreground">
                    {item.description}
                  </CardDescription>
                </CardContent>
              </Card>
            </Link>
          </PermissionGuard>
        ))}
      </div>

      <div className="grid gap-sp-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>クイックアクション</CardTitle>
          </CardHeader>
          <CardContent className="space-y-sp-2">
            <PermissionGuard permission="order:write">
              <Link href="/register">
                <Button className="w-full" variant="outline">
                  レジを開く
                </Button>
              </Link>
            </PermissionGuard>
            <PermissionGuard permission="order:read">
              <Link href="/backyard">
                <Button className="w-full" variant="outline">
                  厨房ビューを開く
                </Button>
              </Link>
            </PermissionGuard>
            <Link href="/menu">
              <Button className="w-full" variant="outline">
                メニューを見る
              </Button>
            </Link>
            <PermissionGuard permission="circle:read">
              <Link href="/dashboard/qr">
                <Button className="w-full bg-primary text-primary-foreground hover:bg-background hover:text-foreground font-bold">
                  モバイルオーダーQRを表示・印刷
                </Button>
              </Link>
            </PermissionGuard>


          </CardContent>

        </Card>

        <Card>
          <CardHeader>
            <CardTitle>お知らせ</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[14px] font-body leading-[1.5]">
              新しいお知らせはありません
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <CircleAuthGuard>
      <DashboardContent />
    </CircleAuthGuard>
  );
}

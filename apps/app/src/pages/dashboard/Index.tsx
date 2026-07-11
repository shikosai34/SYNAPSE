import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
} from "@/hooks/useCircleAuth";
import { circleApi, parseCircleSettings } from "@/lib/api";
import { Link } from "react-router-dom";
import { visitorUrl } from "@/lib/visitor-url";
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

  const [circleId, setCircleId] = useState<string>("");
  useEffect(() => {
    const stored = localStorage.getItem("circleId");
    if (stored) setCircleId(stored);
  }, []);
  const { data: circle } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
  });
  const settings = parseCircleSettings(circle?.settings);

  // 基本機能を先頭に、拡張機能(在庫/スタッフ/モッド)は末尾へ並べる。
  // 在庫・スタッフは拡張機能としてON時のみ表示する。
  const rawItems = [
    {
      title: "メニュー管理",
      description: "メニューとトッピングの追加・編集",
      href: "/circle/dashboard/menu",
      permission: "menu:read" as const,
    },
    {
      title: "売上管理",
      description: "売上データの確認と分析 (グラフ表示対応)",
      href: "/circle/dashboard/sales",
      permission: "sales:read" as const,
    },
    {
      title: "サークル設定",
      description: "注文モード・拡張機能・サークル情報の編集",
      href: "/circle/dashboard/circle",
      permission: "circle:read" as const,
    },
    {
      title: "メンバー管理",
      description: "メンバーの追加・権限設定",
      href: "/circle/dashboard/members",
      permission: "member:read" as const,
    },
    {
      title: "モバイルオーダーQR",
      description: "店頭掲示用POPシートの表示・印刷",
      href: "/circle/dashboard/qr",
      permission: "circle:read" as const,
    },
    // --- ここから拡張機能 (末尾) ---
    ...(settings.extensions.stock
      ? [{
          title: "在庫管理",
          description: "在庫の確認と更新",
          href: "/circle/dashboard/stock",
          permission: "stock:read" as const,
        }]
      : []),
    ...(settings.extensions.staff
      ? [{
          title: "スタッフ管理",
          description: "シフトとスタッフの管理",
          href: "/circle/dashboard/staff",
          permission: "staff:read" as const,
        }]
      : []),
    // 2026-07-11: 「拡張機能 (モッド)」カードを撤去。独立ページ /circle/dashboard/mods は
    // 既に廃止 (モッド管理はサークル設定へ統合) されており、App.tsx にルートが無いため
    // このカードは押すと * → Placeholder に落ちる死リンクになっていた。
  ];

  // 表示位置に応じて連番(01, 02, ...)を採番する
  const menuItems = rawItems.map((item, i) => ({
    ...item,
    index: String(i + 1).padStart(2, "0"),
  }));

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
              <Link to={item.href}>
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

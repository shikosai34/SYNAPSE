import { useState, useEffect } from "react";
import { circleApi, orderApi, menuApi } from "@/lib/api";
import { CircleAuthGuard, useAuth } from "@/hooks/useCircleAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileSpreadsheet, Receipt, UtensilsCrossed } from "lucide-react";

// CSVセルのエスケープ
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSVファイルの作成とダウンロード
function downloadCsvFile(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function CircleExportContent() {
  const { circleName } = useAuth();
  const [circleId, setCircleId] = useState<string>("");
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
  }, []);

  const startDownload = (key: string) => {
    setDownloading((prev) => ({ ...prev, [key]: true }));
  };

  const endDownload = (key: string) => {
    setDownloading((prev) => ({ ...prev, [key]: false }));
  };

  // 1. サークル統計サマリのエクスポート
  const exportAnalytics = async () => {
    const key = "analytics";
    startDownload(key);
    try {
      const data = await circleApi.analytics(circleId);
      const t = data.totals;

      const headers = ["指標名", "数値", "補足情報"];
      const rows = [
        ["総売上", `¥${t.revenue.toLocaleString()}`, ""],
        ["総注文数", t.orders, `完了率: ${t.completedRate}%`],
        ["総客数", t.customers, `平均客単価: ¥${t.avgSpend.toLocaleString()}`],
        ["平均調理時間", t.avgPrepMin != null ? `${t.avgPrepMin}分` : "データなし", ""],
        ["平均評価", t.avgRating != null ? `★${t.avgRating}` : "未評価", `レビュー数: ${t.reviews}件`],
        ["スキャン訪問者数", t.visitors, ""],
        ["登録商品数", t.menus, ""],
      ];

      downloadCsvFile(`${circleName}_統計サマリ`, headers, rows);
      toast.success("統計サマリをエクスポートしました");
    } catch (e: any) {
      toast.error(e.message || "統計データの取得に失敗しました");
    } finally {
      endDownload(key);
    }
  };

  // 2. 注文履歴のエクスポート
  const exportOrders = async () => {
    const key = "orders";
    startDownload(key);
    try {
      const orders = await orderApi.list(circleId);
      const headers = [
        "注文ID",
        "注文番号",
        "合計金額",
        "支払い方法",
        "ステータス",
        "人数",
        "注文日時",
        "調理完了日時",
      ];
      const rows = orders.map((o) => [
        o.id,
        o.orderNumber,
        o.totalPrice,
        o.paymentMethod || "未設定",
        o.status,
        o.peopleCount,
        o.createdAt ? new Date(o.createdAt).toLocaleString("ja-JP") : "",
        o.completedAt ? new Date(o.completedAt).toLocaleString("ja-JP") : "",
      ]);

      downloadCsvFile(`${circleName}_注文履歴`, headers, rows);
      toast.success("注文履歴をエクスポートしました");
    } catch (e: any) {
      toast.error(e.message || "注文履歴の取得に失敗しました");
    } finally {
      endDownload(key);
    }
  };

  // 3. 商品・メニュー一覧のエクスポート
  const exportMenus = async () => {
    const key = "menus";
    startDownload(key);
    try {
      const menus = await menuApi.list(circleId);
      const headers = ["商品ID", "商品名", "価格", "説明", "販売状況", "在庫数", "トッピングの有無"];
      const rows = menus.map((m) => [
        m.id,
        m.name,
        m.price,
        m.description || "",
        m.soldOut ? "売り切れ" : "販売中",
        m.stockQuantity != null ? m.stockQuantity : "無制限",
        m.toppings && m.toppings.length > 0 ? "あり" : "なし",
      ]);

      downloadCsvFile(`${circleName}_商品メニュー一覧`, headers, rows);
      toast.success("商品・メニュー一覧をエクスポートしました");
    } catch (e: any) {
      toast.error(e.message || "商品一覧の取得に失敗しました");
    } finally {
      endDownload(key);
    }
  };

  const items = [
    {
      key: "analytics",
      title: "サークル統計サマリ",
      description: "サークル単体の売上高、客単価、注文完了率、平均調理時間などの概要データです。",
      icon: FileSpreadsheet,
      action: exportAnalytics,
    },
    {
      key: "orders",
      title: "注文履歴一覧",
      description: "このサークルで受け付けたすべての注文履歴（注文番号、金額、日時、ステータス）です。",
      icon: Receipt,
      action: exportOrders,
    },
    {
      key: "menus",
      title: "商品メニュー一覧",
      description: "登録されているメニュー商品の一覧（価格、説明、在庫上限、販売状況）です。",
      icon: UtensilsCrossed,
      action: exportMenus,
    },
  ];

  return (
    <DashboardLayout title={circleName || "サークルダッシュボード"} subtitle="データエクスポート" type="circle">
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b-thick border-border pb-3">
          <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
            <Download className="h-4 w-4" /> データエクスポート
          </h2>
          <p className="text-[11px] text-muted-foreground font-mono mt-1">
            サークル内の売上・注文履歴・商品一覧などのデータを CSV 形式でダウンロードできます。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => {
            const Icon = item.icon;
            const isDownloading = downloading[item.key] || false;
            return (
              <Card key={item.key} className="rounded-none border-thick border-border shadow-none bg-background flex flex-col justify-between">
                <CardHeader className="p-4 pb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <CardTitle className="text-xs uppercase font-bold tracking-wider">{item.title}</CardTitle>
                  </div>
                  <CardDescription className="text-[10px] leading-relaxed pt-1">
                    {item.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                  <Button
                    onClick={item.action}
                    disabled={isDownloading}
                    className="w-full rounded-none border-thick border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground font-bold text-xs h-9 shadow-none"
                    variant="outline"
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                        エクスポート中...
                      </>
                    ) : (
                      <>
                        <Download className="h-3.5 w-3.5 mr-2" />
                        CSV エクスポート
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default function CircleExportPage() {
  return (
    <CircleAuthGuard>
      <CircleExportContent />
    </CircleAuthGuard>
  );
}

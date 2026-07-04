import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { orderApi } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SalesManagementContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
    const authStored = localStorage.getItem("circleAuth");
    if (authStored) {
      try {
        const authInfo = JSON.parse(authStored);
        if (authInfo.circleName) {
          setCircleName(authInfo.circleName);
        }
      } catch (_) {}
    }
  }, []);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["orders", circleId],
    queryFn: () => orderApi.list(circleId),
    enabled: !!circleId,
  });

  const totalSales =
    orders?.reduce((sum, order) => sum + (order.totalPrice || 0), 0) || 0;
  const completedOrders =
    orders?.filter((order) => order.status === "completed") || [];
  const completedSales = completedOrders.reduce(
    (sum, order) => sum + (order.totalPrice || 0),
    0
  );

  // 時間帯別 (9:00 - 18:00) の売上集計
  const hourlyData = Array.from({ length: 10 }, (_, i) => {
    const hour = i + 9;
    return {
      hour: `${hour}:00`,
      sales: 0,
      count: 0,
    };
  });

  completedOrders.forEach((order) => {
    if (!order.createdAt) return;
    const date = new Date(order.createdAt);
    const hour = date.getHours();
    if (hour >= 9 && hour <= 18) {
      hourlyData[hour - 9].sales += order.totalPrice || 0;
      hourlyData[hour - 9].count += 1;
    }
  });

  const maxHourlySales = Math.max(...hourlyData.map((d) => d.sales), 1000);

  // 商品（メニュー）別の売上集計
  const itemSalesMap: Record<string, { name: string; sales: number; count: number }> = {};
  completedOrders.forEach((order) => {
    order.items?.forEach((item) => {
      const menuName = item.menuName || "不明な商品";
      const itemTotalPrice = (item.menuPrice || 0) * (item.quantity || 1);
      if (!itemSalesMap[menuName]) {
        itemSalesMap[menuName] = { name: menuName, sales: 0, count: 0 };
      }
      itemSalesMap[menuName].sales += itemTotalPrice;
      itemSalesMap[menuName].count += item.quantity || 1;
    });
  });

  const menuSalesData = Object.values(itemSalesMap).sort((a, b) => b.sales - a.sales);
  const maxMenuSales = Math.max(...menuSalesData.map((d) => d.sales), 1000);

  // 時間帯別グラフ用 (SVG 座標)
  const svgWidth = 500;
  const svgHeight = 200;
  const padding = 35;
  const chartWidth = svgWidth - padding * 2;
  const chartHeight = svgHeight - padding * 2;

  const points = hourlyData.map((d, i) => {
    const x = padding + (i / (hourlyData.length - 1)) * chartWidth;
    const y = padding + chartHeight - (d.sales / maxHourlySales) * chartHeight;
    return { x, y, ...d };
  });

  const linePath = points.reduce(
    (acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`),
    ""
  );

  if (isLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="売上管理" type="circle">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={circleName} subtitle="売上管理" type="circle">
      <div className="space-y-6">
        {/* サマリーカード */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-none shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase font-bold text-muted-foreground">総注文数</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black">{orders?.length || 0}件</p>
            </CardContent>
          </Card>

          <Card className="rounded-none shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase font-bold text-muted-foreground">完了注文数</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black">{completedOrders.length}件</p>
            </CardContent>
          </Card>

          <Card className="rounded-none shadow-none bg-primary text-primary-foreground">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase font-bold text-primary-foreground/75">完了売上</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-black">
                ¥{completedSales.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* グラフエリア */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* 時間帯別売上グラフ (SVG) */}
          <Card className="rounded-none shadow-none">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase">[時間帯別売上推移]</CardTitle>
              <CardDescription className="text-[10px]">9:00 - 18:00 の時間帯別売上 (円)</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <div className="w-full max-w-[500px]">
                <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
                  {/* グリッド・目盛り */}
                  {Array.from({ length: 5 }).map((_, i) => {
                    const y = padding + (i / 4) * chartHeight;
                    const val = Math.round(maxHourlySales * (1 - i / 4));
                    return (
                      <g key={i}>
                        <line
                          x1={padding}
                          y1={y}
                          x2={svgWidth - padding}
                          y2={y}
                          stroke="#E5E5E5"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                        <text
                          x={padding - 6}
                          y={y + 3}
                          className="font-mono text-[8px] fill-muted-foreground"
                          textAnchor="end"
                        >
                          ¥{val.toLocaleString()}
                        </text>
                      </g>
                    );
                  })}

                  {/* X軸目盛り */}
                  {points.map((p, i) => (
                    <text
                      key={i}
                      x={p.x}
                      y={svgHeight - padding + 15}
                      className="font-mono text-[8px] fill-muted-foreground"
                      textAnchor="middle"
                    >
                      {p.hour}
                    </text>
                  ))}

                  {/* 折れ線 */}
                  <path
                    d={linePath}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-foreground"
                  />

                  {/* データ点 */}
                  {points.map((p, i) => (
                    <g key={i} className="group">
                      <rect
                        x={p.x - 3}
                        y={p.y - 3}
                        width="6"
                        height="6"
                        fill="currentColor"
                        className="text-foreground cursor-pointer hover:scale-150 transition-all"
                      />
                      <title>{`${p.hour}: ¥${p.sales.toLocaleString()} (${p.count}件)`}</title>
                    </g>
                  ))}
                </svg>
              </div>
            </CardContent>
          </Card>

          {/* メニュー別売上グラフ (HTML棒) */}
          <Card className="rounded-none shadow-none">
            <CardHeader>
              <CardTitle className="text-sm font-bold uppercase">[メニュー別売上構成]</CardTitle>
              <CardDescription className="text-[10px]">完了したメニューごとの合計売上</CardDescription>
            </CardHeader>
            <CardContent>
              {menuSalesData.length > 0 ? (
                <div className="space-y-4 max-h-[220px] overflow-y-auto pr-2 no-scrollbar">
                  {menuSalesData.map((item, idx) => {
                    const pct = (item.sales / maxMenuSales) * 100;
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex justify-between text-[11px] font-bold uppercase font-mono">
                          <span>{item.name} ({item.count}点)</span>
                          <span>¥{item.sales.toLocaleString()}</span>
                        </div>
                        <div className="w-full h-4 border-thick border-border bg-muted rounded-none relative">
                          <div
                            style={{ width: `${pct}%` }}
                            className="h-full bg-primary transition-all"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-12 uppercase">No menu sales data</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 注文履歴カード */}
        <Card className="rounded-none shadow-none">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase">注文履歴</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {orders?.map((order) => (
                <div
                  key={order.id}
                  className="flex justify-between items-center p-3 border-thick border-border rounded-none text-xs font-mono"
                >
                  <div>
                    <p className="font-bold">{order.orderNumber}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {order.createdAt
                        ? new Date(order.createdAt).toLocaleString("ja-JP")
                        : "-"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black">
                      ¥{(order.totalPrice ?? 0).toLocaleString()}
                    </p>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">
                      {order.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

export default function SalesManagementPage() {
  return (
    <CircleAuthGuard>
      <SalesManagementContent />
    </CircleAuthGuard>
  );
}

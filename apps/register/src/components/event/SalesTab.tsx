import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";

interface SalesTabProps {
  allCirclesOrders: any[] | undefined;
  ordersLoading: boolean;
}

export function SalesTab({
  allCirclesOrders,
  ordersLoading
}: SalesTabProps) {
  const [isChartExpanded, setIsChartExpanded] = useState(false);

  // Sales Aggregations
  const salesStats = (() => {
    if (!allCirclesOrders) return { totalSales: 0, completedOrdersCount: 0, totalOrdersCount: 0 };
    let totalSales = 0;
    let completedOrdersCount = 0;
    let totalOrdersCount = 0;

    allCirclesOrders.forEach((item: any) => {
      totalOrdersCount += item.orders.length;
      item.orders.forEach((o: any) => {
        if (o.status === "completed") {
          totalSales += o.totalPrice || 0;
          completedOrdersCount += 1;
        }
      });
    });

    return { totalSales, completedOrdersCount, totalOrdersCount };
  })();

  // サークル別の売上構成
  const circleSalesData = (() => {
    if (!allCirclesOrders) return [];
    return allCirclesOrders
      .map((item: any) => {
        const sales = item.orders
          .filter((o: any) => o.status === "completed")
          .reduce((sum: number, o: any) => sum + (o.totalPrice || 0), 0);
        return { name: item.circleName, sales };
      })
      .sort((a, b) => b.sales - a.sales);
  })();

  const maxCircleSales = Math.max(...circleSalesData.map((d) => d.sales), 1000);

  // 時間帯別の売上推移 (全サークルマージ)
  const hourlySalesData = (() => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      hour: `${i + 9}:00`,
      sales: 0,
    }));

    if (allCirclesOrders) {
      allCirclesOrders.forEach((item: any) => {
        item.orders.forEach((o: any) => {
          if (o.status === "completed" && o.createdAt) {
            const hour = new Date(o.createdAt).getHours();
            if (hour >= 9 && hour <= 18) {
              data[hour - 9].sales += o.totalPrice || 0;
            }
          }
        });
      });
    }
    return data;
  })();

  const maxHourlySales = Math.max(...hourlySalesData.map((d) => d.sales), 1000);

  // 折れ線グラフ用座標
  const svgWidth = 500;
  const svgHeight = 200;
  const padding = 35;
  const chartWidth = svgWidth - padding * 2;
  const chartHeight = svgHeight - padding * 2;

  const points = hourlySalesData.map((d, i) => {
    const x = padding + (i / (hourlySalesData.length - 1)) * chartWidth;
    const y = padding + chartHeight - (d.sales / maxHourlySales) * chartHeight;
    return { x, y, ...d };
  });

  const linePath = points.reduce(
    (acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`),
    ""
  );

  return (
    <div className="space-y-6 font-mono text-foreground">
      <div className="flex justify-between items-center border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          イベント全体売上統計
        </h2>
      </div>

      {ordersLoading ? (
        <div className="text-center py-12 text-muted-foreground text-xs uppercase tracking-wider">
          Loading sales stats...
        </div>
      ) : (
        <div className="space-y-6">
          {/* 売上概要カード */}
          <div className="grid gap-4 md:grid-cols-3 font-mono">
            <Card className="rounded-none shadow-none">
              <CardHeader className="p-3 pb-1 bg-muted/20 border-b-thin border-border">
                <CardTitle className="text-xs uppercase font-bold text-muted-foreground">総注文数</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-4">
                <p className="text-xl font-black">{salesStats.totalOrdersCount}件</p>
              </CardContent>
            </Card>

            <Card className="rounded-none shadow-none">
              <CardHeader className="p-3 pb-1 bg-muted/20 border-b-thin border-border">
                <CardTitle className="text-xs uppercase font-bold text-muted-foreground">完了取引数</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-4">
                <p className="text-xl font-black">{salesStats.completedOrdersCount}件</p>
              </CardContent>
            </Card>

            <Card className="rounded-none shadow-none bg-primary text-primary-foreground">
              <CardHeader className="p-3 pb-1 bg-primary border-b-thin border-primary-foreground/30">
                <CardTitle className="text-xs uppercase font-bold text-primary-foreground/75">イベント総売上</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-4">
                <p className="text-xl font-black">¥{salesStats.totalSales.toLocaleString()}</p>
              </CardContent>
            </Card>
          </div>

          {/* グラフ */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* サークル別売上 (横棒) */}
            <Card className="rounded-none shadow-none">
              <CardHeader className="p-4 border-b-thin border-border bg-muted/20">
                <CardTitle className="text-sm font-bold uppercase">[サークル別売上比率]</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-4">
                {circleSalesData.length > 0 ? (
                  <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                    {circleSalesData.map((cir, idx) => {
                      const pct = (cir.sales / maxCircleSales) * 100;
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between text-xs font-bold uppercase font-mono">
                            <span>{cir.name}</span>
                            <span>¥{cir.sales.toLocaleString()}</span>
                          </div>
                          <div className="w-full h-3.5 border border-border bg-muted rounded-none relative">
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
                  <p className="text-sm text-muted-foreground text-center py-12">売上データはありません</p>
                )}
              </CardContent>
            </Card>

            {/* 時間帯別売上推移 (折れ線SVG) */}
            <Card className="rounded-none shadow-none">
              <CardHeader className="p-4 border-b-thin border-border bg-muted/20">
                <CardTitle className="text-sm font-bold uppercase">[イベント時間帯別売上]</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-4 flex justify-center">
                <div 
                  className="w-full max-w-[450px] cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setIsChartExpanded(true)}
                  title="クリックして拡大"
                >
                  <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
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
                            className="font-mono text-[10px] fill-muted-foreground"
                            textAnchor="end"
                          >
                            ¥{val.toLocaleString()}
                          </text>
                        </g>
                      );
                    })}

                    {points.map((p, i) => (
                      <text
                        key={i}
                        x={p.x}
                        y={svgHeight - padding + 12}
                        className="font-mono text-[10px] fill-muted-foreground"
                        textAnchor="middle"
                      >
                        {p.hour}
                      </text>
                    ))}

                    <path
                      d={linePath}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-foreground"
                    />

                    {points.map((p, i) => (
                      <g key={i} className="group">
                        <rect
                          x={p.x - 2.5}
                          y={p.y - 2.5}
                          width="5"
                          height="5"
                          fill="currentColor"
                          className="text-foreground cursor-pointer"
                        />
                        <title>{`${p.hour}: ¥${p.sales.toLocaleString()}`}</title>
                      </g>
                    ))}
                  </svg>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Modal
        isOpen={isChartExpanded}
        onClose={() => setIsChartExpanded(false)}
        title="[イベント時間帯別売上]"
        maxWidth="xl"
      >
        <div className="w-full">
          <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
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
                    className="font-mono text-[10px] fill-muted-foreground"
                    textAnchor="end"
                  >
                    ¥{val.toLocaleString()}
                  </text>
                </g>
              );
            })}

            {points.map((p, i) => (
              <text
                key={i}
                x={p.x}
                y={svgHeight - padding + 12}
                className="font-mono text-[10px] fill-muted-foreground"
                textAnchor="middle"
              >
                {p.hour}
              </text>
            ))}

            <path
              d={linePath}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-foreground"
            />

            {points.map((p, i) => (
              <g key={i} className="group">
                <rect
                  x={p.x - 2.5}
                  y={p.y - 2.5}
                  width="5"
                  height="5"
                  fill="currentColor"
                  className="text-foreground cursor-pointer"
                />
                <title>{`${p.hour}: ¥${p.sales.toLocaleString()}`}</title>
              </g>
            ))}
          </svg>
        </div>
        <div className="mt-4 text-center">
          <Button onClick={() => setIsChartExpanded(false)} className="px-8 border-thick font-bold uppercase rounded-none">
            閉じる
          </Button>
        </div>
      </Modal>
    </div>
  );
}

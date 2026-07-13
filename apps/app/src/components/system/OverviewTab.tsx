import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Calendar, Store, Users, Lock, AlertTriangle } from "lucide-react";

// SaaS 運営ダッシュボード (2026-07-12 Phase C)。
// テナント横断の集計 KPI のみを表示する運営ビュー (内容には触れない)。
const STATUS_LABELS: Record<string, string> = {
  active: "有効",
  trial: "試用",
  suspended: "停止",
  unpaid: "未払い",
};

export function OverviewTab() {
  const [isCleaning, setIsCleaning] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: () => adminApi.overview(),
  });

  const { data: expiredData, refetch: refetchExpired } = useQuery({
    queryKey: ["expiredSessionsCount"],
    queryFn: () => adminApi.expiredSessionsCount(),
  });

  const handleCleanup = async () => {
    if (!window.confirm("期限切れセッションをすべてクリーンアップしますか？")) return;
    setIsCleaning(true);
    try {
      await adminApi.cleanupSessions();
      refetchExpired();
    } catch (e) {
      alert("クリーンアップに失敗しました");
    } finally {
      setIsCleaning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (isError || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const kpis = [
    { label: "イベント", value: data.events, icon: Calendar },
    { label: "サークル", value: data.circles, icon: Store },
    { label: "アカウント", value: data.accounts, icon: Users },
    { label: "ロック中", value: data.lockouts, icon: Lock },
  ];

  return (
    <div className="space-y-6">
      {expiredData && expiredData.count >= 100 && (
        <div className="border-thick border-destructive bg-destructive/10 p-4 text-destructive flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono text-[12px]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <span className="font-bold">セッションクリーンアップ推奨:</span> 期限切れのセッションが <span className="font-bold underline">{expiredData.count} 件</span> 蓄積しています。
            </div>
          </div>
          <button
            onClick={handleCleanup}
            disabled={isCleaning}
            className="border-thick border-destructive bg-destructive text-white px-4 py-1.5 font-bold active:translate-y-0.5 disabled:opacity-50 text-[11px] uppercase tracking-wider cursor-pointer"
          >
            {isCleaning ? "処理中..." : "今すぐ削除"}
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="border-thick border-border bg-background p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-[10px] uppercase font-mono font-bold tracking-wider">
              <k.icon className="h-3.5 w-3.5" />
              {k.label}
            </div>
            <div className="text-[32px] font-headline leading-none mt-2">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="border-thick border-border bg-background p-4">
          <h3 className="text-[11px] uppercase font-mono font-bold tracking-wider mb-3">プラン別イベント</h3>
          <div className="space-y-1 font-mono text-[12px]">
            {Object.entries(data.byPlan).length === 0 ? (
              <p className="text-muted-foreground">データなし</p>
            ) : (
              Object.entries(data.byPlan).map(([plan, n]) => (
                <div key={plan} className="flex justify-between">
                  <span>{plan}</span>
                  <span className="font-bold">{n}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="border-thick border-border bg-background p-4">
          <h3 className="text-[11px] uppercase font-mono font-bold tracking-wider mb-3">契約状態</h3>
          <div className="space-y-1 font-mono text-[12px]">
            {Object.entries(data.byStatus).length === 0 ? (
              <p className="text-muted-foreground">データなし</p>
            ) : (
              Object.entries(data.byStatus).map(([status, n]) => (
                <div key={status} className="flex justify-between">
                  <span>{STATUS_LABELS[status] || status}</span>
                  <span className="font-bold">{n}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ユーザー成長数推移グラフ */}
      {(() => {
        const userGrowth = data.userGrowth ?? [];
        const maxVal = Math.max(1, ...userGrowth.map((g) => Math.max(g.accounts, g.visitors)));

        const svgWidth = 500;
        const svgHeight = 200;
        const paddingLeft = 40;
        const paddingRight = 15;
        const paddingTop = 15;
        const paddingBottom = 30;
        const chartWidth = svgWidth - paddingLeft - paddingRight;
        const chartHeight = svgHeight - paddingTop - paddingBottom;

        const points = userGrowth.map((g, i) => {
          const x = paddingLeft + (i / Math.max(1, userGrowth.length - 1)) * chartWidth;
          const yAcc = paddingTop + chartHeight - (g.accounts / maxVal) * chartHeight;
          const yVis = paddingTop + chartHeight - (g.visitors / maxVal) * chartHeight;
          return { x, yAcc, yVis, ...g };
        });

        const lineAccPath = points.reduce(
          (acc, p, i) => (i === 0 ? `M ${p.x} ${p.yAcc}` : `${acc} L ${p.x} ${p.yAcc}`),
          ""
        );

        const lineVisPath = points.reduce(
          (acc, p, i) => (i === 0 ? `M ${p.x} ${p.yVis}` : `${acc} L ${p.x} ${p.yVis}`),
          ""
        );

        return (
          <div className="border-thick border-border bg-background p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-2">
              <h3 className="text-[11px] uppercase font-mono font-bold tracking-wider">[ユーザー登録成長推移 (過去14日間)]</h3>
              <div className="flex items-center gap-4 text-[10px] font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-1 bg-foreground" />
                  <span>アカウント</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-1 bg-accent" />
                  <span>来場者</span>
                </div>
              </div>
            </div>
            {userGrowth.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground text-center py-12 uppercase">No growth data</p>
            ) : (
              <div className="w-full overflow-x-auto no-scrollbar">
                <div className="min-w-[500px]">
                  <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
                    {/* Y軸グリッド */}
                    {Array.from({ length: 5 }).map((_, i) => {
                      const y = paddingTop + (i / 4) * chartHeight;
                      const val = Math.round(maxVal * (1 - i / 4));
                      return (
                        <g key={i}>
                          <line
                            x1={paddingLeft}
                            y1={y}
                            x2={svgWidth - paddingRight}
                            y2={y}
                            stroke="#E5E5E5"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          <text
                            x={paddingLeft - 6}
                            y={y + 3}
                            className="font-mono text-[9px] fill-muted-foreground"
                            textAnchor="end"
                          >
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* X軸目盛り */}
                    {points.map((p, i) => {
                      // 重なりを防ぐため奇数インデックス＋最後のみ
                      if (i % 2 !== 0 && i !== points.length - 1) return null;
                      return (
                        <text
                          key={i}
                          x={p.x}
                          y={svgHeight - paddingBottom + 15}
                          className="font-mono text-[9px] fill-muted-foreground"
                          textAnchor="middle"
                        >
                          {p.date}
                        </text>
                      );
                    })}

                    {/* アカウント折れ線 */}
                    <path
                      d={lineAccPath}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-foreground"
                    />

                    {/* 来場者折れ線 */}
                    <path
                      d={lineVisPath}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="text-accent"
                    />

                    {/* データ点 */}
                    {points.map((p, i) => (
                      <g key={i} className="group">
                        <circle
                          cx={p.x}
                          cy={p.yAcc}
                          r="3"
                          fill="currentColor"
                          className="text-foreground cursor-pointer hover:scale-150 transition-all"
                        />
                        <circle
                          cx={p.x}
                          cy={p.yVis}
                          r="3"
                          fill="currentColor"
                          className="text-accent cursor-pointer hover:scale-150 transition-all"
                        />
                        <title>{`${p.date} - アカウント: ${p.accounts}人 / 来場者: ${p.visitors}人`}</title>
                      </g>
                    ))}
                  </svg>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventApi, type LiveOrder } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { MonitorCheck, Radio, AlertTriangle } from "lucide-react";

// 全サークル横断の注文モニタ (2026-07-12)
// 進行中(pending/preparing)の注文を古い順に表示し、経過時間が長いものを遅延として警告する。
// LIVE ON で 10 秒ごとに自動更新。event_manager(order:read) 権限。

// 遅延しきい値(分)。estimatedTime があればそれを超過、無ければ既定で判定。
const WARN_MIN = 15;
const DANGER_MIN = 25;

function ageMin(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
}

export function OrderMonitorTab({ eventId }: { eventId: string }) {
  const [live, setLive] = useState(true);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["event-live-orders", eventId],
    queryFn: () => eventApi.liveOrders(eventId),
    enabled: !!eventId,
    refetchInterval: live ? 10_000 : false,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  const orders = data ?? [];
  const delayed = orders.filter((o) => ageMin(o.createdAt) >= WARN_MIN).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b-thick border-border pb-3">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
            <MonitorCheck className="h-4 w-4" /> 注文モニタ
          </h2>
          <p className="text-[11px] text-muted-foreground font-mono mt-1">
            進行中 {orders.length} 件
            {delayed > 0 && <span className="text-error font-bold"> / 遅延 {delayed} 件</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          className={`flex items-center gap-1 font-mono text-[11px] uppercase border-thick px-2 py-1 ${
            live ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted"
          }`}
        >
          <Radio className={`h-3.5 w-3.5 ${live ? "animate-pulse" : ""}`} /> LIVE
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState icon={MonitorCheck} message="進行中の注文はありません" />
      ) : (
        <div className="space-y-1.5">
          {orders.map((o: LiveOrder) => {
            const age = ageMin(o.createdAt);
            const level = age >= DANGER_MIN ? "danger" : age >= WARN_MIN ? "warn" : "ok";
            return (
              <div
                key={o.id}
                className={`flex items-center justify-between gap-3 p-2.5 border-thick font-mono text-[12px] ${
                  level === "danger"
                    ? "border-error bg-error/10"
                    : level === "warn"
                      ? "border-warning bg-warning/10"
                      : "border-border bg-background"
                }`}
              >
                <div className="min-w-0">
                  <span className="font-bold">{o.circleName}</span>
                  <span className="text-muted-foreground"> · #{o.orderNumber}</span>
                  <span className="text-muted-foreground"> · {o.status === "pending" ? "未着手" : "調理中"}</span>
                  <span className="text-muted-foreground"> · {o.peopleCount}名</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 tabular-nums">
                  {level !== "ok" && <AlertTriangle className="h-3.5 w-3.5 text-error" />}
                  <span className={level !== "ok" ? "font-bold text-error" : "text-muted-foreground"}>
                    {age}分経過
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="font-mono text-[10px] text-muted-foreground">
        {WARN_MIN}分以上を注意(黄)、{DANGER_MIN}分以上を遅延(赤)として表示します。
      </p>
    </div>
  );
}

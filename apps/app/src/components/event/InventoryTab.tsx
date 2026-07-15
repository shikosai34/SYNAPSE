import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventApi, type InventoryItem } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Boxes, Radio, XCircle, AlertTriangle } from "lucide-react";

// 全サークルの在庫/売り切れ一覧 (2026-07-12)
// event_manager(stock:read) 権限。売り切れ・在庫僅少を強調。LIVE ON で 20 秒ごと更新。
// 在庫僅少のしきい値 (これ以下で警告)。
const LOW_STOCK = 5;

export function InventoryTab({ eventId }: { eventId: string }) {
  const [live, setLive] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["event-inventory", eventId],
    queryFn: () => eventApi.inventory(eventId),
    enabled: !!eventId,
    refetchInterval: live ? 20_000 : false,
  });

  const items = data ?? [];
  // 在庫僅少は「在庫管理ONのサークル」だけで判定する (OFFのサークルは売切のみ扱い、残数は無意味)。
  const isLow = (m: InventoryItem) => m.stockManaged && !m.soldOut && m.stockQuantity <= LOW_STOCK;
  const soldOutCount = items.filter((m) => m.soldOut).length;
  const lowCount = items.filter(isLow).length;

  const shown = useMemo(
    () => (onlyIssues ? items.filter((m) => m.soldOut || isLow(m)) : items),
    [items, onlyIssues]
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b-thick border-border pb-3">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
            <Boxes className="h-4 w-4" /> 在庫・売り切れ
          </h2>
          <p className="text-[11px] text-muted-foreground font-mono mt-1">
            {items.length} 品
            {soldOutCount > 0 && <span className="text-error font-bold"> / 売切 {soldOutCount}</span>}
            {lowCount > 0 && <span className="text-warning font-bold"> / 僅少 {lowCount}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOnlyIssues((v) => !v)}
            className={`font-mono text-[11px] uppercase border-thick px-2 py-1 ${
              onlyIssues ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted"
            }`}
          >
            要対応のみ
          </button>
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
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Boxes} message={onlyIssues ? "売り切れ・在庫僅少はありません" : "メニューがありません"} />
      ) : (
        <div className="space-y-1">
          {shown.map((m: InventoryItem) => {
            const level = m.soldOut ? "out" : isLow(m) ? "low" : "ok";
            return (
              <div
                key={m.id}
                className={`flex items-center justify-between gap-3 p-2.5 border-thin font-mono text-[12px] ${
                  level === "out"
                    ? "border-error bg-error/10"
                    : level === "low"
                      ? "border-warning bg-warning/10"
                      : "border-border bg-background"
                }`}
              >
                <div className="min-w-0">
                  <span className="text-muted-foreground">{m.circleName}</span>
                  <span> · {m.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                  {level === "out" ? (
                    <span className="flex items-center gap-1 text-error font-bold">
                      <XCircle className="h-3.5 w-3.5" /> 売り切れ
                    </span>
                  ) : level === "low" ? (
                    <span className="flex items-center gap-1 text-warning font-bold">
                      <AlertTriangle className="h-3.5 w-3.5" /> 残{m.stockQuantity}
                    </span>
                  ) : m.stockManaged ? (
                    <span className="text-muted-foreground">残{m.stockQuantity}</span>
                  ) : (
                    <span className="text-success">販売中</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="font-mono text-[10px] text-muted-foreground">
        在庫 {LOW_STOCK} 以下を僅少(黄)として警告します。在庫の増減はレジ/サークル側の操作で反映されます。
      </p>
    </div>
  );
}

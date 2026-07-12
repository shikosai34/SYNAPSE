import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { Calendar, Store, Users, Lock } from "lucide-react";

// SaaS 運営ダッシュボード (2026-07-12 Phase C)。
// テナント横断の集計 KPI のみを表示する運営ビュー (内容には触れない)。
const STATUS_LABELS: Record<string, string> = {
  active: "有効",
  trial: "試用",
  suspended: "停止",
  unpaid: "未払い",
};

export function OverviewTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: () => adminApi.overview(),
  });

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
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { adminApi, type AuditEntry } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { ScrollText } from "lucide-react";

// 監査ログ (2026-07-12 Phase E)。昇格・なりすまし開始/終了・なりすまし中の変更を記録。
const ACTION_LABELS: Record<string, string> = {
  elevate: "昇格",
  impersonate_start: "なりすまし開始",
  impersonate_stop: "なりすまし終了",
  impersonated_write: "なりすまし中の変更",
};

export function AuditTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["adminAudit"],
    queryFn: () => adminApi.listAudit(),
    refetchInterval: 60_000,
  });

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
  if (!data || data.length === 0) {
    return <EmptyState icon={ScrollText} message="監査ログはまだありません" />;
  }

  return (
    <div className="space-y-4">
      <div className="border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
          <ScrollText className="h-4 w-4" />
          監査ログ ({data.length})
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mt-1">
          運営者の昇格・なりすまし・なりすまし中の変更操作を記録しています。
        </p>
      </div>

      <div className="space-y-1">
        {data.map((a: AuditEntry) => (
          <div
            key={a.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-2.5 border-thin border-border bg-background font-mono text-[11px]"
          >
            <div className="min-w-0">
              <span className="font-bold uppercase">{ACTION_LABELS[a.action] || a.action}</span>
              <span className="text-muted-foreground"> — {a.actorEmail}</span>
              {a.asRole && <span className="text-muted-foreground"> as {a.asRole}</span>}
              {(a.method || a.path) && (
                <span className="text-muted-foreground break-all">
                  {" "}
                  {a.method} {a.path}
                </span>
              )}
              {a.summary && <span className="text-muted-foreground"> · {a.summary}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0">
              {new Date(a.createdAt).toLocaleString("ja-JP")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

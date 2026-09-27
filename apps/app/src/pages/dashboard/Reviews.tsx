import { useQuery } from "@tanstack/react-query";
import { reviewApi, type ManagedReview } from "@/lib/api";
import { useAuth, PermissionGuard } from "@/hooks/useCircleAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Star } from "lucide-react";

function ReviewRows({ rows, isLoading, isError, error, retry, showCircle }: {
  rows?: ManagedReview[]; isLoading: boolean; isError: boolean; error: unknown; retry: () => void; showCircle: boolean;
}) {
  if (isLoading) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (isError) return <ErrorState error={error} onRetry={retry} />;
  if (!rows?.length) return <EmptyState icon={Star} message="レビューはまだありません" />;
  return <div className="divide-y-thin divide-border">
    {rows.map((row, index) => (
      <article key={`${row.circleId ?? "circle"}-${row.displayId}-${index}`} className="py-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {showCircle && <strong className="text-sm">{row.circleName}</strong>}
          <span className="text-xs font-bold">来場者 {String(row.displayId).padStart(2, "0")}</span>
          <span className="flex items-center text-warning" aria-label={`${row.rating}つ星`}>
            {Array.from({ length: 5 }, (_, i) => <Star key={i} className={`h-4 w-4 ${i < row.rating ? "fill-current" : "text-muted-foreground"}`} />)}
            <span className="ml-1 text-foreground text-xs">{row.rating}/5</span>
          </span>
          <time className="text-[10px] text-muted-foreground">{new Date(row.createdAt).toLocaleString("ja-JP")}</time>
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">{row.comment || "（コメントなし）"}</p>
      </article>
    ))}
  </div>;
}

export function CircleReviewsPage() {
  const { circleId, circleName } = useAuth();
  const query = useQuery({ queryKey: ["circle-reviews", circleId], queryFn: () => reviewApi.circle(circleId!), enabled: !!circleId });
  const rows = query.data ?? [];
  return <PermissionGuard permission="sales:read"><DashboardLayout title={circleName || "サークルレビュー"} subtitle="来場者の評価・感想" type="circle">
    <ReviewRows rows={rows} isLoading={query.isLoading} isError={query.isError} error={query.error} retry={() => query.refetch()} showCircle={false} />
  </DashboardLayout></PermissionGuard>;
}

// 2026-09-27: 管理側レビュー本文は既存の売上閲覧権限を持つサークル担当者だけに表示する。
export default CircleReviewsPage;

export function EventReviewsTab({ eventId }: { eventId: string }) {
  const query = useQuery({ queryKey: ["event-reviews", eventId], queryFn: () => reviewApi.event(eventId), enabled: !!eventId });
  return <ReviewRows rows={query.data} isLoading={query.isLoading} isError={query.isError} error={query.error} retry={() => query.refetch()} showCircle />;
}

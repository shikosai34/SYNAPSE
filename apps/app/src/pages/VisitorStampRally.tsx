import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Ticket } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisitor } from "@/hooks/useVisitor";
import { stampRallyApi } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/asset-url";

export default function VisitorStampRallyPage() {
  const navigate = useNavigate();
  const { userId, isLoaded } = useVisitor();
  const query = useQuery({
    queryKey: ["visitor-stamp-rally", userId],
    queryFn: () => stampRallyApi.visitor(userId!),
    enabled: !!userId,
  });

  if (!isLoaded || query.isLoading) {
    return <div className="max-w-2xl mx-auto p-4 space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-56 w-full" /></div>;
  }

  return (
    <main className="max-w-2xl mx-auto p-4 pb-24 space-y-5">
      <button onClick={() => navigate("/visitor/mypage")} className="text-xs uppercase underline flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" />マイページに戻る
      </button>
      <header className="border-b-thick border-border pb-4">
        <h1 className="text-2xl font-black uppercase flex items-center gap-2"><Ticket className="h-6 w-6" />[店舗利用実績]</h1>
        <p className="text-xs text-muted-foreground mt-2">受取完了した店舗のサークルカットがスタンプになります。各エリアの条件を達成すると景品交換の案内が表示されます。</p>
      </header>

      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {!query.isError && (!query.data?.enabled || query.data.areas.length === 0) ? (
        <EmptyState icon={Ticket} message="このイベントではスタンプラリーを実施していません" />
      ) : null}

      {!query.isError && query.data?.enabled && query.data.areas.map((area) => {
        const stampedCount = area.circles.filter((circle) => circle.stamped).length;
        const achieved = stampedCount >= area.requiredCount;
        return (
          <section key={area.id} className="border-b-thick border-border pb-5 space-y-4" aria-labelledby={`stamp-area-${area.id}`}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 id={`stamp-area-${area.id}`} className="text-lg font-black">{area.name}</h2>
                <p className="text-[11px] text-muted-foreground">対象店舗 {area.circles.length} 店舗・必要数 {area.requiredCount} 店舗</p>
              </div>
              <p className={`shrink-0 text-sm font-black ${achieved ? "text-success" : "text-muted-foreground"}`} aria-live="polite">
                {stampedCount} / {area.requiredCount}
              </p>
            </div>

            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3" aria-label={`${area.name}のスタンプ`}>
              {area.circles.map((circle) => (
                <li key={circle.id} className={`min-w-0 text-center ${circle.stamped ? "" : "opacity-35 grayscale"}`}>
                  <div className={`aspect-square border-thick border-border bg-background p-1 flex items-center justify-center ${circle.stamped ? "" : "border-dashed"}`}>
                    {circle.iconImagePath ? (
                      <img src={resolveAssetUrl(circle.iconImagePath)} alt={`${circle.name}のサークルカット`} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[10px] font-black break-all">{circle.name}</span>
                    )}
                    {circle.stamped && <CheckCircle2 className="absolute h-5 w-5 sr-only" aria-hidden="true" />}
                  </div>
                  <p className="mt-1 text-[10px] font-bold leading-tight break-words">{circle.name}</p>
                  <p className="text-[9px] uppercase text-muted-foreground">{circle.stamped ? "利用済み" : "未利用"}</p>
                </li>
              ))}
            </ul>

            {achieved && (
              <div className="border-heavy border-border bg-primary text-primary-foreground p-4 space-y-2" role="status">
                <h3 className="text-sm font-black uppercase flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />[景品交換できます]</h3>
                <p className="font-bold">{area.rewardTitle || "景品交換"}</p>
                {area.rewardDescription && <p className="text-xs leading-relaxed">{area.rewardDescription}</p>}
                <p className="text-[10px] text-primary-foreground/80">この画面をイベント本部の景品交換窓口で提示してください。</p>
              </div>
            )}
          </section>
        );
      })}
    </main>
  );
}

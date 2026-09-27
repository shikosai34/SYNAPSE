import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVisitor } from "@/hooks/useVisitor";
import { reviewApi, type VisitorReviewTarget } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ArrowLeft, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";

function ReviewCard({ target, userId }: { target: VisitorReviewTarget; userId: string }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(target.review?.rating ?? 0);
  const [comment, setComment] = useState(target.review?.comment ?? "");
  const mutation = useMutation({
    mutationFn: () => reviewApi.submit(userId, { circleId: target.circleId, rating, comment }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visitor-reviews", userId] }),
  });
  const dirty = rating !== (target.review?.rating ?? 0) || comment !== (target.review?.comment ?? "");
  return (
    <section className="border-b-thin border-border py-5 space-y-4" aria-labelledby={`review-${target.circleId}`}>
      <div>
        <h2 id={`review-${target.circleId}`} className="text-base font-black">{target.circleName}</h2>
        <p className="text-xs text-muted-foreground mt-1">体験したサークルへの評価は、運営者のみが確認できます。</p>
      </div>
      <fieldset>
        <legend className="text-xs font-bold uppercase mb-2">評価（必須）</legend>
        <div className="flex gap-2" role="group" aria-label={`${target.circleName}の評価`}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" aria-label={`${value}つ星`} aria-pressed={rating === value}
              onClick={() => setRating(value)} className="p-2 border-thick border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-info">
              <Star className={`h-5 w-5 ${value <= rating ? "fill-current text-warning" : "text-muted-foreground"}`} />
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-xs font-bold uppercase" htmlFor={`comment-${target.circleId}`}>感想（任意）</label>
      <textarea id={`comment-${target.circleId}`} maxLength={1000} rows={4} value={comment}
        onChange={(event) => setComment(event.target.value)} placeholder="よかった点や気づいたことを書いてください"
        className="w-full border-thick border-border bg-input p-3 text-sm font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-info" />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-muted-foreground">{comment.length}/1000文字</span>
        <Button disabled={!rating || !dirty || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "送信中…" : target.review ? "レビューを更新" : "レビューを送信"}
        </Button>
      </div>
      {mutation.isError && <p role="alert" className="text-sm text-error">送信できませんでした。通信状況を確認して再度お試しください。</p>}
      {mutation.isSuccess && <p role="status" className="text-sm text-success">レビューを保存しました。</p>}
    </section>
  );
}

export default function VisitorReviewsPage() {
  const navigate = useNavigate();
  const { userId, isLoaded } = useVisitor();
  const query = useQuery({
    queryKey: ["visitor-reviews", userId],
    queryFn: () => reviewApi.mine(userId!),
    enabled: !!userId,
  });
  if (!isLoaded || query.isLoading) return <div className="max-w-2xl mx-auto p-4 space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-48 w-full" /></div>;
  return (
    <main className="max-w-2xl mx-auto p-4 pb-24">
      <button onClick={() => navigate("/visitor/orders")} className="text-xs uppercase underline flex items-center gap-1 mb-5">
        <ArrowLeft className="h-4 w-4" />注文履歴に戻る
      </button>
      <header className="border-b-thick border-border pb-4 mb-2">
        <h1 className="text-2xl font-black uppercase flex items-center gap-2"><Star className="h-6 w-6" />[レビュー]</h1>
        <p className="text-xs text-muted-foreground mt-2">体験履歴のあるサークルを評価できます。投稿内容は来場者には公開されず、サークル・イベント運営者のみが確認できます。</p>
      </header>
      {query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : null}
      {!query.isError && query.data?.length === 0 ? <EmptyState icon={Star} message="レビューできる体験履歴はありません" /> : null}
      <div>{query.data?.map((target) => <ReviewCard key={target.circleId} target={target} userId={userId!} />)}</div>
    </main>
  );
}

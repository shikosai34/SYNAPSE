import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileUp, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { wristbandApi, type WristbandBatch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 20;

interface WristbandBatchHistoryProps {
  eventId: string;
  activeBatchId: string | null;
  onResume: (batch: WristbandBatch) => void;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function statusLabel(batch: WristbandBatch): string {
  if (batch.status === "completed") return "完了";
  if (batch.status === "conflict") return "要確認";
  if (batch.status === "processing") return "登録途中";
  return "未登録";
}

function statusClass(batch: WristbandBatch): string {
  if (batch.status === "completed") return "border-success bg-success/10 text-success";
  if (batch.status === "conflict") return "border-error bg-error/10 text-error";
  return "border-warning bg-warning/10 text-foreground";
}

export function WristbandBatchHistory({ eventId, activeBatchId, onResume }: WristbandBatchHistoryProps) {
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);
  const batchesQuery = useInfiniteQuery({
    queryKey: ["wristbandBatchHistory", eventId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => wristbandApi.listBatches(eventId, pageParam, PAGE_SIZE),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
  });
  const batches = batchesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const downloadCsv = async (batch: WristbandBatch) => {
    setDownloadingBatchId(batch.id);
    try {
      const blob = await wristbandApi.downloadBatchCsv(batch.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `wristbands_${batch.id}_${batch.totalCount}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSVをダウンロードできませんでした");
    } finally {
      setDownloadingBatchId(null);
    }
  };

  return (
    <section aria-labelledby="wristband-batch-history-title" className="border-t-thick border-border pt-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h4 id="wristband-batch-history-title" className="text-xs font-bold uppercase">[発行・取込履歴]</h4>
          <p className="text-[10px] text-muted-foreground">画面を閉じた後もCSVを再取得し、未完了の登録を続けられます。</p>
        </div>
        {batchesQuery.data && <span className="text-[10px] text-muted-foreground">全{batchesQuery.data.pages[0]?.total ?? 0}件</span>}
      </div>

      {batchesQuery.isPending ? (
        <p role="status" className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> 履歴を読み込み中...
        </p>
      ) : batchesQuery.isError ? (
        <div role="alert" className="flex flex-col gap-2 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="text-error">発行履歴を読み込めませんでした。</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void batchesQuery.refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> 再読み込み
          </Button>
        </div>
      ) : batches.length === 0 ? (
        <div className="border-t-thin border-border py-4 text-xs">
          <p>このイベントの履歴はまだありません。</p>
          <p className="mt-1 text-[10px] text-muted-foreground">人数指定で作成するか、印刷会社から戻ったCSVを取り込むとここに記録されます。</p>
        </div>
      ) : (
        <ul className="divide-y divide-border border-t-thin border-border">
          {batches.map((batch) => {
            const active = activeBatchId === batch.id;
            const isGenerated = batch.source === "generated";
            return (
              <li key={batch.id} className="py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default" className="rounded-none border-thin text-[10px]">
                        {isGenerated ? <Plus className="mr-1 h-3 w-3" /> : <FileUp className="mr-1 h-3 w-3" />}
                        {isGenerated ? "人数指定" : "CSV取込"}
                      </Badge>
                      <Badge variant="default" className={`rounded-none border-thin text-[10px] ${statusClass(batch)}`}>
                        {active && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        {active ? "登録中" : statusLabel(batch)}
                      </Badge>
                      <time className="text-[10px] text-muted-foreground" dateTime={batch.createdAt}>{formatCreatedAt(batch.createdAt)}</time>
                    </div>
                    <p className="break-all text-xs font-bold">
                      {isGenerated && batch.prefix ? `${batch.prefix} · ` : ""}{batch.totalCount.toLocaleString("ja-JP")}件
                      {isGenerated && batch.suffixLength ? ` · ランダム${batch.suffixLength}文字` : ""}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {batch.processedCount.toLocaleString("ja-JP")} / {batch.totalCount.toLocaleString("ja-JP")}件 登録済み
                      {batch.status === "conflict" && ` · 重複${batch.conflictCount}件`}
                    </p>
                    {batch.errorMessage && (
                      <p role="alert" className="flex items-start gap-1.5 text-[10px] text-error">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {batch.errorMessage}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
                    {(batch.status === "pending" || batch.status === "processing") && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={active || activeBatchId !== null}
                        onClick={() => onResume(batch)}
                        aria-label={`${batch.totalCount}件のバッチを${batch.status === "pending" ? "登録開始" : "続行"}`}
                      >
                        {active ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                        {active ? "登録中..." : batch.status === "pending" ? "登録を開始" : "未登録分を続ける"}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      disabled={downloadingBatchId !== null}
                      onClick={() => void downloadCsv(batch)}
                      aria-label={`${batch.totalCount}件のURL CSVをダウンロード`}
                    >
                      {downloadingBatchId === batch.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                      CSVを再ダウンロード
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {batchesQuery.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full sm:w-auto"
          disabled={batchesQuery.isFetchingNextPage}
          onClick={() => void batchesQuery.fetchNextPage()}
        >
          {batchesQuery.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {batchesQuery.isFetchingNextPage ? "読み込み中..." : "過去の履歴をさらに表示"}
        </Button>
      )}
    </section>
  );
}

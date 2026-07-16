import { useQuery } from "@tanstack/react-query";
import { eventApi, type BillingStatus } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { CreditCard, Coins, Info } from "lucide-react";

/**
 * 契約状況 (オーナー向け) (2026-07-16)。
 *
 * これまで契約情報 (プラン/契約状態/上限/金額) は super_admin の契約管理画面にしか無く、
 * オーナー自身が自分の契約を確認できなかったため追加した。
 * 変更操作は置かない = 参照専用。プラン変更や入金の反映は運営側で行う運用のため、
 * ここでは「今どうなっているか」だけを正確に見せて、変更は問い合わせに誘導する。
 * 運営メモ(contractNotes)や入金の記録者はサーバ側で除外済み。
 */
const STATUS_LABELS: Record<BillingStatus, string> = {
  active: "有効",
  trial: "試用",
  suspended: "停止",
  unpaid: "未払い",
};

const yen = (n: number) => `¥${(n ?? 0).toLocaleString()}`;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";

export function ContractTab({ eventId }: { eventId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["eventContract", eventId],
    queryFn: () => eventApi.contract(eventId),
    enabled: !!eventId,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (isError || !data) return <ErrorState error={error} title="契約状況の取得に失敗しました" onRetry={() => refetch()} />;

  const attention = data.billingStatus === "suspended" || data.billingStatus === "unpaid";

  return (
    <div className="space-y-5 font-mono text-foreground">
      <div className="flex items-center gap-2 border-b-thick border-border pb-3">
        <CreditCard className="h-4 w-4" />
        <h2 className="text-sm font-bold uppercase tracking-wider">契約状況</h2>
      </div>

      {/* 停止/未払いのときは最初に理由と影響を伝える */}
      {attention && (
        <div className="border-thick border-error bg-error/10 p-3">
          <p className="text-xs font-black uppercase tracking-wider text-error">
            {data.billingStatus === "suspended" ? "この契約は停止中です" : "お支払いが確認できていません"}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
            {data.billingStatus === "suspended"
              ? "停止中はサークルの新規作成や注文の受付ができません。運営までお問い合わせください。"
              : "入金が確認されると「有効」に戻ります。お心当たりがない場合は運営までお問い合わせください。"}
          </p>
        </div>
      )}

      {/* サマリ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { label: "プラン", value: data.plan.toUpperCase(), cls: "" },
          { label: "契約状態", value: STATUS_LABELS[data.billingStatus] ?? data.billingStatus, cls: attention ? "text-error" : "text-success" },
          { label: "契約金額", value: data.billingAmount > 0 ? yen(data.billingAmount) : "—", cls: "" },
          { label: "サークル数", value: `${data.circleCount}/${data.maxCircles}`, cls: data.circleCount >= data.maxCircles ? "text-warning" : "" },
        ].map((s) => (
          <div key={s.label} className="border-thick border-border bg-background p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</div>
            <div className={`font-headline text-[20px] leading-none tabular-nums mt-1 ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 契約明細 */}
      <Card className="rounded-none bg-background shadow-none">
        <CardContent className="pt-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            <Row label="契約金額" value={data.billingAmount > 0 ? yen(data.billingAmount) : "未設定"} />
            <Row label="入金合計" value={yen(data.paidTotal)} />
            <Row
              label="残額"
              value={data.outstanding > 0 ? yen(data.outstanding) : "なし"}
              valueCls={data.outstanding > 0 ? "text-warning font-bold" : ""}
            />
            <Row label="次回請求日" value={day(data.nextBillingAt)} />
            <Row label="サークル上限" value={`${data.circleCount} / ${data.maxCircles} サークル`} />
            <Row label="利用開始日" value={day(data.activatedAt)} />
            {data.suspendedAt && <Row label="停止日" value={day(data.suspendedAt)} valueCls="text-error" />}
          </dl>
        </CardContent>
      </Card>

      {/* 入金履歴 */}
      <Card className="rounded-none bg-background shadow-none">
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between border-b-thin border-border pb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" /> 入金履歴
            </h3>
            <span className="text-[11px] text-muted-foreground">合計 {yen(data.paidTotal)}</span>
          </div>
          {data.payments.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">入金の記録はまだありません。</p>
          ) : (
            <div className="divide-y divide-border border-thick border-border">
              {data.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-[11px]">
                  <span className="font-bold tabular-nums shrink-0">{yen(p.amount)}</span>
                  <span className="text-muted-foreground truncate flex-1 text-right">
                    {p.method} · {day(p.paidAt)}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground flex items-start gap-1.5 leading-relaxed">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        プランの変更・お支払いに関するご相談は運営までお問い合わせください。この画面は参照専用で、内容は運営側の登録に基づいて表示されます。
      </p>
    </div>
  );
}

function Row({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b-thin border-border/40 pb-1.5">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{label}</dt>
      <dd className={`tabular-nums text-right ${valueCls ?? ""}`}>{value}</dd>
    </div>
  );
}

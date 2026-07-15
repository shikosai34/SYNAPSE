import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventApi, type EventBehavior } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Activity, RefreshCw, Radio, Users, Clock, Repeat, Footprints, UserCheck, ArrowRight } from "lucide-react";

// 来場者行動・混雑・スタッフ分析タブ (2026-07-14)
// 「一人一人の行動ログ(注文・回遊・スタンプ・受付時刻)」の横断集計を表示する。
// 既存の統計・分析タブ(売上/メニュー中心)では見えない、滞在・回遊・離脱・スタッフ負荷・動線を扱う。
// バックエンド: GET /api/festivals/:id/behavior (sales:read 権限)。

function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border-thick border-border bg-background p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span className="font-mono text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <div className="font-headline text-[24px] leading-none tabular-nums">{value}</div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// 単純横棒 (件数分布用)
function DistBars({ rows, max }: { rows: { label: string; count: number }[]; max: number }) {
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
          <span className="w-24 shrink-0 text-right text-muted-foreground truncate">{r.label}</span>
          <div className="flex-1 bg-muted h-4 relative">
            <div className="h-4 bg-accent" style={{ width: max > 0 ? `${Math.max(2, (r.count / max) * 100)}%` : "0%" }} />
          </div>
          <span className="w-12 shrink-0 tabular-nums text-right">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export function BehaviorTab({ eventId }: { eventId: string }) {
  const [live, setLive] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["event-behavior", eventId],
    queryFn: () => eventApi.behavior(eventId),
    enabled: !!eventId,
    refetchInterval: live ? 15_000 : false,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <EmptyState icon={Activity} message="分析データがありません" />;

  const b: EventBehavior = data;
  const j = b.journey;

  // 表示は営業がある時間帯 (活動 or 受付がある範囲) に絞る
  const activeHours = b.byHour.filter((h) => h.activeUsers > 0 || h.arrivals > 0 || h.orders > 0);
  const maxActive = Math.max(1, ...b.byHour.map((h) => h.activeUsers));
  const maxStaff = Math.max(1, ...b.byHour.map((h) => h.staffOnShift));
  const maxStay = Math.max(1, ...b.stayBuckets.map((s) => s.count));
  const maxCircleCount = Math.max(1, ...b.circleCountBuckets.map((s) => s.count));
  const maxFunnel = Math.max(1, ...b.funnel.map((f) => f.count));
  const maxOPS = Math.max(1, ...b.staffing.byCircle.map((s) => s.ordersPerStaff ?? 0));
  const maxTrans = Math.max(1, ...b.topTransitions.map((t) => t.count));

  const fmtHour = (h: number) => `${String(h).padStart(2, "0")}時`;

  return (
    <div className="space-y-6 text-foreground">
      <div className="flex items-center justify-between border-b-thick border-border pb-3">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
            <Activity className="h-4 w-4" /> 来場者行動・混雑分析
          </h2>
          <p className="text-[10px] text-muted-foreground mt-1 font-mono">
            一人一人の行動ログから、滞在・回遊・離脱・混雑とスタッフ配置の負荷・動線を可視化します。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={`flex items-center gap-1 font-mono text-[11px] uppercase border-thick px-2 py-1 transition-colors ${
              live ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted"
            }`}
            title="ONで15秒ごとに自動更新 (開催中のライブ表示)"
          >
            <Radio className={`h-3.5 w-3.5 ${live ? "animate-pulse" : ""}`} /> LIVE
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 font-mono text-[11px] uppercase border-thick border-border px-2 py-1 hover:bg-muted"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> 更新
          </button>
        </div>
      </div>

      {/* KPI: 一人あたりの行動 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="購入転換率" value={`${j.buyerRate}%`} sub={`来場${j.visitors}人中 ${j.buyers}人が購入`} icon={Users} />
        <StatCard label="平均滞在時間" value={`${j.avgStayMin}分`} sub={`中央値 ${j.medianStayMin}分`} icon={Clock} />
        <StatCard label="平均回遊サークル" value={`${j.avgCirclesPerVisitor}`} sub={`複数回遊率 ${j.multiCircleRate}%`} icon={Footprints} />
        <StatCard label="リピート購入率" value={`${j.repeatBuyerRate}%`} sub={`購入者のうち2回以上`} icon={Repeat} />
        <StatCard label="購入者の平均注文数" value={`${j.avgOrdersPerBuyer}`} />
        <StatCard label="購入者の平均消費額" value={yen(j.avgSpendPerBuyer)} />
        <StatCard label="ピーク時間帯" value={b.peakHour != null ? fmtHour(b.peakHour) : "—"} sub="活動来場者が最多" />
        <StatCard label="登録スタッフ数" value={`${b.staffing.totalStaff}人`} icon={UserCheck} />
      </div>

      {/* 時間帯別 混雑 × スタッフ稼働 */}
      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          時間帯別 混雑度 (活動来場者) × スタッフ稼働
        </h3>
        {activeHours.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">まだ行動データがありません。</p>
        ) : (
          <div className="border-thick border-border p-3 overflow-x-auto">
            <div className="space-y-1.5 min-w-[520px]">
              {activeHours.map((h) => (
                <div key={h.hour} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className={`w-12 shrink-0 text-right ${h.hour === b.peakHour ? "text-accent font-bold" : "text-muted-foreground"}`}>
                    {fmtHour(h.hour)}
                  </span>
                  {/* 混雑バー (活動来場者) */}
                  <div className="flex-1 bg-muted h-4 relative">
                    <div
                      className={`h-4 ${h.hour === b.peakHour ? "bg-accent" : "bg-foreground/70"}`}
                      style={{ width: `${Math.max(2, (h.activeUsers / maxActive) * 100)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 tabular-nums text-right text-muted-foreground">
                    {h.activeUsers}人 / {h.orders}注文
                  </span>
                  {/* スタッフ稼働 (シフト設定がある場合のみ) */}
                  <span
                    className="w-16 shrink-0 tabular-nums text-right"
                    title="この時間帯にシフトに入っているスタッフ数 (シフト未設定は0)"
                  >
                    {maxStaff > 1 || h.staffOnShift > 0 ? `👷${h.staffOnShift}` : "—"}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[9px] text-muted-foreground font-sans">
              ※混雑度=その時間帯に注文/回遊/スタンプいずれかの活動をした一意来場者数。スタッフ稼働はシフト時刻(開始/終了)を設定した場合のみ表示されます。
            </p>
          </div>
        )}
      </section>

      {/* 購入ファネル + 分布 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <section className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">来場→購入ファネル (離脱)</h3>
          <div className="border-thick border-border p-3">
            <DistBars rows={b.funnel.map((f) => ({ label: f.stage, count: f.count }))} max={maxFunnel} />
            <p className="mt-2 text-[9px] text-muted-foreground font-sans">
              受付だけして回遊/購入に至らなかった層が「離脱」。段差が大きい所が改善余地です。
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">滞在時間の分布</h3>
          <div className="border-thick border-border p-3">
            <DistBars rows={b.stayBuckets} max={maxStay} />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">回遊サークル数の分布</h3>
          <div className="border-thick border-border p-3">
            <DistBars rows={b.circleCountBuckets} max={maxCircleCount} />
          </div>
        </section>
      </div>

      {/* スタッフ配置 × 負荷 */}
      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          サークル別 スタッフ配置 × 負荷 (1人あたり注文数)
        </h3>
        <div className="border-thick border-border overflow-x-auto">
          <table className="w-full text-xs text-left font-mono border-collapse min-w-[420px]">
            <thead>
              <tr className="border-b-thin border-border bg-muted/20 font-bold">
                <th className="p-2">サークル</th>
                <th className="p-2 text-right">スタッフ</th>
                <th className="p-2 text-right">注文数</th>
                <th className="p-2 text-right">1人あたり</th>
                <th className="p-2">負荷</th>
              </tr>
            </thead>
            <tbody>
              {b.staffing.byCircle.map((s) => (
                <tr key={s.circleId} className="border-b-thin border-border">
                  <td className="p-2 truncate max-w-[160px]">{s.name}</td>
                  <td className="p-2 text-right tabular-nums">
                    {s.staff === 0 ? <span className="text-destructive font-bold">未配置</span> : `${s.staff}人`}
                  </td>
                  <td className="p-2 text-right tabular-nums">{s.orders}</td>
                  <td className="p-2 text-right tabular-nums font-bold">
                    {s.ordersPerStaff != null ? s.ordersPerStaff : "—"}
                  </td>
                  <td className="p-2">
                    <div className="bg-muted h-3 relative w-full min-w-[60px]">
                      <div
                        className="h-3 bg-accent"
                        style={{ width: `${Math.max(2, ((s.ordersPerStaff ?? 0) / maxOPS) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[9px] text-muted-foreground font-sans">
          ※「1人あたり注文数」が突出して高いサークルは、混雑に対して人手が足りていない可能性があります(応援配置の判断材料)。
        </p>
      </section>

      {/* 動線 (回遊の遷移) */}
      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">動線 (よくある回遊の流れ)</h3>
        {b.topTransitions.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground border-thick border-border p-3">
            まだ回遊データが不足しています (2サークル以上を続けて訪れた来場者が必要)。
          </p>
        ) : (
          <div className="border-thick border-border p-3 space-y-1.5">
            {b.topTransitions.map((t, i) => (
              <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                <span className="flex items-center gap-1 w-52 shrink-0 min-w-0">
                  <span className="truncate">{t.from}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.to}</span>
                </span>
                <div className="flex-1 bg-muted h-4 relative">
                  <div className="h-4 bg-foreground/70" style={{ width: `${Math.max(2, (t.count / maxTrans) * 100)}%` }} />
                </div>
                <span className="w-10 shrink-0 tabular-nums text-right">{t.count}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[9px] text-muted-foreground font-sans">
          ※来場者が続けて訪れたサークルの組を集計。人が流れる導線が分かると、出店配置や誘導の設計に使えます。
        </p>
      </section>
    </div>
  );
}

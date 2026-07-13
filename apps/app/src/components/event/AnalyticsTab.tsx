import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventApi, type EventAnalytics } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarChart3, RefreshCw, Users, Coins, Receipt, Star, Radio, Download } from "lucide-react";

// イベント統計・分析タブ (2026-07-12)
// サーバ側で横断集計した来場者/売上/注文/評価/回遊の指標を表示する。
// 集計は GET /api/festivals/:id/analytics (event_manager 権限)。

function yen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

// CSV の1セルをエスケープする (カンマ/改行/ダブルクオート対応)。
function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// 統計をCSV(精算・報告書用)としてダウンロードする。Excel の文字化け対策に BOM を付ける。
function downloadCsv(eventLabel: string, a: EventAnalytics) {
  const t = a.totals;
  const lines: (string | number | null)[][] = [
    ["イベント統計サマリ"],
    ["総来場者数", "総売上", "総注文数", "総客数", "平均客単価", "サークル数", "平均評価", "完了率", "回遊のべ訪問"],
    [t.visitors, t.revenue, t.orders, t.customers, t.avgSpend, t.circles, t.avgRating ?? "", `${t.completedRate}%`, t.circleVisits],
    [],
    ["サークル別 (精算)"],
    ["サークル名", "売上", "注文数", "レビュー数", "平均評価"],
    ...a.circleRanking.map((c) => [c.name, c.revenue, c.orders, c.reviews, c.avgRating ?? ""]),
    [],
    ["人気メニュー"],
    ["メニュー", "販売個数", "売上"],
    ...a.menuRanking.map((m) => [m.menuName, m.quantity, m.revenue]),
  ];
  const csv = lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${eventLabel || "event"}_統計_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

// シンプルな横棒 (外部チャートライブラリ非依存、ブランド風の実線バー)
function Bars({
  rows,
  max,
  fmt,
}: {
  rows: { label: string; value: number }[];
  max: number;
  fmt: (v: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
          <span className="w-16 shrink-0 text-right text-muted-foreground truncate">{r.label}</span>
          <div className="flex-1 bg-muted h-4 relative">
            <div
              className="h-4 bg-accent"
              style={{ width: max > 0 ? `${Math.max(2, (r.value / max) * 100)}%` : "0%" }}
            />
          </div>
          <span className="w-20 shrink-0 tabular-nums">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsTab({ eventId, eventName }: { eventId: string; eventName?: string }) {
  // リアルタイム自動更新 (2026-07-12): ON で 15 秒ごとに再取得する。
  // 開催中の混雑状況/売上をライブで見るための機能。
  const [live, setLive] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["event-analytics", eventId],
    queryFn: () => eventApi.analytics(eventId),
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
  if (!data) return <EmptyState icon={BarChart3} message="統計データがありません" />;

  const a: EventAnalytics = data;
  const t = a.totals;
  const maxHourRevenue = Math.max(1, ...a.byHour.map((h) => h.revenue));
  const maxCircleRevenue = Math.max(1, ...a.circleRanking.map((c) => c.revenue));
  const maxAge = Math.max(1, ...a.ageBuckets.map((b) => b.count));
  // 表示は営業がある時間帯 (注文か来場がある範囲) に絞る
  const activeHours = a.byHour.filter((h) => h.orders > 0 || h.visitors > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
          <BarChart3 className="h-4 w-4" /> 統計・分析
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadCsv(eventName || "event", data)}
            className="flex items-center gap-1 font-mono text-[11px] uppercase border-thick border-border px-2 py-1 hover:bg-muted"
            title="統計・精算データをCSVで書き出す"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
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

      {/* KPI カード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="総来場者数" value={t.visitors.toLocaleString()} sub={`オンボード率 ${t.onboardedRate}%`} icon={Users} />
        <StatCard label="総売上" value={yen(t.revenue)} icon={Coins} />
        <StatCard label="総注文数" value={t.orders.toLocaleString()} sub={`完了率 ${t.completedRate}%`} icon={Receipt} />
        <StatCard label="総客数" value={t.customers.toLocaleString()} sub={`平均客単価 ${yen(t.avgSpend)}`} />
        <StatCard label="サークル数" value={t.circles.toLocaleString()} />
        <StatCard label="平均評価" value={t.avgRating != null ? `★${t.avgRating}` : "—"} sub={`${t.reviews}件`} icon={Star} />
        <StatCard label="回遊(のべ訪問)" value={t.circleVisits.toLocaleString()} sub={`${t.visitingUsers}人が訪問`} />
        <StatCard label="平均客単価" value={yen(t.avgSpend)} />
      </div>

      {/* 時間帯別売上 */}
      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">時間帯別 売上 / 注文 / 来場</h3>
        {activeHours.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">まだ売上・来場データがありません。</p>
        ) : (
          <Bars
            rows={activeHours.map((h) => ({ label: `${h.hour}時`, value: h.revenue }))}
            max={maxHourRevenue}
            fmt={yen}
          />
        )}
        {activeHours.length > 0 && (
          <p className="font-mono text-[10px] text-muted-foreground">
            棒は売上。各時間帯の注文/来場は下のサークル別と合わせて確認できます。
          </p>
        )}
      </section>

      {/* サークル別ランキング */}
      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">サークル別 売上ランキング</h3>
        {a.circleRanking.length === 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">サークルがありません。</p>
        ) : (
          <Bars
            rows={a.circleRanking.slice(0, 15).map((c) => ({ label: c.name, value: c.revenue }))}
            max={maxCircleRevenue}
            fmt={yen}
          />
        )}
      </section>

      {/* 人気メニュー + 年齢層 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">人気メニュー (販売個数 Top)</h3>
          {a.menuRanking.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">販売実績がありません。</p>
          ) : (
            <div className="space-y-1">
              {a.menuRanking.slice(0, 10).map((m, i) => (
                <div key={m.menuName} className="flex items-center justify-between font-mono text-[11px] border-b border-border py-1">
                  <span className="truncate">
                    <span className="text-muted-foreground mr-2">{i + 1}.</span>
                    {m.menuName}
                  </span>
                  <span className="tabular-nums shrink-0">{m.quantity}個 / {yen(m.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">支払い方法別 売上</h3>
          {a.paymentBreakdown.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">売上がありません。</p>
          ) : (
            <div className="space-y-1">
              {a.paymentBreakdown.map((p) => (
                <div key={p.method} className="flex items-center justify-between font-mono text-[11px] border-b border-border py-1">
                  <span>{p.method}</span>
                  <span className="tabular-nums shrink-0">{p.orders}件 / {yen(p.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">登録日付の分布 (年齢層換算)</h3>
          {a.ageBuckets.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">日付データがまだありません。</p>
          ) : (
            <Bars
              rows={a.ageBuckets.map((b) => ({ label: b.label, value: b.count }))}
              max={maxAge}
              fmt={(v) => `${v}人`}
            />
          )}
        </section>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { eventApi } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, Download } from "lucide-react";

// サークル別売上精算表 (2026-07-12)
// イベントがサークルから手数料(%)を徴収する場合の精算を計算する。
// 集計は既存の analytics(サークル別売上)を再利用する。event_manager(sales:read) 権限。
function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function SettlementTab({ eventId, eventName }: { eventId: string; eventName?: string }) {
  const [feePct, setFeePct] = useState(0);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["event-analytics", eventId],
    queryFn: () => eventApi.analytics(eventId),
    enabled: !!eventId,
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
  if (!data) return <EmptyState icon={Calculator} message="精算データがありません" />;

  const rate = Math.max(0, Math.min(100, feePct)) / 100;
  const rows = data.circleRanking.map((c) => {
    const fee = c.revenue * rate;
    return { name: c.name, revenue: c.revenue, orders: c.orders, fee, net: c.revenue - fee };
  });
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalFee = rows.reduce((s, r) => s + r.fee, 0);
  const totalNet = totalRevenue - totalFee;

  const exportCsv = () => {
    const lines: (string | number)[][] = [
      [`精算表 (手数料 ${feePct}%)`],
      ["サークル名", "売上", "注文数", `手数料(${feePct}%)`, "サークル取り分"],
      ...rows.map((r) => [r.name, r.revenue, r.orders, Math.round(r.fee), Math.round(r.net)]),
      ["合計", totalRevenue, rows.reduce((s, r) => s + r.orders, 0), Math.round(totalFee), Math.round(totalNet)],
    ];
    const csv = lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${eventName || "event"}_精算_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-thick border-border pb-3">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
            <Calculator className="h-4 w-4" /> サークル別 精算表
          </h2>
          <p className="text-[11px] text-muted-foreground font-mono mt-1">
            イベントが手数料を徴収する場合の取り分を計算します。
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="fee">手数料 (%)</Label>
            <Input
              id="fee"
              type="number"
              min={0}
              max={100}
              value={feePct}
              onChange={(e) => setFeePct(Number(e.target.value) || 0)}
              className="w-24"
            />
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1 font-mono text-[11px] uppercase border-thick border-border px-2 py-2 hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Calculator} message="サークルがありません" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[12px] border-collapse">
            <thead>
              <tr className="border-b-thick border-border text-left">
                <th className="py-2 pr-2">サークル</th>
                <th className="py-2 px-2 text-right">売上</th>
                <th className="py-2 px-2 text-right">注文</th>
                <th className="py-2 px-2 text-right">手数料</th>
                <th className="py-2 pl-2 text-right">取り分</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-border">
                  <td className="py-1.5 pr-2 truncate max-w-[40vw]">{r.name}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{yen(r.revenue)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{r.orders}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-error">-{yen(r.fee)}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums font-bold">{yen(r.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-thick border-border font-bold">
                <td className="py-2 pr-2">合計</td>
                <td className="py-2 px-2 text-right tabular-nums">{yen(totalRevenue)}</td>
                <td className="py-2 px-2"></td>
                <td className="py-2 px-2 text-right tabular-nums text-error">-{yen(totalFee)}</td>
                <td className="py-2 pl-2 text-right tabular-nums">{yen(totalNet)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

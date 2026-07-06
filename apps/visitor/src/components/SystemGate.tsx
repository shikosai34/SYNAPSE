import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { systemApi } from "@/lib/api";
import { Megaphone, Wrench } from "lucide-react";
import { PRODUCT_NAME } from "@fesflow/config";

/**
 * 来場者アプリのシステムゲート (2026-07-06)。
 * - メンテナンス中: 画面全体をメンテナンス表示に差し替える (来場者はバイパス不可)。
 * - お知らせ有効: 画面上部にバナーを表示。
 */
export default function SystemGate({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ["systemPublic"],
    queryFn: () => systemApi.public(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const { data: announcements } = useQuery({
    queryKey: ["publicAnnouncements"],
    queryFn: () => systemApi.announcements(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (data?.maintenance?.enabled) {
    return (
      <div className="min-h-svh flex items-center justify-center p-6 font-mono bg-background text-foreground">
        <div className="max-w-md w-full border-heavy border-border p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center border-thick border-border p-3">
            <Wrench className="h-8 w-8" />
          </div>
          <h1 className="font-headline text-2xl font-black uppercase tracking-tight">
            メンテナンス中
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {data.maintenance.message ||
              "ただいまシステムメンテナンスを実施しています。時間をおいて再度お試しください。"}
          </p>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground pt-2">
            {PRODUCT_NAME}
          </div>
        </div>
      </div>
    );
  }

  // 最新の公開お知らせを1件バナー表示 (来場者は通知センターを持たないため)
  const latest = announcements?.[0];
  const levelClass =
    latest?.level === "critical"
      ? "bg-destructive text-destructive-foreground"
      : latest?.level === "warning"
        ? "bg-warning text-black"
        : "bg-primary text-primary-foreground";

  return (
    <>
      {latest && (
        <div
          className={`w-full ${levelClass} border-b-thick border-border px-4 py-2 text-xs font-bold flex items-center gap-2`}
        >
          <Megaphone className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {latest.title}
            {latest.body ? ` — ${latest.body}` : ""}
          </span>
          {announcements && announcements.length > 1 && (
            <span className="ml-auto shrink-0 opacity-80">+{announcements.length - 1}</span>
          )}
        </div>
      )}
      {children}
    </>
  );
}

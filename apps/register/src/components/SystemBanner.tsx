import { useQuery } from "@tanstack/react-query";
import { systemApi } from "@/lib/api";
import { Wrench } from "lucide-react";

/**
 * メンテナンス告知バナー (2026-07-06)。
 * お知らせはヘッダーの [お知らせ・通知] ポップオーバーに集約したため、ここでは
 * メンテナンス中の告知のみ表示する。register (スタッフ/管理) はメンテ中でも操作は
 * 止めず告知のみ (解除するのも管理者自身のため)。
 */
export default function SystemBanner() {
  const { data } = useQuery({
    queryKey: ["systemPublic"],
    queryFn: () => systemApi.public(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!data?.maintenance?.enabled) return null;

  return (
    <div className="w-full bg-warning text-black border-b-thick border-border px-4 py-2 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
      <Wrench className="h-4 w-4 shrink-0" />
      <span>メンテナンス中{data.maintenance.message ? `: ${data.maintenance.message}` : ""}</span>
    </div>
  );
}

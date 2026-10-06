import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { toast } from "sonner";
import { Wrench, Save } from "lucide-react";

export function SystemSettingsTab() {
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminSettings"],
    queryFn: () => adminApi.getSettings(),
  });

  const [maintenance, setMaintenance] = useState({ enabled: false, message: "" });
  const [retentionDays, setRetentionDays] = useState("365");

  useEffect(() => {
    if (data) {
      setMaintenance(data.maintenance);
      setRetentionDays(String(data.cleanup.retentionDays));
    }
  }, [data]);

  const parsedRetentionDays = Number(retentionDays);
  const retentionValid = /^\d+$/.test(retentionDays) &&
    parsedRetentionDays >= (data?.cleanup.minDays ?? 30) &&
    parsedRetentionDays <= (data?.cleanup.maxDays ?? 3650);

  const save = useMutation({
    mutationFn: () => adminApi.updateSettings({
      maintenance,
      cleanup: { retentionDays: parsedRetentionDays },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminSettings"] });
      queryClient.invalidateQueries({ queryKey: ["systemPublic"] });
      toast.success("システム設定を保存しました");
    },
    onError: (e: any) => toast.error(e.message || "保存に失敗しました"),
  });

  if (isLoading || !data) {
    return <Skeleton className="h-40" />;
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      {/* 2026-10-04 (#83): 保持期間の操作とdry-run状態を並べ、設定変更が即削除を意味しないことを示す。 */}
      <div className="border-thick border-border p-4 space-y-4 bg-background">
        <div className="flex items-center justify-between gap-3 border-b-thick border-border pb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            メンテナンスモード
          </h3>
          <ToggleSwitch
            checked={maintenance.enabled}
            onChange={(v) => setMaintenance((p) => ({ ...p, enabled: v }))}
            label="メンテナンスモード有効化"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          有効にすると来場者・スタッフ画面がメンテナンス表示になります (システム管理者は引き続き利用可)。
        </p>
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase">メンテナンス文面</Label>
          <Input
            value={maintenance.message}
            onChange={(e) => setMaintenance((p) => ({ ...p, message: e.target.value }))}
            placeholder="例: システムメンテナンス中です。しばらくお待ちください。"
            className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
          />
        </div>
      </div>

      <div className="border-thick border-border p-4 space-y-4 bg-background">
        <div className="border-b-thick border-border pb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider">イベントデータの保持期間</h3>
          <p className="text-[11px] text-muted-foreground mt-2">
            イベント終了・アーカイブ後の保持日数です。初期値365日（1年）、変更範囲は{data.cleanup.minDays}〜{data.cleanup.maxDays.toLocaleString("ja-JP")}日です。
          </p>
        </div>
        <div className="space-y-2 max-w-sm">
          <Label htmlFor="cleanup-retention-days" className="text-xs font-bold uppercase">保持日数</Label>
          <Input
            id="cleanup-retention-days"
            type="number"
            inputMode="numeric"
            min={data.cleanup.minDays}
            max={data.cleanup.maxDays}
            step={1}
            value={retentionDays}
            onChange={(e) => setRetentionDays(e.target.value)}
            aria-invalid={!retentionValid}
            aria-describedby="cleanup-retention-help cleanup-retention-status"
            className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
          />
          <p id="cleanup-retention-help" className="text-[11px] text-muted-foreground">
            対象は現在の定期削除対象データです。添付ファイル・会計資料・監査ログの保持設定には適用されません。
          </p>
          {!retentionValid && <p className="text-[11px] text-error" role="alert">{data.cleanup.minDays}〜{data.cleanup.maxDays}日の整数を入力してください。</p>}
          <p id="cleanup-retention-status" className="text-[11px] font-bold" role="status">
            {data.cleanup.dryRun
              ? "自動削除は停止中です。保持日数を変更してもデータは削除されません。"
              : "自動削除が有効です。設定した保持日数を過ぎた対象イベントは定期処理で削除されます。"}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !retentionValid}
          className="h-11 border-thick border-primary bg-primary font-mono text-xs font-bold text-primary-foreground rounded-none hover:bg-background hover:text-foreground uppercase px-6"
        >
          <Save className="mr-1.5 h-4 w-4" />
          {save.isPending ? "保存中..." : "設定を保存"}
        </Button>
      </div>
    </div>
  );
}

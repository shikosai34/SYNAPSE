import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { toast } from "sonner";
import { Wrench, Save } from "lucide-react";

export function SystemSettingsTab() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["adminSettings"],
    queryFn: () => adminApi.getSettings(),
  });

  const [maintenance, setMaintenance] = useState({ enabled: false, message: "" });

  useEffect(() => {
    if (data) setMaintenance(data.maintenance);
  }, [data]);

  const save = useMutation({
    mutationFn: () => adminApi.updateSettings({ maintenance }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminSettings"] });
      queryClient.invalidateQueries({ queryKey: ["systemPublic"] });
      toast.success("メンテナンス設定を保存しました");
    },
    onError: (e: any) => toast.error(e.message || "保存に失敗しました"),
  });

  if (isLoading) {
    return <Skeleton className="h-40" />;
  }

  return (
    <div className="space-y-6">
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

      <div className="flex justify-end">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="h-11 border-thick border-primary bg-primary font-mono text-xs font-bold text-primary-foreground rounded-none hover:bg-background hover:text-foreground uppercase px-6"
        >
          <Save className="mr-1.5 h-4 w-4" />
          {save.isPending ? "保存中..." : "設定を保存"}
        </Button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Save, Ticket, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { circleApi, eventApi, type Circle, type Event, type StampRallySettings } from "@/lib/api";
import { toast } from "sonner";

function parseSettings(raw?: string | null): StampRallySettings {
  try {
    const parsed = JSON.parse(raw || "{}") as Partial<StampRallySettings>;
    if (parsed.enabled !== true || !Array.isArray(parsed.areas)) return { enabled: false, areas: [] };
    return {
      enabled: true,
      areas: parsed.areas.filter((area) =>
        !!area && typeof area.id === "string" && typeof area.name === "string" &&
        Array.isArray(area.circleIds) && Number.isInteger(area.requiredCount)
      ).map((area) => ({
        id: area.id,
        name: area.name,
        requiredCount: Math.max(1, area.requiredCount),
        circleIds: area.circleIds.filter((id): id is string => typeof id === "string"),
        rewardTitle: typeof area.rewardTitle === "string" ? area.rewardTitle : "景品交換",
        rewardDescription: typeof area.rewardDescription === "string" ? area.rewardDescription : "",
      })),
    };
  } catch {
    return { enabled: false, areas: [] };
  }
}

function newArea(): StampRallySettings["areas"][number] {
  return {
    id: crypto.randomUUID(),
    name: "新しいエリア",
    requiredCount: 1,
    circleIds: [],
    rewardTitle: "景品交換",
    rewardDescription: "",
  };
}

export function StampRallySettingsCard({ eventId, event }: { eventId: string; event: Event }) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<StampRallySettings>(() => parseSettings(event.stampRallySettings));
  const circlesQuery = useQuery({
    queryKey: ["stamp-rally-circles", eventId],
    queryFn: () => circleApi.list(eventId),
  });
  useEffect(() => setSettings(parseSettings(event.stampRallySettings)), [event.stampRallySettings]);

  const save = useMutation({
    mutationFn: () => eventApi.setStampRallySettings(eventId, settings),
    onSuccess: () => {
      toast.success("スタンプラリーの設定を保存しました");
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
    onError: (error: any) => toast.error(error?.message || "設定を保存できませんでした"),
  });

  const updateArea = (areaId: string, update: (area: StampRallySettings["areas"][number]) => StampRallySettings["areas"][number]) => {
    setSettings((current) => ({
      ...current,
      areas: current.areas.map((area) => area.id === areaId ? update(area) : area),
    }));
  };

  const circles = circlesQuery.data ?? [];
  const invalidArea = settings.enabled && (
    settings.areas.length === 0 || settings.areas.some((area) =>
      area.circleIds.length === 0 || area.requiredCount > area.circleIds.length
    )
  );
  const assignedByOtherArea = (circleId: string, areaId: string) =>
    settings.areas.some((area) => area.id !== areaId && area.circleIds.includes(circleId));
  const toggleCircle = (areaId: string, circleId: string, checked: boolean) => updateArea(areaId, (area) => ({
    ...area,
    circleIds: checked ? [...area.circleIds, circleId] : area.circleIds.filter((id) => id !== circleId),
  }));

  return (
    <Card className="bg-background">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b-thin border-border pb-2">
          <div className="flex items-center gap-2">
            <Ticket className="h-4 w-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider">店舗利用スタンプラリー</h3>
          </div>
          <ToggleSwitch
            checked={settings.enabled}
            onChange={(enabled) => setSettings((current) => ({ ...current, enabled }))}
            label="スタンプラリー"
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          注文を受け取り完了した店舗を、サークルカットのスタンプとして記録します。複数の実エリアをまとめる場合は同じエリアへ店舗を登録し、必要利用数を合計から設定してください。各店舗は1つのエリアにのみ登録できます。
        </p>

        {settings.areas.map((area, index) => (
          <section key={area.id} className="border-t-thin border-border pt-4 space-y-3" aria-labelledby={`stamp-area-${area.id}`}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[12rem] flex-1 space-y-1">
                <span id={`stamp-area-${area.id}`} className="text-[10px] font-bold uppercase">エリア {index + 1} の名前</span>
                <Input maxLength={60} value={area.name} onChange={(e) => updateArea(area.id, (value) => ({ ...value, name: e.target.value }))} />
              </label>
              <label className="w-28 space-y-1">
                <span className="text-[10px] font-bold uppercase">必要な店舗数</span>
                <Input type="number" min={1} max={100} value={area.requiredCount} onChange={(e) => updateArea(area.id, (value) => ({ ...value, requiredCount: Math.max(1, Number(e.target.value) || 1) }))} />
              </label>
              <Button type="button" variant="outline" aria-label={`${area.name}を削除`} onClick={() => setSettings((current) => ({ ...current, areas: current.areas.filter((value) => value.id !== area.id) }))}>
                <Trash2 className="h-4 w-4" /><span className="sr-only">エリア削除</span>
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase">交換できる景品名</span>
                <Input maxLength={100} value={area.rewardTitle} onChange={(e) => updateArea(area.id, (value) => ({ ...value, rewardTitle: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-bold uppercase">景品・交換場所の案内</span>
                <Input maxLength={500} value={area.rewardDescription} onChange={(e) => updateArea(area.id, (value) => ({ ...value, rewardDescription: e.target.value }))} />
              </label>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-[10px] font-bold uppercase">対象店舗</legend>
              {circlesQuery.isLoading ? <p className="text-xs text-muted-foreground">店舗を読み込んでいます…</p> : null}
              {circlesQuery.isError ? <p role="alert" className="text-xs text-error">店舗一覧を読み込めませんでした。</p> : null}
              {!circlesQuery.isLoading && circles.length === 0 ? <p className="text-xs text-muted-foreground">イベントに登録済みの店舗はありません。</p> : null}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {circles.map((circle) => (
                  <CircleChoice key={circle.id} circle={circle} checked={area.circleIds.includes(circle.id)} disabled={assignedByOtherArea(circle.id, area.id)} onChange={(checked) => toggleCircle(area.id, circle.id, checked)} />
                ))}
              </div>
            </fieldset>
          </section>
        ))}

        <div className="flex flex-wrap justify-between gap-3 border-t-thin border-border pt-4">
          <Button type="button" variant="outline" onClick={() => setSettings((current) => ({ ...current, areas: [...current.areas, newArea()] }))}>
            <Plus className="h-4 w-4 mr-1" />エリアを追加
          </Button>
          <Button type="button" disabled={save.isPending || invalidArea} onClick={() => save.mutate()}>
            <Save className="h-4 w-4 mr-1" />{save.isPending ? "保存中…" : "スタンプラリーを保存"}
          </Button>
        </div>
        {invalidArea && <p role="alert" className="text-xs text-error">有効化するには、エリアを追加し、各エリアへ必要数以上の店舗を登録してください。</p>}
      </CardContent>
    </Card>
  );
}

function CircleChoice({ circle, checked, disabled, onChange }: {
  circle: Circle;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-2 border-thick border-border p-2 text-xs ${disabled ? "opacity-50" : "cursor-pointer hover:bg-muted"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-primary" />
      <span className="min-w-0 flex-1 truncate">{circle.name}</span>
      {checked && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
      {disabled && <span className="text-[9px] text-muted-foreground">登録済み</span>}
    </label>
  );
}

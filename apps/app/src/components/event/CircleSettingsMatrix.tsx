import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { circleApi, parseCircleSettings, type Circle, type CircleSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { useUnsavedChanges } from "@/components/UnsavedNavigationGuard";

type StoreArea = { id: string; name: string };

function parseStoreAreas(value: unknown): StoreArea[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((area) =>
      area && typeof area.id === "string" && typeof area.name === "string"
        ? [{ id: area.id, name: area.name }]
        : [],
    );
  } catch {
    return [];
  }
}

function settingsOf(circle: Circle): CircleSettings {
  return parseCircleSettings(typeof circle.settings === "string" ? circle.settings : null);
}

function sameSettings(a: CircleSettings | undefined, b: CircleSettings | undefined) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function CircleSettingsMatrix({ eventId, event }: { eventId: string; event: any }) {
  const queryClient = useQueryClient();
  const { data: circles = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["circles", eventId],
    queryFn: () => circleApi.list(eventId),
  });
  const [drafts, setDrafts] = useState<Record<string, CircleSettings>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(circles.map((circle) => [circle.id, settingsOf(circle)])));
  }, [circles]);

  const saved = useMemo(
    () => Object.fromEntries(circles.map((circle) => [circle.id, settingsOf(circle)])),
    [circles],
  );
  const changedCircleIds = circles
    .filter((circle) => drafts[circle.id] && !sameSettings(drafts[circle.id], saved[circle.id]))
    .map((circle) => circle.id);

  const save = useMutation({
    mutationFn: ({ circleId, settings }: { circleId: string; settings: CircleSettings }) =>
      circleApi.updateSettings(circleId, settings),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["circles", eventId] });
      setDrafts((current) => ({ ...current, [variables.circleId]: variables.settings }));
      toast.success("サークル設定を保存しました");
    },
    onError: (error: any) => toast.error(error?.message || "サークル設定を保存できませんでした"),
  });

  // 2026-10-25: イベント設定から複数サークルの設定を続けて編集できるため、画面遷移で未保存値を失わないようまとめて保護する。
  useUnsavedChanges({
    isDirty: () => changedCircleIds.length > 0,
    onSave: async () => {
      for (const circleId of changedCircleIds) {
        const settings = drafts[circleId];
        if (settings) await save.mutateAsync({ circleId, settings });
      }
    },
    onDiscard: () => setDrafts(saved),
  });

  const paymentMethods = useMemo(() => {
    try {
      const parsed = typeof event?.paymentMethods === "string"
        ? JSON.parse(event.paymentMethods)
        : event?.paymentMethods;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }, [event?.paymentMethods]);
  const storeAreas = useMemo(() => parseStoreAreas(event?.storeAreas), [event?.storeAreas]);

  const update = (circleId: string, change: (settings: CircleSettings) => CircleSettings) => {
    setDrafts((current) => {
      const base = current[circleId];
      return base ? { ...current, [circleId]: change(base) } : current;
    });
  };

  const selectClass = "min-w-32 border-thick border-border bg-background px-2 py-2 text-xs font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const checkbox = (checked: boolean, label: string, onChange: (checked: boolean) => void) => (
    <label className="flex min-w-28 items-center gap-2 whitespace-nowrap text-xs">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      />
      {checked ? "有効" : "無効"}
    </label>
  );

  return (
    <section className="space-y-3 border-t-thick border-border pt-5" aria-labelledby="circle-settings-matrix-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="circle-settings-matrix-title" className="text-sm font-bold">サークル設定一覧</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            行がサークル、列が設定です。横にスクロールして確認し、各行の保存ボタンで反映します。
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          一覧を更新
        </Button>
      </div>

      {isLoading ? (
        <p role="status" className="py-6 text-center text-sm">サークル設定を読み込み中...</p>
      ) : isError ? (
        <div className="space-y-2 border-thick border-destructive p-4" role="alert">
          <p className="font-bold">サークル設定を読み込めませんでした。</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>もう一度読み込む</Button>
        </div>
      ) : circles.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">登録されているサークルはありません。</p>
      ) : (
        <>
          <div className="max-w-full overflow-x-auto border-thick border-border" tabIndex={0} aria-label="サークル設定一覧。横にスクロールできます">
            <table className="w-max min-w-full border-collapse text-left">
              <caption className="sr-only">サークルごとの運用設定</caption>
              <thead className="sticky top-0 z-20 bg-muted text-[11px] font-bold">
                <tr>
                  <th scope="col" className="sticky left-0 z-30 min-w-48 border-b-thick border-r-thick border-border bg-muted p-3">サークル</th>
                  <th scope="col" className="min-w-40 border-b-thick border-border p-3">注文後の状態</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">事前注文</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">モバイル注文</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">在庫機能</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">スタッフ機能</th>
                  <th scope="col" className="min-w-48 border-b-thick border-border p-3">支払い方法</th>
                  <th scope="col" className="min-w-40 border-b-thick border-border p-3">出店エリア</th>
                  <th scope="col" className="min-w-36 border-b-thick border-border p-3">未登録バンド警告</th>
                  <th scope="col" className="min-w-40 border-b-thick border-border p-3">未登録での注文</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">レビュー公開</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">平均評価表示</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">星表示</th>
                  <th scope="col" className="min-w-32 border-b-thick border-border p-3">コメント表示</th>
                  <th scope="col" className="min-w-36 border-b-thick border-border p-3">番号表示: 調理中</th>
                  <th scope="col" className="min-w-36 border-b-thick border-border p-3">番号表示: 受取待ち</th>
                  <th scope="col" className="min-w-36 border-b-thick border-border p-3">番号あふれ時</th>
                  <th scope="col" className="min-w-36 border-b-thick border-border p-3">番号表示の比率</th>
                  <th scope="col" className="min-w-36 border-b-thick border-border p-3">保存</th>
                </tr>
              </thead>
              <tbody>
                {circles.map((circle) => {
                  const settings = drafts[circle.id] ?? settingsOf(circle);
                  const original = saved[circle.id];
                  const dirty = !sameSettings(settings, original);
                  const change = (patch: Partial<CircleSettings>) => update(circle.id, (current) => ({ ...current, ...patch }));
                  const display = settings.orderNumberDisplay;
                  const updateReview = (patch: Partial<CircleSettings["reviewPublication"]>) =>
                    change({ reviewPublication: { ...settings.reviewPublication, ...patch } });
                  const updateDisplay = (patch: Partial<CircleSettings["orderNumberDisplay"]>) =>
                    change({ orderNumberDisplay: { ...display, ...patch } });
                  return (
                    <tr key={circle.id} className="border-b-thin border-border align-top last:border-0">
                      <th scope="row" className="sticky left-0 z-10 border-r-thick border-border bg-background p-3 text-sm font-bold">{circle.name}</th>
                      <td className="p-2">
                        <select aria-label={`${circle.name} 注文後の状態`} className={selectClass} value={settings.orderFlowMode} onChange={(e) => change({ orderFlowMode: e.target.value as CircleSettings["orderFlowMode"] })}>
                          <option value="pending">未着手</option><option value="preparing">調理中</option><option value="completed">受取待ち</option>
                        </select>
                      </td>
                      <td className="p-3">{checkbox(settings.preOrderEnabled, `${circle.name} 事前注文`, (v) => change({ preOrderEnabled: v }))}</td>
                      <td className="p-3">{checkbox(settings.mobileOrderEnabled, `${circle.name} モバイル注文`, (v) => change({ mobileOrderEnabled: v }))}</td>
                      <td className="p-3">{checkbox(settings.extensions.stock, `${circle.name} 在庫機能`, (v) => change({ extensions: { ...settings.extensions, stock: v } }))}</td>
                      <td className="p-3">{checkbox(settings.extensions.staff, `${circle.name} スタッフ機能`, (v) => change({ extensions: { ...settings.extensions, staff: v } }))}</td>
                      <td className="p-3">
                        {paymentMethods.length === 0 ? <span className="text-xs text-muted-foreground">イベント設定なし</span> : (
                          <details className="min-w-40">
                            <summary className="cursor-pointer border-thick border-border px-2 py-2 text-xs focus-visible:outline focus-visible:outline-2">{settings.acceptedPayments.length ? `${settings.acceptedPayments.length}種類を選択中` : "イベントの全種類"}</summary>
                            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto border-thick border-border bg-background p-2">
                              {paymentMethods.map((method) => (
                                <label key={method} className="flex items-center gap-2 text-xs">
                                  <input type="checkbox" checked={settings.acceptedPayments.length === 0 || settings.acceptedPayments.includes(method)} onChange={(e) => {
                                    const currentPayments = settings.acceptedPayments.length === 0 ? paymentMethods : settings.acceptedPayments;
                                    const selectedPayments = e.target.checked
                                      ? [...currentPayments, method]
                                      : currentPayments.filter((item) => item !== method);
                                    const acceptedPayments = paymentMethods.every((item) => selectedPayments.includes(item))
                                      ? []
                                      : [...new Set(selectedPayments)];
                                    change({ acceptedPayments });
                                  }} />
                                  {method}
                                </label>
                              ))}
                              <button type="button" className="text-xs font-bold underline" onClick={() => change({ acceptedPayments: [] })}>全種類に戻す</button>
                            </div>
                          </details>
                        )}
                      </td>
                      <td className="p-2">
                        <select aria-label={`${circle.name} 出店エリア`} className={selectClass} value={settings.storeAreaId ?? ""} onChange={(e) => change({ storeAreaId: e.target.value || null })}>
                          <option value="">未設定</option>{storeAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                        </select>
                      </td>
                      <td className="p-3">{checkbox(settings.warnOnUnregisteredWristband, `${circle.name} 未登録バンド警告`, (v) => change({ warnOnUnregisteredWristband: v }))}</td>
                      <td className="p-3">{checkbox(settings.allowUnregisteredWristbandOrder, `${circle.name} 未登録バンド注文許可`, (v) => change({ allowUnregisteredWristbandOrder: v }))}</td>
                      <td className="p-3">{checkbox(settings.reviewPublication.publishReviews, `${circle.name} レビュー公開`, (v) => updateReview({ publishReviews: v }))}</td>
                      <td className="p-3">{checkbox(settings.reviewPublication.showAverageRating, `${circle.name} 平均評価表示`, (v) => updateReview({ showAverageRating: v }))}</td>
                      <td className="p-3">{checkbox(settings.reviewPublication.showStars, `${circle.name} 星表示`, (v) => updateReview({ showStars: v }))}</td>
                      <td className="p-3">{checkbox(settings.reviewPublication.showComments, `${circle.name} コメント表示`, (v) => updateReview({ showComments: v }))}</td>
                      <td className="p-3">{checkbox(display.showPreparingNumbers, `${circle.name} 調理中番号表示`, (v) => updateDisplay({ showPreparingNumbers: v }))}</td>
                      <td className="p-3">{checkbox(display.showPickupNumbers, `${circle.name} 受取待ち番号表示`, (v) => updateDisplay({ showPickupNumbers: v }))}</td>
                      <td className="p-2">
                        <select aria-label={`${circle.name} 番号あふれ時の優先順`} className={selectClass} value={display.overflowPriority} onChange={(e) => updateDisplay({ overflowPriority: e.target.value as CircleSettings["orderNumberDisplay"]["overflowPriority"] })}>
                          <option value="latest">新しい注文</option><option value="oldest">古い注文</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <select aria-label={`${circle.name} 番号表示の比率`} className={selectClass} value={display.mediaPercent} onChange={(e) => updateDisplay({ mediaPercent: Number(e.target.value) })}>
                          {Array.from({ length: 13 }, (_, index) => 20 + index * 5).map((percent) => <option key={percent} value={percent}>番号 {percent}% / メディア {100 - percent}%</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <Button type="button" size="sm" onClick={() => save.mutate({ circleId: circle.id, settings })} disabled={!dirty || save.isPending}>
                          {save.isPending && save.variables?.circleId === circle.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                          保存
                        </Button>
                        {dirty && <p className="mt-1 text-[10px] font-bold text-warning">未保存</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground">支払い方法を全種類に戻すと、イベントで設定した全ての支払い方法を利用できます。画像・動画ファイルは表示端末ごとの設定のため、この一覧では編集しません。</p>
        </>
      )}
    </section>
  );
}

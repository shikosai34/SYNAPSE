import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Layers, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGuard } from "@/hooks/useCircleAuth";
import { bundleDiscountApi, menuApi } from "@/lib/api";
import { calculateBundleDiscounts, describeBundleRule, isValidBundleValue, type BundleKind } from "@fesflow/config/bundle-discount";
import { queryCachePolicy } from "@/lib/query-cache-policy";

// 2026-10-23: 「対象メニューをN個以上」を条件にした自動割引の管理。作成すると条件を満たした注文へ自動で適用される。
// セット価格は価格改定してもセット価格を保てるよう、円引き額ではなくセット価格で受ける。
type BundleForm = { title: string; kind: BundleKind; bundleSize: number; value: number; menuIds: string[] };
const initialForm: BundleForm = { title: "", kind: "set_price", bundleSize: 3, value: 0, menuIds: [] };
const KIND_OPTIONS: { kind: BundleKind; label: string; hint: string; valueLabel: string | null; defaultValue: number }[] = [
  { kind: "set_price", label: "セット価格", hint: "指定個数をセット価格にします (差額が自動で引かれます)。", valueLabel: "セット価格 (円)", defaultValue: 0 },
  { kind: "amount_off", label: "◯円引き", hint: "指定個数そろうごとに、決めた金額を引きます。", valueLabel: "1セットあたりの割引額 (円)", defaultValue: 100 },
  { kind: "free_cheapest", label: "1個分割引", hint: "指定個数そろうごとに、そのうち一番安い1個分を無料にします。", valueLabel: null, defaultValue: 0 },
  { kind: "percent_off", label: "全体◯%引き", hint: "対象メニューが指定個数以上あれば、注文全体 (トッピング込み) から割合で引きます。1注文につき1回です。", valueLabel: "割引率 (%)", defaultValue: 10 },
];

export function BundleDiscountsSection({ circleId }: { circleId: string }) {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<BundleForm>(initialForm);
  const { data: bundles, isLoading, isError, refetch } = useQuery({
    queryKey: ["bundle-discounts-admin", circleId],
    queryFn: () => bundleDiscountApi.listByCircle(circleId),
    enabled: !!circleId,
    ...queryCachePolicy.live,
  });
  const { data: menus = [] } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });
  const menuName = (id: string) => menus.find((item) => item.id === id)?.name ?? "(削除/停止中のメニュー)";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["bundle-discounts-admin", circleId] });
    queryClient.invalidateQueries({ queryKey: ["bundle-discounts", circleId] });
  };
  const createMutation = useMutation({
    mutationFn: () => bundleDiscountApi.create(circleId, form),
    onSuccess: () => {
      invalidate();
      toast.success("セット割引を作成しました。条件を満たした注文に自動で適用されます");
      setForm(initialForm);
      setIsCreateOpen(false);
    },
    onError: (error: any) => toast.error(error?.message || "セット割引を作成できませんでした"),
  });
  const disableMutation = useMutation({
    mutationFn: (id: string) => bundleDiscountApi.disable(id),
    onSuccess: () => {
      invalidate();
      toast.success("セット割引を無効化しました");
    },
    onError: (error: any) => toast.error(error?.message || "セット割引を無効化できませんでした"),
  });

  const selectedMenus = menus.filter((item) => form.menuIds.includes(item.id));
  const kindOption = KIND_OPTIONS.find((option) => option.kind === form.kind)!;
  const isValid = !!form.title.trim() && Number.isInteger(form.bundleSize) && form.bundleSize >= 2 && form.bundleSize <= 50 &&
    isValidBundleValue(form.kind, form.value) && form.menuIds.length > 0;
  // 選んだメニューで条件ちょうどの個数を買ったときの効果を、サーバーと同じ計算で見せる。
  const preview = isValid ? calculateBundleDiscounts(
    [{ menuId: selectedMenus[0]?.id ?? "", unitPrice: Math.min(...selectedMenus.map((item) => item.price)), quantity: form.bundleSize }],
    [{ id: "preview", title: form.title, kind: form.kind, bundleSize: form.bundleSize, value: form.value, menuIds: selectedMenus.map((item) => item.id) }],
  ) : null;
  const toggleMenu = (id: string) => setForm((prev) => ({
    ...prev,
    menuIds: prev.menuIds.includes(id) ? prev.menuIds.filter((item) => item !== id) : [...prev.menuIds, id],
  }));

  return (
    <section className="space-y-3" aria-labelledby="bundle-discounts-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="bundle-discounts-title" className="text-sm font-black">個数割引 (自動適用)</h2>
        <PermissionGuard permission="discount:write">
          <Button onClick={() => setIsCreateOpen(true)} className="h-8 px-3 text-[11px]">
            <Plus className="mr-1.5 h-3.5 w-3.5" />個数割引作成
          </Button>
        </PermissionGuard>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        対象メニューを合計で指定個数そろえると、セット価格・円引き・1個分無料・全体の割合引きのいずれかが自動で適用されます。レジ・モバイル注文・事前注文のすべてで有効で、手動の割引やクーポンはその後の金額に対してかかります。トッピング代はセット価格に含まれません。
      </p>
      {isLoading ? <Skeleton className="h-24" />
        : isError && bundles === undefined ? <div role="alert" className="space-y-2 text-sm"><p>セット割引を読み込めませんでした。</p><Button variant="outline" onClick={() => refetch()}>再読み込み</Button></div>
        : !bundles?.length ? <EmptyState icon={Layers} message="セット割引はまだありません" />
        : <div className="space-y-3">{bundles.map((item) => (
          <Card key={item.id} className={item.status === "disabled" ? "opacity-60" : ""}>
            <CardHeader className="border-b-thick border-border pb-2">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-sm font-bold"><Layers className="h-4 w-4" />{item.title}</CardTitle>
                <Badge variant={item.status === "active" ? "active" : "default"}>{item.status === "active" ? "有効" : "無効"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs">
              <div className="space-y-1 text-muted-foreground">
                <p>内容: <strong className="text-foreground">{describeBundleRule(item)}</strong></p>
                <p>対象: <strong className="text-foreground">{item.menuIds.map(menuName).join("、")}</strong></p>
              </div>
              {item.status === "active" && <PermissionGuard permission="discount:write"><Button type="button" variant="outline" disabled={disableMutation.isPending} onClick={() => disableMutation.mutate(item.id)} className="h-8 px-2 text-[11px] text-destructive"><Ban className="mr-1 h-3 w-3" />無効化</Button></PermissionGuard>}
            </CardContent>
          </Card>
        ))}</div>}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="[個数割引作成]" subtitle="対象メニューを合計で指定個数そろえると、自動で割引が適用されます。">
        <div className="space-y-4">
          <FormField id="bundle-title" label="名前" required placeholder="例: たこ焼き3個セット" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase">割引の種類</p>
            <div className="grid grid-cols-2 gap-2">
              {KIND_OPTIONS.map((option) => (
                <button key={option.kind} type="button" aria-pressed={form.kind === option.kind} onClick={() => setForm({ ...form, kind: option.kind, value: option.defaultValue })} className={`min-h-11 border-thick px-3 text-xs font-bold ${form.kind === option.kind ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{option.label}</button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{kindOption.hint}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="bundle-size" label={form.kind === "percent_off" ? "必要な個数 (以上)" : "個数"} required type="number" min={2} max={50} value={form.bundleSize} onChange={(event) => setForm({ ...form, bundleSize: Number.parseInt(event.target.value, 10) || 0 })} />
            {kindOption.valueLabel && <FormField id="bundle-value" label={kindOption.valueLabel} required type="number" min={form.kind === "set_price" ? 0 : 1} max={form.kind === "percent_off" ? 100 : undefined} value={form.value} onChange={(event) => setForm({ ...form, value: Number.parseInt(event.target.value, 10) || 0 })} />}
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-bold uppercase">対象メニュー *</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto border-thick border-border p-2">
              {menus.length === 0 && <p className="text-xs text-muted-foreground">メニューがありません。</p>}
              {menus.map((item) => (
                <label key={item.id} className="flex min-h-9 cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" checked={form.menuIds.includes(item.id)} onChange={() => toggleMenu(item.id)} />
                  <span className="flex-1">{item.name}</span>
                  <span className="tabular-nums text-muted-foreground">¥{item.price.toLocaleString()}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {preview && (
            <p className="text-[11px] text-muted-foreground">
              {preview.totalDiscount > 0
                ? `例: 最も安い対象メニューを${form.bundleSize}個買うと ¥${preview.totalDiscount.toLocaleString()} 引きになります。`
                : "この設定では割引になりません (セット価格が通常価格以上です)。"}
              価格が違うメニューが混ざるときは、安いものから先にセットになります。
            </p>
          )}
          <div className="flex justify-end gap-2 border-t-thin border-border pt-3">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>キャンセル</Button>
            <Button type="button" disabled={!isValid || createMutation.isPending} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "作成中…" : "個数割引を作成"}</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Plus, Tag } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { BundleDiscountsSection } from "@/components/discount/BundleDiscountsSection";
import { discountApi, type DiscountKind } from "@/lib/api";
import { useAuth, CircleAuthGuard, PermissionGuard } from "@/hooks/useCircleAuth";
import { useUnsavedChanges } from "@/components/UnsavedNavigationGuard";
import { queryCachePolicy } from "@/lib/query-cache-policy";

type DiscountForm = { title: string; kind: DiscountKind; value: number };
const initialForm: DiscountForm = { title: "", kind: "percentage", value: 10 };

function formatDiscount(kind: DiscountKind, value: number) {
  return kind === "percentage" ? `${value}%引き` : `¥${value.toLocaleString()}引き`;
}

function DiscountsContent() {
  const { circleId: authCircleId, circleName } = useAuth();
  const circleId = authCircleId ?? "";
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<DiscountForm>(initialForm);
  const { data: discounts, isLoading, isError, refetch } = useQuery({
    queryKey: ["discounts", circleId],
    queryFn: () => discountApi.listByCircle(circleId),
    enabled: !!circleId,
    ...queryCachePolicy.live,
  });

  const createMutation = useMutation({
    mutationFn: () => discountApi.create(circleId, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts", circleId] });
      queryClient.invalidateQueries({ queryKey: ["register-discounts", circleId] });
      toast.success("割引を作成しました。サークルレジで利用できます");
      setForm(initialForm);
      setIsCreateOpen(false);
    },
    onError: (error: any) => toast.error(error?.message || "割引を作成できませんでした"),
  });
  const disableMutation = useMutation({
    mutationFn: (id: string) => discountApi.disable(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts", circleId] });
      queryClient.invalidateQueries({ queryKey: ["register-discounts", circleId] });
      toast.success("割引を無効化しました");
    },
    onError: (error: any) => toast.error(error?.message || "割引を無効化できませんでした"),
  });
  const isValid = !!form.title.trim() && Number.isInteger(form.value) && form.value > 0 &&
    (form.kind !== "percentage" || form.value <= 100);

  // 2026-10-17: 割引の入力中に画面を離れる場合は、作成か破棄を共通ダイアログで選べるようにする。
  useUnsavedChanges({
    isDirty: isCreateOpen && JSON.stringify(form) !== JSON.stringify(initialForm),
    onSave: async () => {
      if (!isValid) throw new Error("割引名と割引値を確認してください。");
      await createMutation.mutateAsync();
    },
    onDiscard: () => {
      setForm(initialForm);
      setIsCreateOpen(false);
    },
  });

  return (
    <DashboardLayout
      title={circleName || "サークルダッシュボード"}
      subtitle="割引管理"
      type="circle"
      actions={(
        <PermissionGuard permission="discount:write">
          <Button onClick={() => setIsCreateOpen(true)} className="h-8 px-3 text-[11px]">
            <Plus className="mr-1.5 h-3.5 w-3.5" />割引作成
          </Button>
        </PermissionGuard>
      )}
    >
      <div className="space-y-5 font-mono">
        {isError && discounts !== undefined && <p role="status" className="border-thick border-warning bg-warning/10 p-3 text-xs">最新の割引一覧を取得できません。前回取得した内容を表示しています。</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">
          割引率または金額引きを設定できます。作成した割引はサークルのレジ会計でのみ利用できます。
        </p>
        {isLoading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
          : isError && discounts === undefined ? <div role="alert" className="space-y-2 text-sm"><p>割引を読み込めませんでした。</p><Button variant="outline" onClick={() => refetch()}>再読み込み</Button></div>
          : !discounts?.length ? <EmptyState icon={Tag} message="割引はまだありません" />
          : <div className="space-y-3">{discounts.map((item) => (
            <Card key={item.id} className={item.status === "disabled" ? "opacity-60" : ""}>
              <CardHeader className="border-b-thick border-border pb-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><Tag className="h-4 w-4" />{item.title}</CardTitle>
                  <Badge variant={item.status === "active" ? "active" : "default"}>{item.status === "active" ? "有効" : "無効"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
                  <span>内容: <strong className="text-foreground">{formatDiscount(item.kind, item.value)}</strong></span>
                  <span>利用先: <strong className="text-foreground">サークルレジのみ</strong></span>
                </div>
                {item.status === "active" && <PermissionGuard permission="discount:write"><Button type="button" variant="outline" disabled={disableMutation.isPending} onClick={() => disableMutation.mutate(item.id)} className="h-8 px-2 text-[11px] text-destructive"><Ban className="mr-1 h-3 w-3" />無効化</Button></PermissionGuard>}
              </CardContent>
            </Card>
          ))}</div>}
        <BundleDiscountsSection circleId={circleId} />
      </div>
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="[割引作成]" subtitle="作成した割引はサークルのレジでのみ選択できます。">
        <div className="space-y-4">
          <FormField id="discount-title" label="割引名" required placeholder="例: 閉店前値引き" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase">割引方法</p>
            <div className="grid grid-cols-2 gap-2">
              {([["percentage", "割合引き"], ["amount", "金額引き"]] as const).map(([kind, label]) => (
                <button key={kind} type="button" aria-pressed={form.kind === kind} onClick={() => setForm({ ...form, kind, value: kind === "percentage" ? 10 : 100 })} className={`min-h-11 border-thick px-3 text-xs font-bold ${form.kind === kind ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{label}</button>
              ))}
            </div>
          </div>
          <FormField id="discount-value" label={form.kind === "percentage" ? "割引率 (%)" : "割引額 (円)"} required type="number" min={1} max={form.kind === "percentage" ? 100 : undefined} value={form.value} onChange={(event) => setForm({ ...form, value: Number.parseInt(event.target.value, 10) || 0 })} />
          <p className="text-[11px] text-muted-foreground">{form.kind === "percentage" ? "商品小計に対する割引率です。割引額は1円未満を切り捨てます。" : "商品小計を超える金額は割り引かず、合計は0円までです。"}</p>
          <div className="flex justify-end gap-2 border-t-thin border-border pt-3">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>キャンセル</Button>
            <Button type="button" disabled={!isValid || createMutation.isPending} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "作成中…" : "割引を作成"}</Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}

export default function DiscountsPage() {
  return (
    <CircleAuthGuard>
      <PermissionGuard permission="discount:read" showDenied>
        <DiscountsContent />
      </PermissionGuard>
    </CircleAuthGuard>
  );
}

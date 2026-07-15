import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminEvent, type BillingStatus } from "@/lib/api";
import { ensureSudo } from "@/lib/sudo";
import { getAuthInfo, saveAuthInfo } from "@/hooks/useCircleAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/Modal";
import { FormField, FormSelect, FormSubmitButton } from "@/components/ui/FormField";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { Calendar, Trash2, Settings2, Save, Eye, Search, Coins, Plus } from "lucide-react";

// SaaS 運営: イベント/契約管理 (2026-07-12 Phase C / 2026-07-15 契約金額・入金履歴で拡充)。
// 全テナント(イベント)の契約状態・サークル上限・契約金額・入金履歴を手動で管理する
// (Stripe 導入までの銀行振込ベース運用の正本)。テナントの「内容」には触れない。
const STATUS_LABELS: Record<BillingStatus, string> = {
  active: "有効",
  trial: "試用",
  suspended: "停止",
  unpaid: "未払い",
};
const STATUS_FILTERS: ("all" | BillingStatus)[] = ["all", "active", "trial", "unpaid", "suspended"];

const yen = (n: number) => `¥${(n ?? 0).toLocaleString()}`;
const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export function SaasEventsTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<AdminEvent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminEvent | null>(null);
  const [form, setForm] = useState({
    plan: "free",
    maxCircles: 1,
    billingStatus: "active" as BillingStatus,
    billingAmount: 0,
    nextBillingDate: "",
    contractNotes: "",
  });
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | BillingStatus>("all");

  // 入金の追加フォーム (編集中テナント向け)
  const [pay, setPay] = useState({ amount: 0, method: "銀行振込", date: "", note: "" });

  // 「このイベントとして表示」= 昇格(sudo)を確保してから event_manager になりすまし、
  // イベント管理画面へ遷移する。これが super_admin がテナント内容を見る唯一の経路 (Phase E)。
  const startImpersonation = async (e: AdminEvent) => {
    setImpersonatingId(e.id);
    try {
      await ensureSudo();
      await adminApi.impersonate({ role: "event_manager", eventId: e.id, label: e.eventName });
      const info = getAuthInfo();
      saveAuthInfo({
        circleId: null,
        eventId: e.id,
        userEmail: info?.userEmail ?? null,
        userName: info?.userName ?? null,
        role: info?.role ?? "super_admin",
        membershipId: info?.membershipId ?? null,
        circleName: null,
        isEventAdmin: true,
      });
      queryClient.invalidateQueries({ queryKey: ["impersonation-status"] });
      toast.success(`${e.eventName} として表示します`);
      navigate("/event/dashboard");
    } catch (err: any) {
      toast.error(err?.message || "なりすましの開始に失敗しました");
    } finally {
      setImpersonatingId(null);
    }
  };

  const { data: events, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["adminEvents"],
    queryFn: () => adminApi.listEvents(),
  });

  // 編集中テナントの入金履歴
  const { data: payments } = useQuery({
    queryKey: ["contractPayments", editing?.id],
    queryFn: () => adminApi.listPayments(editing!.id),
    enabled: !!editing,
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof adminApi.updateEvent>[1] }) =>
      adminApi.updateEvent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminEvents"] });
      queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      toast.success("契約を更新しました");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || "更新に失敗しました"),
  });

  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminEvents"] });
      queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      toast.success("イベントを削除しました");
      setPendingDelete(null);
    },
    onError: (e: any) => {
      toast.error(e.message || "削除に失敗しました");
      setPendingDelete(null);
    },
  });

  const addPayment = useMutation({
    mutationFn: () =>
      adminApi.addPayment(editing!.id, {
        amount: pay.amount,
        method: pay.method,
        paidAt: new Date(pay.date).toISOString(),
        note: pay.note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contractPayments", editing?.id] });
      queryClient.invalidateQueries({ queryKey: ["adminEvents"] });
      toast.success("入金を記録しました");
      setPay({ amount: 0, method: "銀行振込", date: "", note: "" });
    },
    onError: (e: any) => toast.error(e.message || "記録に失敗しました"),
  });

  const removePayment = useMutation({
    mutationFn: (paymentId: string) => adminApi.deletePayment(paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contractPayments", editing?.id] });
      queryClient.invalidateQueries({ queryKey: ["adminEvents"] });
      toast.success("入金記録を削除しました");
    },
    onError: (e: any) => toast.error(e.message || "削除に失敗しました"),
  });

  const openEdit = (e: AdminEvent) => {
    setForm({
      plan: e.plan,
      maxCircles: e.maxCircles,
      billingStatus: e.billingStatus,
      billingAmount: e.billingAmount ?? 0,
      nextBillingDate: toDateInput(e.nextBillingAt),
      contractNotes: e.contractNotes ?? "",
    });
    setPay({ amount: 0, method: "銀行振込", date: "", note: "" });
    setEditing(e);
  };

  const saveContract = () => {
    if (!editing) return;
    update.mutate({
      id: editing.id,
      data: {
        plan: form.plan,
        maxCircles: form.maxCircles,
        billingStatus: form.billingStatus,
        billingAmount: form.billingAmount,
        nextBillingAt: form.nextBillingDate ? new Date(form.nextBillingDate).toISOString() : null,
        contractNotes: form.contractNotes || null,
      },
    });
  };

  // 検索/状態フィルタ
  const shown = (events ?? []).filter((e) => {
    if (statusFilter !== "all" && e.billingStatus !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return e.eventName.toLowerCase().includes(q) || (e.ownerEmail ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  // サマリ (表示中のテナント基準)
  const summary = shown.reduce(
    (acc, e) => {
      acc.contracted += e.billingAmount ?? 0;
      acc.received += e.paidTotal ?? 0;
      if (e.billingStatus === "unpaid" || e.billingStatus === "suspended") acc.attention += 1;
      return acc;
    },
    { contracted: 0, received: 0, attention: 0 },
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
          <Calendar className="h-4 w-4" />
          契約管理 ({events?.length || 0})
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mt-1">
          テナント横断の契約管理。プラン・上限・状態・契約金額・入金履歴を手動で管理します(内容は開けません)。
        </p>
      </div>

      {/* サマリ */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "契約金額 (表示中)", value: yen(summary.contracted), cls: "" },
          { label: "入金合計 (表示中)", value: yen(summary.received), cls: "" },
          { label: "要対応 (未払い/停止)", value: `${summary.attention}`, cls: summary.attention > 0 ? "text-error" : "" },
        ].map((s) => (
          <div key={s.label} className="border-thick border-border bg-background p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</div>
            <div className={`font-headline text-[20px] leading-none tabular-nums mt-1 ${s.cls}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 検索 + 状態フィルタ */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="イベント名・オーナーで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`text-[10px] font-bold uppercase border-thick px-2 h-9 ${
                statusFilter === s ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted"
              }`}
            >
              {s === "all" ? "すべて" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Calendar} message="該当するテナントがありません" />
      ) : (
        <div className="space-y-2">
          {shown.map((e) => (
            <div
              key={e.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border-thick border-border bg-background text-[12px] font-mono"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="font-bold text-foreground truncate">{e.eventName}</p>
                <p className="text-[10px] text-muted-foreground truncate">owner: {e.ownerEmail || "—"}</p>
                <div className="flex flex-wrap gap-2 text-[10px] mt-1">
                  <span className="border-thin border-border px-1.5 py-0.5 uppercase">{e.plan}</span>
                  <span
                    className={`border-thin px-1.5 py-0.5 uppercase ${
                      e.billingStatus === "suspended" || e.billingStatus === "unpaid"
                        ? "border-error text-error"
                        : "border-border"
                    }`}
                  >
                    {STATUS_LABELS[e.billingStatus]}
                  </span>
                  <span className="border-thin border-border px-1.5 py-0.5">
                    {e.circleCount}/{e.maxCircles} サークル
                  </span>
                  {e.billingAmount > 0 && (
                    <span className="border-thin border-border px-1.5 py-0.5" title="契約金額 / 入金合計">
                      {yen(e.paidTotal)} / {yen(e.billingAmount)}
                    </span>
                  )}
                  {e.nextBillingAt && (
                    <span className="border-thin border-border px-1.5 py-0.5" title="次回請求日">
                      次回 {toDateInput(e.nextBillingAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[10px]"
                  disabled={impersonatingId === e.id}
                  onClick={() => startImpersonation(e)}
                  title="このイベントとして表示 (なりすまし)"
                >
                  <Eye className="h-3.5 w-3.5 mr-1" /> {impersonatingId === e.id ? "..." : "表示"}
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-[10px]" onClick={() => openEdit(e)}>
                  <Settings2 className="h-3.5 w-3.5 mr-1" /> 契約
                </Button>
                <button
                  className="p-1.5 text-destructive hover:bg-muted border-thick border-transparent hover:border-border"
                  title="削除"
                  onClick={() => setPendingDelete(e)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 契約編集モーダル */}
      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `[契約管理: ${editing.eventName}]` : ""}
        subtitle="プラン・上限・状態・契約金額・入金履歴を手動で管理します。"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="plan"
            label="プラン"
            value={form.plan}
            onChange={(e) => setForm({ ...form, plan: e.target.value })}
            placeholder="free / standard / pro"
          />
          <FormField
            id="maxCircles"
            label="サークル上限"
            type="number"
            value={String(form.maxCircles)}
            onChange={(e) => setForm({ ...form, maxCircles: Math.max(1, Number(e.target.value) || 1) })}
          />
          <FormSelect
            id="billingStatus"
            label="契約状態"
            value={form.billingStatus}
            onChange={(e) => setForm({ ...form, billingStatus: e.target.value as BillingStatus })}
          >
            <option value="active">有効</option>
            <option value="trial">試用</option>
            <option value="suspended">停止</option>
            <option value="unpaid">未払い</option>
          </FormSelect>
          <FormField
            id="billingAmount"
            label="契約金額 (円)"
            type="number"
            value={String(form.billingAmount)}
            onChange={(e) => setForm({ ...form, billingAmount: Math.max(0, Number(e.target.value) || 0) })}
          />
          <FormField
            id="nextBillingDate"
            label="次回請求日"
            type="date"
            value={form.nextBillingDate}
            onChange={(e) => setForm({ ...form, nextBillingDate: e.target.value })}
          />
        </div>

        <div className="space-y-1 mt-3">
          <Label htmlFor="contractNotes" className="text-xs font-bold uppercase">運営メモ (非公開)</Label>
          <textarea
            id="contractNotes"
            value={form.contractNotes}
            onChange={(e) => setForm({ ...form, contractNotes: e.target.value })}
            rows={2}
            maxLength={2000}
            placeholder="振込確認・連絡事項など"
            className="w-full border-thick border-border rounded-none bg-background px-2 py-1.5 text-xs font-mono focus-visible:outline-none"
          />
        </div>

        <FormSubmitButton onClick={saveContract} isPending={update.isPending} icon={Save}>
          契約を更新
        </FormSubmitButton>

        {/* 入金履歴 */}
        <div className="mt-4 border-t-thick border-border pt-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" /> 入金履歴
            </h3>
            <span className="text-[11px] font-mono text-muted-foreground">
              合計 {yen((payments ?? []).reduce((s, p) => s + p.amount, 0))}
            </span>
          </div>

          {/* 入金追加フォーム */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">金額</Label>
              <Input
                type="number"
                value={pay.amount === 0 ? "" : String(pay.amount)}
                placeholder="0"
                onChange={(e) => setPay({ ...pay, amount: Math.max(0, Number(e.target.value) || 0) })}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">方法</Label>
              <select
                value={pay.method}
                onChange={(e) => setPay({ ...pay, method: e.target.value })}
                className="w-full h-9 border-thick border-border rounded-none bg-background px-1.5 text-xs font-mono"
              >
                <option value="銀行振込">銀行振込</option>
                <option value="現金">現金</option>
                <option value="その他">その他</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">入金日</Label>
              <Input
                type="date"
                value={pay.date}
                onChange={(e) => setPay({ ...pay, date: e.target.value })}
                className="h-9 text-xs"
              />
            </div>
            <Button
              onClick={() => addPayment.mutate()}
              disabled={addPayment.isPending || pay.amount < 1 || !pay.date}
              className="h-9 text-[11px] border-thick"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> 記録
            </Button>
          </div>
          <Input
            value={pay.note}
            onChange={(e) => setPay({ ...pay, note: e.target.value })}
            placeholder="備考 (振込人名義など・任意)"
            maxLength={500}
            className="h-9 text-xs"
          />

          {/* 履歴一覧 */}
          {payments && payments.length > 0 ? (
            <div className="divide-y divide-border border-thick border-border">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-[11px] font-mono">
                  <div className="min-w-0">
                    <span className="font-bold tabular-nums">{yen(p.amount)}</span>
                    <span className="text-muted-foreground"> · {p.method} · {toDateInput(p.paidAt)}</span>
                    {p.note && <span className="text-muted-foreground truncate"> · {p.note}</span>}
                  </div>
                  <button
                    className="p-1 text-destructive hover:bg-muted shrink-0"
                    title="この入金記録を削除"
                    onClick={() => removePayment.mutate(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground font-mono">入金記録はまだありません。</p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="イベントを削除しますか?"
        description={`「${pendingDelete?.eventName}」を論理削除します。この操作は元に戻せません。`}
        confirmLabel="削除する"
        onConfirm={() => pendingDelete && del.mutate(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

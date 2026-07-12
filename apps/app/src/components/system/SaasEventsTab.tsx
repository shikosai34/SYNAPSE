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
import { Modal } from "@/components/ui/Modal";
import { FormField, FormSelect, FormSubmitButton } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { Calendar, Trash2, Settings2, Save, Eye } from "lucide-react";

// SaaS 運営: イベント/課金管理 (2026-07-12 Phase C)。
// 全テナント(イベント)の契約状態・サークル上限を手動で管理する(銀行振込対応の裏口)。
// テナントの「内容」には触れない = 運営情報のみ。
const STATUS_LABELS: Record<BillingStatus, string> = {
  active: "有効",
  trial: "試用",
  suspended: "停止",
  unpaid: "未払い",
};

export function SaasEventsTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<AdminEvent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminEvent | null>(null);
  const [form, setForm] = useState({ plan: "free", maxCircles: 1, billingStatus: "active" as BillingStatus });
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  // 「このイベントとして表示」= 昇格(sudo)を確保してから event_manager になりすまし、
  // イベント管理画面へ遷移する。これが super_admin がテナント内容を見る唯一の経路 (Phase E)。
  const startImpersonation = async (e: AdminEvent) => {
    setImpersonatingId(e.id);
    try {
      await ensureSudo(); // 未昇格ならパスキー再認証で昇格
      await adminApi.impersonate({ role: "event_manager", eventId: e.id, label: e.eventName });
      // クライアントのアクティブスペースを対象イベントに向ける (ガード/画面の eventId 解決用)。
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

  const openEdit = (e: AdminEvent) => {
    setForm({ plan: e.plan, maxCircles: e.maxCircles, billingStatus: e.billingStatus });
    setEditing(e);
  };

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
          全イベント ({events?.length || 0})
        </h2>
        <p className="text-[11px] text-muted-foreground font-mono mt-1">
          テナント横断の契約管理。プラン・サークル上限・状態を手動で変更できます(内容は開けません)。
        </p>
      </div>

      {!events || events.length === 0 ? (
        <EmptyState icon={Calendar} message="イベントがありません" />
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <div
              key={e.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border-thick border-border bg-background text-[12px] font-mono"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="font-bold text-foreground truncate">{e.eventName}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  owner: {e.ownerEmail || "—"}
                </p>
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
        subtitle="プラン・サークル上限・契約状態を手動で更新します。"
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
        </div>
        <FormSubmitButton
          onClick={() => editing && update.mutate({ id: editing.id, data: form })}
          isPending={update.isPending}
          icon={Save}
        >
          契約を更新
        </FormSubmitButton>
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

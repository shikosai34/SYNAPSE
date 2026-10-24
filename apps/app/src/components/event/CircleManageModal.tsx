import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  circleApi,
  membershipApi,
  parseCircleSettings,
  parseEventPaymentMethods,
  parseStoreAreas,
  type CircleSettings,
  type Event,
  type MembershipWithUser,
} from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, UserCheck } from "lucide-react";
import { useUnsavedChanges } from "@/components/UnsavedNavigationGuard";

// イベント運営者が作成後も運用設定を調整できるよう、CircleCreateWizard と同じ設定をここで編集する。
// メンバー権限は設定保存と別の mutation のままにし、誤操作や保存競合を避ける。

type CircleRole = "circle_manager" | "circle_admin" | "circle_staff";

const EXTENSIONS: { key: "stock" | "staff"; label: string; desc: string; icon: any }[] = [
  { key: "stock", label: "在庫管理", desc: "メニューの在庫数・売り切れ管理", icon: Package },
  { key: "staff", label: "スタッフ管理", desc: "シフト/スタッフ名簿", icon: UserCheck },
];

export function CircleManageModal({
  circle,
  event,
  isOpen,
  onClose,
}: {
  circle: any | null;
  event?: Event;
  isOpen: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const circleId: string | undefined = circle?.id;

  const settings = useMemo(() => parseCircleSettings(circle?.settings), [circle?.settings]);
  const [draft, setDraft] = useState<CircleSettings>(settings);
  const [savedDraft, setSavedDraft] = useState<CircleSettings>(settings);

  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setSavedDraft(settings);
    }
  }, [isOpen, circle?.id, settings]);

  // 2026-10-16: 作成ウィザードで選べる運用条件は運営側でもまとめて保存し、複数の即時更新が競合するのを防ぐ。
  const saveSettings = useMutation({
    mutationFn: (nextDraft: CircleSettings) => circleApi.updateSettings(circleId!, {
      ...nextDraft,
      // イベント側で支払方法を削除済みなら、保存時に旧値を残さない。
      acceptedPayments: nextDraft.acceptedPayments.filter((method) =>
        parseEventPaymentMethods(event?.paymentMethods).includes(method)
      ),
    }),
    onSuccess: (_result, nextDraft) => {
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      toast.success("サークルの運用設定を保存しました");
      queryClient.invalidateQueries({ queryKey: ["circles", circle?.eventId] });
      queryClient.invalidateQueries({ queryKey: ["circle", circleId] });
    },
    onError: (e: any) => toast.error(e?.message || "運用設定の保存に失敗しました"),
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["circle-members", circleId],
    queryFn: () => membershipApi.listByCircle(circleId!),
    enabled: isOpen && !!circleId,
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: CircleRole }) =>
      membershipApi.updateRole(id, role),
    onSuccess: () => {
      toast.success("ロールを更新しました");
      queryClient.invalidateQueries({ queryKey: ["circle-members", circleId] });
    },
    onError: (e: any) => toast.error(e?.message || "ロールの更新に失敗しました"),
  });

  // 2026-10-16: イベント運営者が編集するサークル運用設定も画面遷移ガードに登録する。
  useUnsavedChanges({
    isDirty: isOpen && !!circle && JSON.stringify(draft) !== JSON.stringify(savedDraft),
    onSave: async () => {
      if (!circleId || !event) throw new Error("サークル情報を読み込んでから保存してください。");
      await saveSettings.mutateAsync(draft);
    },
    onDiscard: () => {
      setDraft(savedDraft);
      onClose();
    },
  });

  if (!circle) return null;

  const paymentMethods = event ? parseEventPaymentMethods(event.paymentMethods) : [];
  const storeAreas = event ? parseStoreAreas(event.storeAreas) : [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`「${circle.name}」の運営管理`} maxWidth="xl">
      <div className="space-y-5 font-mono">
        {/* 拡張機能 */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">拡張機能</h3>
          {EXTENSIONS.map((x) => {
            const Icon = x.icon;
            return (
              <div key={x.key} className="flex items-center justify-between gap-3 border-thin border-border p-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-[12px] font-bold">{x.label}</div>
                    <div className="text-[10px] text-muted-foreground">{x.desc}</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={draft.extensions[x.key]}
                  onChange={(value) => setDraft((current) => ({
                    ...current,
                    extensions: { ...current.extensions, [x.key]: value },
                  }))}
                  disabled={saveSettings.isPending}
                  label={x.label}
                />
              </div>
            );
          })}
        </section>

        <section className="space-y-3 border-t-thin border-border pt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">注文・出店設定</h3>
          <label className="block space-y-1 text-[11px] font-bold" htmlFor="circleOrderFlowMode">
            <span>新規注文の初期状態</span>
            <select
              id="circleOrderFlowMode"
              value={draft.orderFlowMode}
              onChange={(e) => setDraft((current) => ({ ...current, orderFlowMode: e.target.value as CircleSettings["orderFlowMode"] }))}
              disabled={saveSettings.isPending}
              className="w-full border-thick border-border bg-input p-3 font-mono text-sm"
            >
              <option value="pending">未着手で受付</option>
              <option value="preparing">調理中から開始</option>
              <option value="completed">即完成</option>
            </select>
          </label>

          <fieldset className="space-y-2" disabled={saveSettings.isPending}>
            <legend className="text-[11px] font-bold">対応する支払い方法</legend>
            <p className="text-[10px] text-muted-foreground">未選択の場合はイベントで設定された全ての方法に対応します。</p>
            {paymentMethods.length > 0 ? paymentMethods.map((method) => (
              <label key={method} className="flex min-h-10 cursor-pointer items-center gap-3 border-thin border-border p-2 text-xs">
                <input
                  type="checkbox"
                  checked={draft.acceptedPayments.includes(method)}
                  onChange={(e) => setDraft((current) => ({
                    ...current,
                    acceptedPayments: e.target.checked
                      ? [...current.acceptedPayments, method]
                      : current.acceptedPayments.filter((item) => item !== method),
                  }))}
                  className="h-4 w-4 accent-primary"
                />
                {method}
              </label>
            )) : <p className="text-[11px] text-muted-foreground">イベント側に支払い方法が登録されていません。</p>}
          </fieldset>

          <label className="block space-y-1 text-[11px] font-bold" htmlFor="circleStoreArea">
            <span>出店エリア</span>
            <select
              id="circleStoreArea"
              value={draft.storeAreaId ?? ""}
              onChange={(e) => setDraft((current) => ({ ...current, storeAreaId: e.target.value || null }))}
              disabled={saveSettings.isPending}
              className="w-full border-thick border-border bg-input p-3 font-mono text-sm"
            >
              <option value="">未設定</option>
              {storeAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>

          {/* 2026-10-25: イベント運営者からも、サークルごとの未登録バンド受付ルールを変更できるようにする。 */}
          <div className="space-y-2 border-t-thin border-border pt-3">
            <h4 className="text-[11px] font-bold">入場登録前のリストバンド</h4>
            <label className="flex items-center justify-between gap-3 text-[11px]">
              <span>未登録バンドの警告を表示する</span>
              <ToggleSwitch
                checked={draft.warnOnUnregisteredWristband}
                onChange={(value) => setDraft((current) => ({ ...current, warnOnUnregisteredWristband: value }))}
                disabled={saveSettings.isPending}
                label="未登録バンドの警告を表示する"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-[11px]">
              <span>警告画面から注文を受け付ける</span>
              <ToggleSwitch
                checked={draft.allowUnregisteredWristbandOrder}
                onChange={(value) => setDraft((current) => ({ ...current, allowUnregisteredWristbandOrder: value }))}
                disabled={saveSettings.isPending}
                label="警告画面から注文を受け付ける"
              />
            </label>
            <p className="text-[10px] text-muted-foreground">警告を有効にすると、アレルギー情報と注文番号を確認できないことをレジに表示します。</p>
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={saveSettings.isPending || !event}
            onClick={() => saveSettings.mutate(draft)}
          >
            {saveSettings.isPending ? "保存中…" : "運用設定を保存"}
          </Button>
        </section>

        {/* メンバーのロール調整 */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">メンバーのロール</h3>
          {membersLoading ? (
            <div className="space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : members && members.length > 0 ? (
            <div className="space-y-1">
              {members.map((m: MembershipWithUser) => (
                <div key={m.id} className="flex items-center justify-between gap-2 border-thin border-border p-2 text-[12px]">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{m.userName}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{m.userEmail}</div>
                  </div>
                  <select
                    value={m.role === "circle_manager" || m.role === "circle_admin" ? m.role : "circle_staff"}
                    onChange={(e) =>
                      updateRole.mutate({ id: m.id, role: e.target.value as CircleRole })
                    }
                    disabled={updateRole.isPending}
                    className="border-thick border-border bg-background px-2 py-1 text-[11px] font-mono focus:outline-none focus:border-accent"
                  >
                    <option value="circle_manager">オーナー</option>
                    <option value="circle_admin">管理者</option>
                    <option value="circle_staff">スタッフ</option>
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">メンバーがいません。</p>
          )}
          <p className="text-[10px] text-muted-foreground">
            主催者としてサークルの拡張機能とメンバーのロールを調整できます。
          </p>
        </section>
      </div>
    </Modal>
  );
}

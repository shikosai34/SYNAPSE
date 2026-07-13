import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  circleApi,
  membershipApi,
  parseCircleSettings,
  type MembershipWithUser,
} from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, UserCheck } from "lucide-react";

// 主催者(event_manager)によるサークル運営管理モーダル (2026-07-12 C-2)
// - 各サークルの拡張機能(在庫/スタッフ/抽選)の ON/OFF を主催者側からも制御。
// - サークルメンバーのロール調整(circle_manager / circle_staff)。
// circle.settings は全体置換で保存されるため、既存値をパースして必要キーだけ差し替える。

const EXTENSIONS: { key: "stock" | "staff"; label: string; desc: string; icon: any }[] = [
  { key: "stock", label: "在庫管理", desc: "メニューの在庫数・売り切れ管理", icon: Package },
  { key: "staff", label: "スタッフ管理", desc: "シフト/スタッフ名簿", icon: UserCheck },
];

export function CircleManageModal({
  circle,
  isOpen,
  onClose,
}: {
  circle: any | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const circleId: string | undefined = circle?.id;

  const settings = useMemo(() => parseCircleSettings(circle?.settings), [circle?.settings]);
  // 楽観的にトグル状態を保持 (保存はトグルごとに即時実行)
  const [ext, setExt] = useState<Record<string, boolean>>({
    stock: settings.extensions.stock,
    staff: settings.extensions.staff,
  });

  const saveExt = useMutation({
    mutationFn: (next: Record<string, boolean>) =>
      circleApi.updateSettings(circleId!, {
        ...settings,
        extensions: { ...settings.extensions, ...next },
      }),
    onError: (e: any) => toast.error(e?.message || "拡張設定の保存に失敗しました"),
  });

  const toggleExt = (key: string, value: boolean) => {
    const next = { ...ext, [key]: value };
    setExt(next);
    saveExt.mutate(next, { onSuccess: () => toast.success("拡張設定を更新しました") });
  };

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["circle-members", circleId],
    queryFn: () => membershipApi.listByCircle(circleId!),
    enabled: isOpen && !!circleId,
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "circle_manager" | "circle_staff" }) =>
      membershipApi.updateRole(id, role),
    onSuccess: () => {
      toast.success("ロールを更新しました");
      queryClient.invalidateQueries({ queryKey: ["circle-members", circleId] });
    },
    onError: (e: any) => toast.error(e?.message || "ロールの更新に失敗しました"),
  });

  if (!circle) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`[サークル運営: ${circle.name}]`}>
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
                  checked={!!ext[x.key]}
                  onChange={(v) => toggleExt(x.key, v)}
                  disabled={saveExt.isPending}
                  label={x.label}
                />
              </div>
            );
          })}
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
                    value={m.role === "circle_manager" ? "circle_manager" : "circle_staff"}
                    onChange={(e) =>
                      updateRole.mutate({ id: m.id, role: e.target.value as "circle_manager" | "circle_staff" })
                    }
                    disabled={updateRole.isPending}
                    className="border-thick border-border bg-background px-2 py-1 text-[11px] font-mono focus:outline-none focus:border-accent"
                  >
                    <option value="circle_manager">管理者</option>
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

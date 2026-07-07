import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi, type AdminUserAccount } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Users, Shield, Lock, Unlock, UserX, UserCheck } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "システム管理者",
  event_manager: "イベント管理者",
  circle_manager: "サークル管理者",
  staff: "スタッフ",
  viewer: "閲覧",
};

const SCOPE_LABELS: Record<string, string> = {
  system: "システム",
  event: "イベント",
  circle: "サークル",
};

export function AccountsTab() {
  const queryClient = useQueryClient();

  const {
    data: users,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => adminApi.listUsers(),
  });

  const { data: lockouts } = useQuery({
    queryKey: ["adminLockouts"],
    queryFn: () => adminApi.listLockouts(),
  });

  const updateMembership = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: string; isActive?: boolean } }) =>
      adminApi.updateMembership(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
      toast.success("メンバーシップを更新しました");
    },
    onError: (e: any) => toast.error(e.message || "更新に失敗しました"),
  });

  const clearLockout = useMutation({
    mutationFn: (id: string) => adminApi.clearLockout(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminLockouts"] });
      toast.success("ロックを解除しました");
    },
    onError: (e: any) => toast.error(e.message || "解除に失敗しました"),
  });

  return (
    <div className="space-y-6">
      {/* ロックアウト中のアカウント */}
      {lockouts && lockouts.length > 0 && (
        <div className="border-thick border-destructive bg-destructive/5 p-4 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2 text-destructive">
            <Lock className="h-4 w-4" />
            ロック中 ({lockouts.length})
          </h3>
          <div className="space-y-2">
            {lockouts.map((lk) => (
              <div
                key={lk.id}
                className="flex items-center justify-between gap-2 border-thick border-border bg-background p-2.5"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{lk.key}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {lk.scope} / 失敗 {lk.failedCount} 回
                    {lk.lockedUntil &&
                      ` / 解除予定 ${new Date(lk.lockedUntil).toLocaleTimeString("ja-JP")}`}
                  </div>
                </div>
                <Button
                  onClick={() => clearLockout.mutate(lk.id)}
                  disabled={clearLockout.isPending}
                  className="rounded-none border-thick border-border h-8 text-[10px] uppercase font-bold shrink-0 px-3 bg-background text-foreground hover:bg-primary hover:text-primary-foreground"
                >
                  <Unlock className="mr-1 h-3.5 w-3.5" />
                  解除
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* アカウント一覧 */}
      <div className="flex items-center gap-2 border-b-thick border-border pb-3">
        <Users className="h-4 w-4" />
        <h2 className="text-sm font-bold uppercase tracking-wider">
          アカウント一覧 {users ? `(${users.length})` : ""}
        </h2>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : users && users.length > 0 ? (
        <div className="space-y-3">
          {users.map((user) => (
            <AccountRow
              key={user.email}
              user={user}
              onRoleChange={(id, role) => updateMembership.mutate({ id, data: { role } })}
              onToggleActive={(id, isActive) =>
                updateMembership.mutate({ id, data: { isActive } })
              }
              isPending={updateMembership.isPending}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={Users} message="アカウントがありません" />
      )}
    </div>
  );
}

function AccountRow({
  user,
  onRoleChange,
  onToggleActive,
  isPending,
}: {
  user: AdminUserAccount;
  onRoleChange: (membershipId: string, role: string) => void;
  onToggleActive: (membershipId: string, isActive: boolean) => void;
  isPending: boolean;
}) {
  return (
    <div className="border-thick border-border p-3 space-y-3 bg-background">
      <div className="flex items-center gap-2">
        {user.isSuperAdmin && <Shield className="h-4 w-4 text-primary shrink-0" />}
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{user.name}</div>
          <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
        </div>
      </div>

      <div className="space-y-2">
        {user.memberships.map((m) => (
          <div
            key={m.id}
            className={`flex items-center justify-between gap-2 border-thick p-2 ${
              m.isActive ? "border-border" : "border-border/40 opacity-60"
            }`}
          >
            <div className="min-w-0 flex items-center gap-2">
              <span className="bg-muted px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider shrink-0">
                {SCOPE_LABELS[m.scope] || m.scope}
              </span>
              <span className="text-[11px] font-bold truncate">{m.scopeName}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={m.role}
                onChange={(e) => onRoleChange(m.id, e.target.value)}
                disabled={isPending}
                className="border-thick border-border rounded-none h-7 text-[10px] bg-background px-1 focus-visible:outline-none font-mono"
              >
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <Button
                onClick={() => onToggleActive(m.id, !m.isActive)}
                disabled={isPending}
                title={m.isActive ? "無効化 (権限剥奪)" : "有効化"}
                className={`rounded-none border-thick border-border h-7 text-[9px] uppercase font-bold px-2 shrink-0 ${
                  m.isActive
                    ? "bg-background text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    : "bg-background text-foreground hover:bg-primary hover:text-primary-foreground"
                }`}
              >
                {m.isActive ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

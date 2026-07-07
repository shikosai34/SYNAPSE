import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { membershipApi } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Users, UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

// モーダル
import { EventStaffFormModal } from "./EventStaffFormModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface StaffTabProps {
  eventId: string;
  staffMembers: any[] | undefined;
  staffLoading: boolean;
  /** イベントスタッフ一覧取得の isError (省略時はエラー分岐を表示しない) */
  staffError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  invites: any[] | undefined;
}

export function StaffTab({
  eventId,
  staffMembers,
  staffLoading,
  staffError,
  error,
  onRetry,
  invites
}: StaffTabProps) {
  const queryClient = useQueryClient();
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  // 招待削除確認用ステート
  const [isDeleteInviteConfirmOpen, setIsDeleteInviteConfirmOpen] = useState(false);
  const [inviteToDelete, setInviteToDelete] = useState<any | null>(null);

  // スタッフ削除（解除）確認用ステート
  const [isDeactivateConfirmOpen, setIsDeactivateConfirmOpen] = useState(false);
  const [memberToDeactivate, setMemberToDeactivate] = useState<any | null>(null);

  // 招待トークン削除
  const deleteInviteMutation = useMutation({
    mutationFn: (id: string) => membershipApi.deleteInvite(id),
    onSuccess: () => {
      toast.success("招待を取り消しました");
      queryClient.invalidateQueries({ queryKey: ["invites", eventId] });
      setIsDeleteInviteConfirmOpen(false);
      setInviteToDelete(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "招待の取消に失敗しました");
    },
  });

  // スタッフ無効化
  const deactivateStaffMutation = useMutation({
    mutationFn: (id: string) => membershipApi.deactivate(id),
    onSuccess: () => {
      toast.success("スタッフの登録を解除しました");
      queryClient.invalidateQueries({ queryKey: ["eventStaff", eventId] });
      setIsDeactivateConfirmOpen(false);
      setMemberToDeactivate(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "解除に失敗しました");
    },
  });

  const handleOpenInvite = () => {
    setIsInviteModalOpen(true);
  };

  const handleOpenDeleteInvite = (invite: any) => {
    setInviteToDelete(invite);
    setIsDeleteInviteConfirmOpen(true);
  };

  const handleOpenDeactivate = (member: any) => {
    setMemberToDeactivate(member);
    setIsDeactivateConfirmOpen(true);
  };

  return (
    <div className="space-y-6 font-mono text-foreground">
      <div className="flex justify-between items-center border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Users className="h-4 w-4" />
          イベント所属スタッフ管理
        </h2>
        <Button
          onClick={handleOpenInvite}
          className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] uppercase font-bold transition-all shadow-none px-3 flex items-center gap-1"
        >
          <UserPlus className="h-3.5 w-3.5" />
          スタッフを招待
        </Button>
      </div>

      {/* 招待リンク一覧 */}
      {invites && invites.length > 0 && (
        <Card className=" rounded-none bg-background shadow-none">
          <CardHeader className="p-4 pb-2 border-b-thin border-border bg-muted/20">
            <CardTitle className="text-xs uppercase font-bold">[アクティブな招待リンク一覧]</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {invites.map((inv) => {
              const inviteUrl = `${window.location.origin}/login?invite=${inv.token}`;
              return (
                <div key={inv.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-2.5 text-[10px] font-mono bg-muted/30">
                  <div className="space-y-0.5">
                    <p className="font-bold text-foreground">ロール: {inv.role}</p>
                    <p className="text-muted-foreground text-[8px] break-all select-all">リンク: {inviteUrl}</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleOpenDeleteInvite(inv)}
                    className="h-7 text-[8px] font-bold uppercase rounded-none px-2 shadow-none border border-transparent mt-2 sm:mt-0 shrink-0"
                  >
                    取消
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* スタッフ一覧 */}
      <Card className=" rounded-none bg-background shadow-none">
        <CardHeader className="p-4 pb-2 border-b-thick border-border bg-muted/20">
          <CardTitle className="text-xs uppercase font-bold">[登録済みスタッフ一覧]</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {staffLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : staffError ? (
            <div className="p-4">
              <ErrorState error={error} onRetry={onRetry} />
            </div>
          ) : staffMembers && staffMembers.length > 0 ? (
            <div className="divide-y divide-border">
              {staffMembers.map((member) => (
                <div key={member.id} className="flex justify-between items-center p-3 text-xs font-mono">
                  <div>
                    <p className="font-bold text-foreground">{member.userName || "名前未設定"}</p>
                    <p className="text-[10px] text-muted-foreground">{member.userEmail}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="default" className="rounded-none text-[8px] font-mono border-thick border-border bg-transparent text-foreground border uppercase">
                      {member.role === "event_admin" ? "管理者" : "スタッフ"}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenDeactivate(member)}
                      className="border-thick border-border hover:bg-destructive hover:text-destructive-foreground text-[10px] h-7 px-2 rounded-none shadow-none"
                    >
                      解除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              message="スタッフは登録されていません"
              actionLabel="スタッフを招待"
              onAction={handleOpenInvite}
            />
          )}
        </CardContent>
      </Card>

      {/* スタッフ招待モーダル */}
      <EventStaffFormModal
        eventId={eventId}
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
      />

      {/* 招待取消確認ダイアログ (破壊的操作のため ConfirmDialog を使用) */}
      <ConfirmDialog
        isOpen={isDeleteInviteConfirmOpen}
        title="[確認: スタッフ招待の取消]"
        description={`本当にこの招待リンクを取り消しますか？取り消されたリンクは無効になります。`}
        confirmLabel="取り消す"
        onConfirm={() => inviteToDelete && deleteInviteMutation.mutate(inviteToDelete.id)}
        onCancel={() => setIsDeleteInviteConfirmOpen(false)}
      />

      {/* スタッフ解除確認ダイアログ (破壊的操作のため ConfirmDialog を使用) */}
      <ConfirmDialog
        isOpen={isDeactivateConfirmOpen}
        title="[確認: スタッフ登録の解除]"
        description={`本当にスタッフ「${memberToDeactivate?.userName}」さんの登録を解除しますか？解除されるとダッシュボードにアクセスできなくなります。`}
        confirmLabel="解除する"
        onConfirm={() => memberToDeactivate && deactivateStaffMutation.mutate(memberToDeactivate.id)}
        onCancel={() => setIsDeactivateConfirmOpen(false)}
      />
    </div>
  );
}

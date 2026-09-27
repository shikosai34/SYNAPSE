import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { membershipApi, type RoleInfo } from "@/lib/api";
import { PERMISSION_NAMES, ROLE_NAMES, type RoleType } from "@/hooks/useCircleAuth";
import { roleLabel } from "@/lib/roles";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Users, UserPlus, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";

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
  const [isStaffTableOpen, setIsStaffTableOpen] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");

  const { data: rolesData } = useQuery({
    queryKey: ["membershipRoles"],
    queryFn: () => membershipApi.getRoles(),
  });

  // 招待削除確認用ステート
  const [isDeleteInviteConfirmOpen, setIsDeleteInviteConfirmOpen] = useState(false);
  const [inviteToDelete, setInviteToDelete] = useState<any | null>(null);

  // スタッフ削除（解除）確認用ステート
  const [isDeactivateConfirmOpen, setIsDeactivateConfirmOpen] = useState(false);
  const [memberToDeactivate, setMemberToDeactivate] = useState<any | null>(null);

  // 招待の有効期限を7日延長 (2026-07-14 P1-4)
  const extendInviteMutation = useMutation({
    mutationFn: (id: string) => membershipApi.extendInvite(id, 168),
    onSuccess: () => {
      toast.success("有効期限を7日間延長しました");
      queryClient.invalidateQueries({ queryKey: ["invites", eventId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "延長に失敗しました");
    },
  });

  // 期限切れ招待の再発行 (新しいコード・7日期限で作り直す) (2026-07-14 P1-4 強化)
  const regenerateInviteMutation = useMutation({
    mutationFn: (id: string) => membershipApi.regenerateInvite(id),
    onSuccess: () => {
      toast.success("新しい招待コードを発行しました");
      queryClient.invalidateQueries({ queryKey: ["invites", eventId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "再発行に失敗しました");
    },
  });

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
    // 2026-09-27: 確認ダイアログを開く前に一覧を閉じ、Escape で背面のモーダルも閉じる状態を防ぐ。
    setIsStaffTableOpen(false);
    setMemberToDeactivate(member);
    setIsDeactivateConfirmOpen(true);
  };

  const filteredStaffMembers = (staffMembers ?? []).filter((member) =>
    `${member.userName ?? ""} ${member.userEmail ?? ""}`.toLocaleLowerCase().includes(staffSearch.trim().toLocaleLowerCase())
  );

  // ワンクリックコピー (2026-07-14 P2-6)。配布導線を楽にする。
  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label}をコピーしました`);
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

      {/* 2026-09-27: イベント管理ではイベント共同管理者の権限だけを説明し、サークル権限との混同を防ぐ。 */}
      <Card className="rounded-none bg-background shadow-none">
        <CardHeader className="p-4 pb-2 border-b-thick border-border bg-muted/20">
          <CardTitle className="text-xs uppercase font-bold">[イベント権限]</CardTitle>
          <p className="text-[10px] text-muted-foreground mt-1">このイベントと所属サークルの範囲で適用される権限です。システム全体の権限や、サークル単体のロールは含みません。</p>
        </CardHeader>
        <CardContent className="p-4">
          {rolesData?.filter((roleInfo: RoleInfo) => roleInfo.role === "event_manager").map((roleInfo) => (
            <div key={roleInfo.role} className="space-y-2">
              <Badge variant="default" className="rounded-none text-[8px] font-mono border-thick border-border bg-transparent text-foreground uppercase">
                {ROLE_NAMES[roleInfo.role as RoleType] || roleInfo.role}
              </Badge>
              <p className="text-xs text-muted-foreground leading-relaxed">
                権限: {roleInfo.permissions.map((permission) => PERMISSION_NAMES[permission] || permission).join("、 ") || "なし"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 招待リンク一覧 */}
      {invites && invites.length > 0 && (
        <Card className=" rounded-none bg-background shadow-none">
          <CardHeader className="p-4 pb-2 border-b-thin border-border bg-muted/20">
            <CardTitle className="text-xs uppercase font-bold">[招待リンク一覧]</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {invites.map((inv) => {
              // 2026-07-12: 招待種別に応じた受諾リンク。circle_host(サークル出店)は
              // /event/invite、共同管理者も同じ受諾ページで種別判定される。
              const kind =
                inv.circleId ? "circle" : inv.role === "circle_manager" ? "host" : "event";
              const path = kind === "circle" ? "circle" : "event";
              const inviteUrl = `${window.location.origin}/${path}/invite/${inv.token}`;
              const purposeLabel =
                kind === "host"
                  ? "サークル出店"
                  : kind === "event"
                    ? "イベント共同管理者"
                    : "サークルスタッフ";
              // 有効期限の残り時間表示 (2026-07-14 P1-4)。24h未満は時間、以上は日で概算。
              const msLeft = new Date(inv.expiresAt).getTime() - Date.now();
              const hoursLeft = Math.max(0, Math.floor(msLeft / 3_600_000));
              const remainLabel =
                hoursLeft >= 24 ? `残り約${Math.floor(hoursLeft / 24)}日` : `残り約${hoursLeft}時間`;
              const expiringSoon = hoursLeft < 24;
              const isExpired = !!inv.expired;
              return (
                <div key={inv.id} className={`flex flex-col sm:flex-row justify-between items-start gap-3 p-2.5 text-[10px] font-mono ${isExpired ? "bg-destructive/5 opacity-80" : "bg-muted/30"}`}>
                  <div className="flex gap-3 min-w-0">
                    {/* 配布用QR (リンクをエンコード)。掲示・スクショで共有しやすくする (P2-6)。失効時は薄く表示 */}
                    <div className={`border-thick border-border p-1 bg-white shrink-0 hidden sm:block ${isExpired ? "opacity-40" : ""}`}>
                      <QRCodeSVG value={inviteUrl} size={72} level="M" />
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-bold text-foreground flex items-center gap-1.5">
                        {purposeLabel}（{inv.usedCount}/{inv.maxUses ?? "∞"} 使用）
                        {isExpired && (
                          <Badge variant="default" className="rounded-none text-[8px] font-mono border-thick border-destructive bg-destructive/10 text-destructive uppercase">期限切れ</Badge>
                        )}
                      </p>
                      {inv.code && (
                        <p className="text-foreground text-[11px] flex items-center gap-1">
                          招待コード: <span className="font-bold tracking-wider select-all">{inv.code}</span>
                          <button onClick={() => copy(inv.code, "招待コード")} className="text-muted-foreground hover:text-foreground" aria-label="招待コードをコピー">
                            <Copy className="h-3 w-3" />
                          </button>
                        </p>
                      )}
                      <p className="text-muted-foreground text-[8px] break-all flex items-center gap-1">
                        <span className="select-all min-w-0 break-all">リンク: {inviteUrl}</span>
                        <button onClick={() => copy(inviteUrl, "招待リンク")} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="招待リンクをコピー">
                          <Copy className="h-3 w-3" />
                        </button>
                      </p>
                      <p className={`text-[8px] ${expiringSoon ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                        有効期限: {new Date(inv.expiresAt).toLocaleString("ja-JP")}（{remainLabel}）
                      </p>
                      {/* 使用内訳: この招待から作られたサークル (P2-5) */}
                      {inv.consumedBy && inv.consumedBy.length > 0 && (
                        <div className="pt-1 mt-1 border-t border-border/30">
                          <p className="text-[8px] text-muted-foreground font-bold">作成されたサークル:</p>
                          <ul className="text-[9px] text-foreground list-disc list-inside">
                            {inv.consumedBy.map((cc: { id: string; name: string }) => (
                              <li key={cc.id} className="truncate">{cc.name}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isExpired ? (
                      // 失効時は「再発行」(新コード) を主導線にする。延長(同コード延命)も残す。
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => regenerateInviteMutation.mutate(inv.id)}
                        disabled={regenerateInviteMutation.isPending}
                        className="h-7 text-[8px] font-bold uppercase rounded-none px-2 shadow-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground"
                      >
                        再発行
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => extendInviteMutation.mutate(inv.id)}
                        disabled={extendInviteMutation.isPending}
                        className="h-7 text-[8px] font-bold uppercase rounded-none px-2 shadow-none border-thick border-border"
                      >
                        7日延長
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleOpenDeleteInvite(inv)}
                      className="h-7 text-[8px] font-bold uppercase rounded-none px-2 shadow-none border border-transparent"
                    >
                      取消
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* スタッフ一覧 */}
      <Card className=" rounded-none bg-background shadow-none">
        <CardHeader className="p-4 pb-2 border-b-thick border-border bg-muted/20 flex flex-row items-center justify-between">
          <CardTitle className="text-xs uppercase font-bold">[登録済みスタッフ一覧]</CardTitle>
          {staffMembers && staffMembers.length > 0 && (
            <Button variant="outline" onClick={() => setIsStaffTableOpen(true)} className="rounded-none border-thick border-border text-xs">一覧を開く（{staffMembers.length}人）</Button>
          )}
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
            <p className="p-4 text-xs text-muted-foreground">{staffMembers.length}人が登録されています。表で検索・解除できます。</p>
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

      {/* 2026-09-27: イベント所属者が増えてもタブを縦に伸ばさず、既存操作を表モーダル内に保つ。 */}
      <Modal isOpen={isStaffTableOpen} onClose={() => setIsStaffTableOpen(false)} title="[登録済みスタッフ一覧]" subtitle={`${staffMembers?.length ?? 0}人`} maxWidth="xl">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label="イベントスタッフを検索" value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} placeholder="名前・メールアドレスで検索" className="pl-9 rounded-none border-thick border-border" />
        </div>
        <div className="max-h-[55vh] overflow-auto border-thick border-border">
          <table className="w-full min-w-[520px] text-xs text-left font-mono">
            <thead className="sticky top-0 bg-background"><tr className="border-b-thick border-border"><th className="p-3">名前</th><th className="p-3">メール</th><th className="p-3">ロール</th><th className="p-3 text-right">操作</th></tr></thead>
            <tbody>
              {filteredStaffMembers.map((member) => (
                <tr key={member.id} className="border-b-thin border-border">
                  <td className="p-3 font-bold">{member.userName || "名前未設定"}</td>
                  <td className="p-3">{member.userEmail}</td>
                  <td className="p-3"><Badge variant="default" className="rounded-none text-[8px] font-mono border-thick border-border bg-transparent text-foreground uppercase">{roleLabel(member.role)}</Badge></td>
                  <td className="p-3 text-right"><Button variant="outline" size="sm" onClick={() => handleOpenDeactivate(member)} disabled={deactivateStaffMutation.isPending} className="border-thick border-border hover:bg-destructive hover:text-destructive-foreground text-[10px] h-7 px-2 rounded-none shadow-none">解除</Button></td>
                </tr>
              ))}
              {filteredStaffMembers.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">該当するスタッフがいません</td></tr>}
            </tbody>
          </table>
        </div>
      </Modal>

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

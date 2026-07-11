
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
  ROLES,
  ROLE_NAMES,
  PERMISSION_NAMES,
  type RoleType,
} from "@/hooks/useCircleAuth";
import { membershipApi, type Role } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/Modal";
import {
  FormField,
  FormSelect,
  FormSubmitButton,
} from "@/components/ui/FormField";
import { undoableDelete } from "@/lib/toast-undo";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import {
  UserPlus,
  Link as LinkIcon,
  Copy,
  Check,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

function MembersContent() {
  const { circleId, role, userEmail } = useAuth();
  const queryClient = useQueryClient();
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // 削除確認ダイアログ用ステート (メンバー除名 / 招待リンク削除)

  useEffect(() => {
    const authStored = localStorage.getItem("circleAuth");
    if (authStored) {
      try {
        const authInfo = JSON.parse(authStored);
        if (authInfo.circleName) {
          setCircleName(authInfo.circleName);
        }
      } catch (_) {}
    }
  }, []);

  // フォーム状態
  // 2026-07-07 (Phase 3b): 独自PIN認証の廃止に伴い pin 欄を撤去。
  // メンバーは追加後、招待/better-auth アカウントでログインする前提。
  // 2026-07-11: 初期ロールを "viewer" → "circle_staff" に修正。
  // ロール選択 (FormSelect) は circle_manager / circle_staff しか選択肢に出さず、かつ
  // バックエンド (membership.ts の z.enum) は viewer を受け付けない。初期値が viewer だと
  // 「モーダルを開いてそのまま送信」した時に select 表示 (先頭=マネージャー) と実 state (viewer) が
  // 食い違ったまま viewer が送られ 400 で失敗していた。選択肢の先頭と一致する有効な最小権限ロールにする。
  const [newMember, setNewMember] = useState({
    userId: "",
    userEmail: "",
    userName: "",
    role: "circle_staff" as Role,
  });

  const [inviteSettings, setInviteSettings] = useState({
    role: "circle_staff" as Role,
    maxUses: 1,
    expiresInHours: 24,
    targetEmail: "",
  });

  // API呼び出し
  const {
    data: members,
    isError: membersError,
    error: membersErrorObj,
    refetch: refetchMembers,
  } = useQuery({
    queryKey: ["members", circleId],
    queryFn: () => membershipApi.listByCircle(circleId!),
    enabled: !!circleId,
  });

  const {
    data: inviteTokens,
    isError: inviteTokensError,
    error: inviteTokensErrorObj,
    refetch: refetchTokens,
  } = useQuery({
    queryKey: ["inviteTokens", circleId],
    queryFn: () => membershipApi.listInvites(circleId!),
    enabled: !!circleId,
  });

  const { data: rolesData } = useQuery({
    queryKey: ["roles"],
    queryFn: () => membershipApi.getRoles(),
  });

  const addMemberMutation = useMutation({
    mutationFn: (input: {
      userEmail: string;
      userName: string;
      circleId?: string;
      eventId?: string;
      role: Role;
    }) => membershipApi.addMember(input),
    onSuccess: () => {
      refetchMembers();
      toast.success("メンバーを追加しました");
      setShowAddForm(false);
      setNewMember({
        userId: "",
        userEmail: "",
        userName: "",
        role: "circle_staff",
      });
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: (input: {
      circleId?: string;
      eventId?: string;
      role: Role;
      expiresInHours?: number;
      maxUses?: number;
      createdBy: string;
      targetEmail?: string;
    }) => membershipApi.createInvite(input),
    onSuccess: (data) => {
      refetchTokens();
      // 招待作成後すぐ共有できるよう、生成されたリンクをクリップボードへコピーする。
      // 従来は「作成しました」だけで、リンクは下の一覧までスクロールして copy し直す必要があり
      // フローが途切れていた (2026-07-11)。
      if (data?.token) {
        const link = `${window.location.origin}/circle/invite/${data.token}`;
        navigator.clipboard?.writeText(link).catch(() => {});
        toast.success("招待リンクを作成し、クリップボードにコピーしました");
      } else {
        toast.success("招待を作成しました");
      }
      setInviteSettings((prev) => ({ ...prev, targetEmail: "" }));
      setShowInviteForm(false);
    },
  });

  // 除名 / 招待リンク削除は確認ダイアログの代わりに undo 付きトーストで実行する
  const handleRemoveMember = (member: any) =>
    undoableDelete({
      queryClient,
      queryKey: ["members", circleId],
      id: member.id,
      message: `メンバー「${member.userName}」を除名しました`,
      commit: () => membershipApi.delete(member.id),
    });

  const handleDeleteToken = (token: any) =>
    undoableDelete({
      queryClient,
      queryKey: ["inviteTokens", circleId],
      id: token.id,
      message: "招待リンクを削除しました",
      commit: () => membershipApi.deleteInvite(token.id),
    });

  const handleAddMember = () => {
    if (!circleId) return;
    addMemberMutation.mutate({
      userEmail: newMember.userEmail,
      userName: newMember.userName,
      circleId,
      role: newMember.role,
    });
  };

  const handleCreateInvite = () => {
    if (!circleId) return;
    createInviteMutation.mutate({
      circleId,
      role: inviteSettings.role,
      maxUses: inviteSettings.maxUses,
      expiresInHours: inviteSettings.expiresInHours,
      createdBy: userEmail || "",
      targetEmail: inviteSettings.targetEmail || undefined,
    });
  };

  const copyInviteLink = (token: string) => {
    // 単一ドメイン化 (2026-07-07): 招待受諾ページは /circle/invite/:token に移設
    const link = `${window.location.origin}/circle/invite/${token}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "super_admin":
      case "system_manager":
      case "event_manager":
        return "error";
      case "circle_manager":
        return "active";
      case "circle_staff":
        return "warning";
      default:
        return "default";
    }
  };

  return (
    <DashboardLayout
      title={circleName}
      subtitle="メンバー管理"
      type="circle"
      // 主要アクションは共通ヘッダー右側へ集約 (旧: children 内の二重見出し行) (2026-07-11)
      actions={
        <PermissionGuard permission="member:write">
          <Button
            onClick={() => setShowAddForm(true)}
            variant="outline"
            className="rounded-none border-thick border-border h-8 text-[11px] font-bold shadow-none px-3 bg-background hover:bg-neutral-100"
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            メンバー追加
          </Button>
          <Button
            onClick={() => setShowInviteForm(true)}
            className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold shadow-none px-3"
          >
            <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
            招待リンク作成
          </Button>
        </PermissionGuard>
      }
    >
      <div className="space-y-6 font-mono">
      {/* メンバー追加モーダル */}
      <Modal
        isOpen={showAddForm}
        onClose={() => setShowAddForm(false)}
        title="[新規メンバー追加]"
        subtitle="メンバーを直接追加します。追加された相手はこのメールアドレスの better-auth アカウント (メール/パスワード・パスキー・Google) でログインしてください。招待リンクを使う場合は「招待リンク作成」を使用してください。"
      >
        <div className="grid grid-cols-2 gap-4">
          <FormField
            id="email"
            label="メールアドレス"
            required
            type="email"
            placeholder="example@email.com"
            value={newMember.userEmail}
            onChange={(e) => setNewMember({ ...newMember, userEmail: e.target.value })}
          />
          <FormField
            id="name"
            label="名前"
            required
            placeholder="山田太郎"
            value={newMember.userName}
            onChange={(e) => setNewMember({ ...newMember, userName: e.target.value })}
          />
          <FormSelect
            id="role"
            label="ロール"
            value={newMember.role}
            onChange={(e) => setNewMember({ ...newMember, role: e.target.value as Role })}
          >
            {Object.entries(ROLES)
              .filter(([, value]) =>
                [ROLES.CIRCLE_MANAGER, ROLES.CIRCLE_STAFF].includes(value as any),
              )
              .map(([, value]) => (
                <option key={value} value={value}>
                  {ROLE_NAMES[value]}
                </option>
              ))}
          </FormSelect>
        </div>

        <FormSubmitButton
          onClick={handleAddMember}
          disabled={!newMember.userEmail || !newMember.userName}
          isPending={addMemberMutation.isPending}
          icon={UserPlus}
        >
          追加する
        </FormSubmitButton>
      </Modal>

      {/* 招待リンク作成モーダル */}
      <Modal
        isOpen={showInviteForm}
        onClose={() => setShowInviteForm(false)}
        title="[招待リンク作成]"
        subtitle="新しいメンバーを招待するためのリンクを生成します。"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormSelect
            id="invite-role"
            label="付与するロール"
            value={inviteSettings.role}
            onChange={(e) => setInviteSettings({ ...inviteSettings, role: e.target.value as Role })}
          >
            {Object.entries(ROLES)
              .filter(([, value]) =>
                [ROLES.CIRCLE_MANAGER, ROLES.CIRCLE_STAFF].includes(value as any),
              )
              .map(([, value]) => (
                <option key={value} value={value}>
                  {ROLE_NAMES[value]}
                </option>
              ))}
          </FormSelect>
          <FormField
            id="max-uses"
            label="最大使用回数"
            type="number"
            min={1}
            max={100}
            value={inviteSettings.maxUses}
            onChange={(e) =>
              setInviteSettings({ ...inviteSettings, maxUses: parseInt(e.target.value) || 1 })
            }
          />
          <FormField
            id="expires"
            label="有効期限（時間）"
            type="number"
            min={1}
            max={720}
            value={inviteSettings.expiresInHours}
            onChange={(e) =>
              setInviteSettings({
                ...inviteSettings,
                expiresInHours: parseInt(e.target.value) || 24,
              })
            }
          />
          <FormField
            id="target-email"
            label="相手のメール (直接通知する場合)"
            type="email"
            placeholder="user@example.com (任意)"
            value={inviteSettings.targetEmail}
            onChange={(e) => setInviteSettings({ ...inviteSettings, targetEmail: e.target.value })}
          />
        </div>

        <FormSubmitButton
          onClick={handleCreateInvite}
          isPending={createInviteMutation.isPending}
          icon={LinkIcon}
        >
          リンクを生成
        </FormSubmitButton>
      </Modal>

      {/* アクティブな招待リンク */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="h-5 w-5" />
            アクティブな招待リンク
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inviteTokensError ? (
            <ErrorState error={inviteTokensErrorObj} onRetry={() => refetchTokens()} />
          ) : inviteTokens && inviteTokens.length > 0 ? (
            <div className="space-y-3">
              {inviteTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between p-3 border-thick border-border"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={getRoleBadgeVariant(token.role)}>
                      {ROLE_NAMES[token.role as RoleType] || token.role}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      使用: {token.usedCount}/{token.maxUses || "∞"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      期限:{" "}
                      {new Date(token.expiresAt).toLocaleDateString("ja-JP")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyInviteLink(token.token)}
                    >
                      {copiedToken === token.token ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <PermissionGuard permission="member:delete">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteToken(token)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </PermissionGuard>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={LinkIcon}
              message="有効な招待リンクはありません"
            />
          )}
        </CardContent>
      </Card>

      {/* メンバー一覧 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            メンバー一覧
          </CardTitle>
          <CardDescription>
            {members?.length || 0}人のメンバーが登録されています
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersError ? (
            <ErrorState error={membersErrorObj} onRetry={() => refetchMembers()} />
          ) : members && members.length > 0 ? (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 border-thick border-border"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 border-thick border-border bg-secondary flex items-center justify-center">
                      <Shield className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{member.userName}</p>
                      <p className="text-sm text-muted-foreground">
                        {member.userEmail}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={getRoleBadgeVariant(member.role)}>
                      {ROLE_NAMES[member.role as RoleType] || member.role}
                    </Badge>
                    {!member.isActive && (
                      <Badge variant="warning">非アクティブ</Badge>
                    )}
                    <PermissionGuard permission="member:delete">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveMember(member)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </PermissionGuard>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              message="まだメンバーがいません"
            />
          )}
        </CardContent>
      </Card>

      {/* ロール説明 */}
      <Card>
        <CardHeader>
          <CardTitle>ロールと権限</CardTitle>
          <CardDescription>各ロールで利用可能な機能の説明</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {rolesData &&
              rolesData.map((roleInfo) => (
                <div
                  key={roleInfo.role}
                  className="p-4 border-thick border-border space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={getRoleBadgeVariant(roleInfo.role)}>
                      {ROLE_NAMES[roleInfo.role as RoleType] || roleInfo.role}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    権限: {roleInfo.permissions.map(p => PERMISSION_NAMES[p] || p).join("、 ") || "なし"}
                  </p>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
      </div>
    </DashboardLayout>
  );
}

export default function MembersPage() {
  return (
    <CircleAuthGuard>
      <PermissionGuard
        permission="member:read"
        fallback={
          <div className="container mx-auto p-6">
            <Card>
              <CardContent className="py-8 text-center">
                <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium">アクセス権限がありません</p>
                <p className="text-muted-foreground">
                  メンバー管理にアクセスするには適切な権限が必要です
                </p>
              </CardContent>
            </Card>
          </div>
        }
      >
        <MembersContent />
      </PermissionGuard>
    </CircleAuthGuard>
  );
}

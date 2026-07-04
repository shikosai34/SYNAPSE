
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  const [newMember, setNewMember] = useState({
    userId: "",
    userEmail: "",
    userName: "",
    role: "viewer" as Role,
    pin: "",
  });

  const [inviteSettings, setInviteSettings] = useState({
    role: "viewer" as Role,
    maxUses: 1,
    expiresInHours: 24,
    targetEmail: "",
  });

  // API呼び出し
  const { data: members, refetch: refetchMembers } = useQuery({
    queryKey: ["members", circleId],
    queryFn: () => membershipApi.listByCircle(circleId!),
    enabled: !!circleId,
  });

  const { data: inviteTokens, refetch: refetchTokens } = useQuery({
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
      pin?: string;
    }) => membershipApi.addMember(input),
    onSuccess: () => {
      refetchMembers();
      setShowAddForm(false);
      setNewMember({
        userId: "",
        userEmail: "",
        userName: "",
        role: "viewer",
        pin: "",
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
    onSuccess: () => {
      refetchTokens();
      toast.success("招待を作成しました");
      setInviteSettings((prev) => ({ ...prev, targetEmail: "" }));
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (input: { membershipId: string }) =>
      membershipApi.delete(input.membershipId),
    onSuccess: () => {
      refetchMembers();
    },
  });

  const deleteTokenMutation = useMutation({
    mutationFn: (input: { tokenId: string }) =>
      membershipApi.deleteInvite(input.tokenId),
    onSuccess: () => {
      refetchTokens();
    },
  });

  const handleAddMember = () => {
    if (!circleId) return;
    addMemberMutation.mutate({
      userEmail: newMember.userEmail,
      userName: newMember.userName,
      circleId,
      role: newMember.role,
      pin: newMember.pin || undefined,
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
    const link = `${window.location.origin}/invite/${token}`;
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
    <DashboardLayout title={circleName} subtitle="メンバー管理" type="circle">
      <div className="space-y-6 font-mono">
        <div className="flex items-center justify-between border-b-thick border-border pb-3">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
              <Users className="h-4 w-4" />
              メンバー管理
            </h2>
          </div>
          <div className="flex gap-2">
            <PermissionGuard permission="member:write">
              <Button
                onClick={() => setShowAddForm(!showAddForm)}
                variant="outline"
                className="rounded-none border-thick border-border h-8 text-[11px] font-bold shadow-none px-3 bg-background hover:bg-neutral-100"
              >
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                メンバー追加
              </Button>
              <Button 
                onClick={() => setShowInviteForm(!showInviteForm)}
                className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold shadow-none px-3"
              >
                <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
                招待リンク作成
              </Button>
            </PermissionGuard>
          </div>
        </div>

      {/* メンバー追加フォーム */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>新規メンバー追加</CardTitle>
            <CardDescription>
              メンバーを直接追加します。招待リンクを使う場合は「招待リンク作成」を使用してください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="example@email.com"
                  value={newMember.userEmail}
                  onChange={(e) =>
                    setNewMember({ ...newMember, userEmail: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">名前</Label>
                <Input
                  id="name"
                  placeholder="山田太郎"
                  value={newMember.userName}
                  onChange={(e) =>
                    setNewMember({ ...newMember, userName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">ロール</Label>
                <select
                  id="role"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={newMember.role}
                  onChange={(e) =>
                    setNewMember({
                      ...newMember,
                      role: e.target.value as Role,
                    })
                  }
                >
                  {Object.entries(ROLES)
                    .filter(([key, value]) => {
                      return [
                        ROLES.CIRCLE_MANAGER,
                        ROLES.CIRCLE_STAFF,
                      ].includes(value as any);
                    })
                    .map(([key, value]) => (
                    <option key={value} value={value}>
                      {ROLE_NAMES[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pin">PIN（オプション）</Label>
                <Input
                  id="pin"
                  type="password"
                  placeholder="4-6桁の数字"
                  value={newMember.pin}
                  onChange={(e) =>
                    setNewMember({ ...newMember, pin: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddForm(false)}>
                キャンセル
              </Button>
              <Button
                onClick={handleAddMember}
                disabled={
                  !newMember.userEmail ||
                  !newMember.userName ||
                  addMemberMutation.isPending
                }
              >
                追加
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 招待リンク作成フォーム */}
      {showInviteForm && (
        <Card>
          <CardHeader>
            <CardTitle>招待リンク作成</CardTitle>
            <CardDescription>
              新しいメンバーを招待するためのリンクを生成します
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="invite-role">付与するロール</Label>
                <select
                  id="invite-role"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={inviteSettings.role}
                  onChange={(e) =>
                    setInviteSettings({
                      ...inviteSettings,
                      role: e.target.value as Role,
                    })
                  }
                >
                  {Object.entries(ROLES)
                    .filter(([key, value]) => {
                      return [
                        ROLES.CIRCLE_MANAGER,
                        ROLES.CIRCLE_STAFF,
                      ].includes(value as any);
                    })
                    .map(([key, value]) => (
                    <option key={value} value={value}>
                      {ROLE_NAMES[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-uses">最大使用回数</Label>
                <Input
                  id="max-uses"
                  type="number"
                  min={1}
                  max={100}
                  value={inviteSettings.maxUses}
                  onChange={(e) =>
                    setInviteSettings({
                      ...inviteSettings,
                      maxUses: parseInt(e.target.value) || 1,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expires">有効期限（時間）</Label>
                <Input
                  id="expires"
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="target-email">相手のメールアドレス (直接通知を送る場合)</Label>
                <Input
                  id="target-email"
                  type="email"
                  placeholder="user@example.com (任意)"
                  value={inviteSettings.targetEmail}
                  onChange={(e) =>
                    setInviteSettings({
                      ...inviteSettings,
                      targetEmail: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowInviteForm(false)}
              >
                キャンセル
              </Button>
              <Button
                onClick={handleCreateInvite}
                disabled={createInviteMutation.isPending}
              >
                リンク生成
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* アクティブな招待リンク */}
      {inviteTokens && inviteTokens.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LinkIcon className="h-5 w-5" />
              アクティブな招待リンク
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {inviteTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
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
                        onClick={() =>
                          deleteTokenMutation.mutate({ tokenId: token.id })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </PermissionGuard>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
          {members && members.length > 0 ? (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
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
                        onClick={() =>
                          removeMemberMutation.mutate({
                            membershipId: member.id,
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </PermissionGuard>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>まだメンバーがいません</p>
              <p className="text-sm">
                上のボタンからメンバーを追加してください
              </p>
            </div>
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
                  className="p-4 rounded-lg border space-y-2"
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

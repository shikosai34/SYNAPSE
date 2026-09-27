import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
} from "@/hooks/useCircleAuth";
import { staffApi } from "@/lib/api";
import type { Staff } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { toast } from "sonner";
import {
  Plus,
  Edit,
  Trash2,
  User,
  Users,
  Search,
} from "lucide-react";

// スタッフモーダルとカスタムダイアログ
import { StaffFormModal } from "@/components/staff/StaffFormModal";
import { undoableDelete } from "@/lib/toast-undo";

function StaffManagementContent() {
  // 2026-07-16: circleName も circleId 同様、localStorage(circleAuth) を mount 時に
  // 一度だけ読む独自 state だと、同一パス上でのスペース切り替え後に古いサークル名の
  // ままになる。useAuth() (authChange 購読) から直接取得するよう統一する。
  const { circleId, circleName: authCircleName } = useAuth();
  const circleName = authCircleName ?? "サークルダッシュボード";
  const queryClient = useQueryClient();

  // モーダル用ステート
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isStaffTableOpen, setIsStaffTableOpen] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);

  // 削除確認用ステート

  // スタッフ一覧取得
  const {
    data: staffList,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["staff", circleId],
    queryFn: () => staffApi.list(circleId!),
    enabled: !!circleId,
  });

  // スタッフ削除
  // スタッフ削除は確認ダイアログの代わりに undo 付きトースト
  const handleOpenDelete = (staff: Staff) =>
    undoableDelete<Staff>({
      queryClient,
      queryKey: ["staff", circleId],
      id: staff.id,
      message: `スタッフ「${staff.name}」を削除しました`,
      commit: () => staffApi.delete(staff.id),
    });

  const handleOpenAdd = () => {
    setSelectedStaff(null);
    setIsStaffModalOpen(true);
  };

  const handleOpenEdit = (staff: Staff) => {
    setIsStaffTableOpen(false);
    setSelectedStaff(staff);
    setIsStaffModalOpen(true);
  };

  const filteredStaff = (staffList ?? []).filter((staff) =>
    staff.name.toLocaleLowerCase().includes(staffSearch.trim().toLocaleLowerCase())
  );

  if (isLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="スタッフ管理" type="circle">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-32" />
          <Skeleton className="h-96" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout title={circleName} subtitle="スタッフ管理" type="circle">
        <ErrorState error={error} onRetry={() => refetch()} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      title={circleName}
      subtitle="スタッフ管理"
      type="circle"
      // 主要アクションは共通ヘッダー右側へ集約 (旧: children 内の二重見出し行) (2026-07-11)
      actions={
        <PermissionGuard permission="staff:write">
          <Button onClick={handleOpenAdd} className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold uppercase shadow-none px-3">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            スタッフを追加
          </Button>
        </PermissionGuard>
      }
    >
      <div className="space-y-6 font-mono text-foreground">
        {/* スタッフ一覧 */}
        <Card className=" rounded-none bg-background shadow-none">
          <CardHeader className="p-4 pb-2 border-b-thick border-border flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-xs uppercase font-bold">
              <User className="h-4 w-4" />
              スタッフ一覧 ({staffList?.length || 0})
            </CardTitle>
            {staffList && staffList.length > 0 && (
              <Button variant="outline" onClick={() => setIsStaffTableOpen(true)} className="rounded-none border-thick border-border text-xs">
                一覧を開く
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {staffList && staffList.length > 0 ? (
              <p className="p-4 text-xs text-muted-foreground">{staffList.length}人の登録スタッフ。表で検索・編集できます。</p>
            ) : (
              <PermissionGuard
                permission="staff:write"
                fallback={<EmptyState icon={Users} message="登録スタッフはいません" />}
              >
                <EmptyState
                  icon={Users}
                  message="登録スタッフはいません"
                  actionLabel="スタッフを追加"
                  onAction={handleOpenAdd}
                />
              </PermissionGuard>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 2026-09-27: 長いスタッフ一覧は独立した表モーダルに収め、ページの縦長化を防ぐ。 */}
      <Modal isOpen={isStaffTableOpen} onClose={() => setIsStaffTableOpen(false)} title="[登録スタッフ一覧]" subtitle={`${staffList?.length ?? 0}人`} maxWidth="xl">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input aria-label="スタッフを検索" value={staffSearch} onChange={(e) => setStaffSearch(e.target.value)} placeholder="スタッフ名で検索" className="pl-9 rounded-none border-thick border-border" />
        </div>
        <div className="max-h-[55vh] overflow-auto border-thick border-border">
          <table className="w-full text-xs text-left font-mono">
            <thead className="sticky top-0 bg-background"><tr className="border-b-thick border-border"><th className="p-3">スタッフ名</th><th className="p-3 text-right">操作</th></tr></thead>
            <tbody>
              {filteredStaff.map((staff) => (
                <tr key={staff.id} className="border-b-thin border-border">
                  <td className="p-3 font-bold">{staff.name}</td>
                  <td className="p-3 text-right">
                    <PermissionGuard permission="staff:write"><span className="inline-flex gap-1">
                      <Button aria-label={`${staff.name}を編集`} variant="ghost" size="icon" onClick={() => handleOpenEdit(staff)} className="h-8 w-8 rounded-none border-thick border-transparent hover:border-border"><Edit className="h-4 w-4" /></Button>
                      <PermissionGuard permission="staff:delete"><Button aria-label={`${staff.name}を削除`} variant="ghost" size="icon" onClick={() => handleOpenDelete(staff)} className="h-8 w-8 rounded-none border-thick border-transparent text-destructive"><Trash2 className="h-4 w-4" /></Button></PermissionGuard>
                    </span></PermissionGuard>
                  </td>
                </tr>
              ))}
              {filteredStaff.length === 0 && <tr><td colSpan={2} className="p-6 text-center text-muted-foreground">該当するスタッフがいません</td></tr>}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* スタッフ追加・編集モーダル */}
      {circleId && (
        <StaffFormModal
          circleId={circleId}
          isOpen={isStaffModalOpen}
          onClose={() => setIsStaffModalOpen(false)}
          staff={selectedStaff}
        />
      )}
    </DashboardLayout>
  );
}

export default function StaffManagementPage() {
  return (
    <CircleAuthGuard>
      <PermissionGuard
        permission="staff:read"
        fallback={
          <div className="container mx-auto p-6 font-mono">
            <Card className=" rounded-none bg-background shadow-none">
              <CardContent className="py-12 text-center">
                <Users className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm font-bold uppercase tracking-wider">アクセス権限がありません</p>
                <p className="text-xs text-muted-foreground mt-1">
                  スタッフ管理にアクセスするには適切な権限が必要です
                </p>
              </CardContent>
            </Card>
          </div>
        }
      >
        <StaffManagementContent />
      </PermissionGuard>
    </CircleAuthGuard>
  );
}

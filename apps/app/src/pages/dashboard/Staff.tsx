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
    setSelectedStaff(staff);
    setIsStaffModalOpen(true);
  };

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
          <CardHeader className="p-4 pb-2 border-b-thick border-border">
            <CardTitle className="flex items-center gap-2 text-xs uppercase font-bold">
              <User className="h-4 w-4" />
              スタッフ一覧 ({staffList?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {staffList && staffList.length > 0 ? (
              <div className="divide-y divide-border">
                {staffList.map((staff) => (
                  <div
                    key={staff.id}
                    className="flex items-center justify-between p-3 text-xs font-mono"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-none bg-primary/10 flex items-center justify-center border-thick border-border">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-bold text-foreground">{staff.name}</p>
                      </div>
                    </div>
                    <PermissionGuard permission="staff:write">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(staff)}
                          className="h-8 w-8 rounded-none border-thick border-transparent hover:border-border hover:bg-muted"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <PermissionGuard permission="staff:delete">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive h-8 w-8 rounded-none border-thick border-transparent hover:border-border hover:bg-muted"
                            onClick={() => handleOpenDelete(staff)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </PermissionGuard>
                      </div>
                    </PermissionGuard>
                  </div>
                ))}
              </div>
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

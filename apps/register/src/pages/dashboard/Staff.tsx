import { useState, useEffect } from "react";
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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "sonner";
import {
  Plus,
  Edit,
  Trash2,
  Clock,
  User,
  Users,
  Calendar,
  CheckCircle,
} from "lucide-react";

// スタッフモーダルとカスタムダイアログ
import { StaffFormModal } from "@/components/staff/StaffFormModal";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";

function StaffManagementContent() {
  const { circleId } = useAuth();
  const queryClient = useQueryClient();
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  
  // モーダル用ステート
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);

  // 削除確認用ステート
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null);

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

  // スタッフ一覧取得
  const {
    data: staffList,
    isLoading,
  } = useQuery({
    queryKey: ["staff", circleId],
    queryFn: () => staffApi.list(circleId!),
    enabled: !!circleId,
  });

  // 現在シフト中のスタッフ取得
  const { data: currentShiftStaff } = useQuery({
    queryKey: ["staff", "current-shift", circleId],
    queryFn: () => staffApi.getCurrentShift(circleId!),
    enabled: !!circleId,
    refetchInterval: 60000,
  });

  // スタッフ削除
  const deleteStaff = useMutation({
    mutationFn: (id: string) => staffApi.delete(id),
    onSuccess: () => {
      toast.success("スタッフを削除しました");
      queryClient.invalidateQueries({ queryKey: ["staff", circleId] });
      setIsDeleteConfirmOpen(false);
      setStaffToDelete(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "削除に失敗しました");
    },
  });

  const handleOpenAdd = () => {
    setSelectedStaff(null);
    setIsStaffModalOpen(true);
  };

  const handleOpenEdit = (staff: Staff) => {
    setSelectedStaff(staff);
    setIsStaffModalOpen(true);
  };

  const handleOpenDelete = (staff: Staff) => {
    setStaffToDelete(staff);
    setIsDeleteConfirmOpen(true);
  };

  // 表示用の日時フォーマット
  const formatDateTime = (date: string | Date | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // シフト中かどうかの判定
  const isOnShift = (staff: Staff) => {
    if (!staff.shiftStart || !staff.shiftEnd) return false;
    const now = new Date();
    return new Date(staff.shiftStart) <= now && now <= new Date(staff.shiftEnd);
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

  return (
    <DashboardLayout title={circleName} subtitle="スタッフ管理" type="circle">
      <div className="space-y-6 font-mono text-foreground">
        <div className="flex justify-between items-center border-b-thick border-border pb-3">
          <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
            <Users className="h-4 w-4" />
            スタッフ一覧
          </h2>
          <PermissionGuard permission="staff:write">
            <Button onClick={handleOpenAdd} className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold uppercase shadow-none px-3">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              スタッフを追加
            </Button>
          </PermissionGuard>
        </div>

        {/* 現在シフト中のスタッフ */}
        <Card className=" rounded-none bg-background shadow-none">
          <CardHeader className="p-4 pb-2 border-b-thin border-border bg-muted/20">
            <CardTitle className="flex items-center gap-2 text-xs uppercase font-bold">
              <Clock className="h-4 w-4 text-green-500" />
              現在シフト中
            </CardTitle>
            <CardDescription className="text-[10px]">現在勤務中のスタッフ一覧</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-4">
            {currentShiftStaff && currentShiftStaff.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {currentShiftStaff.map((staff) => (
                  <Badge
                    key={staff.id}
                    variant="default"
                    className="text-[10px] py-1 px-3 gap-1 rounded-none font-bold border-thick border-border"
                  >
                    <CheckCircle className="h-3 w-3" />
                    {staff.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs font-mono">
                現在シフト中のスタッフはいません
              </p>
            )}
          </CardContent>
        </Card>

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
                    className={`flex items-center justify-between p-3 text-xs font-mono ${
                      isOnShift(staff)
                        ? "bg-green-50/10 border-l-thick border-l-green-500"
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-none bg-primary/10 flex items-center justify-center border-thick border-border">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-foreground">{staff.name}</p>
                          {isOnShift(staff) && (
                            <Badge variant="default" className="text-[8px] font-mono rounded-none px-1.5 py-0 border-thin border-border">
                              シフト中
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDateTime(staff.shiftStart)} 〜{" "}
                            {formatDateTime(staff.shiftEnd)}
                          </span>
                        </div>
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

      {/* 削除確認カスタムダイアログ */}
      <ConfirmationDialog
        isOpen={isDeleteConfirmOpen}
        title="[確認: スタッフの削除]"
        description={`本当にスタッフ「${staffToDelete?.name}」さんを削除しますか？この操作は取り消せません。`}
        onConfirm={() => staffToDelete && deleteStaff.mutate(staffToDelete.id)}
        onDiscard={() => setIsDeleteConfirmOpen(false)}
        onCancel={() => setIsDeleteConfirmOpen(false)}
      />
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

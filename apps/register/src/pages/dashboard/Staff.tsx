
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleAuthGuard,
  PermissionGuard,
  useAuth,
} from "@/hooks/useCircleAuth";
import { staffApi } from "@/lib/api";
import type { Staff } from "@/lib/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Clock,
  User,
  Users,
  Calendar,
  CheckCircle,
} from "lucide-react";

function StaffManagementContent() {
  const { circleId } = useAuth();
  const queryClient = useQueryClient();
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  // フォーム状態
  const [staffForm, setStaffForm] = useState({
    name: "",
    shiftStart: "",
    shiftEnd: "",
  });

  // スタッフ一覧取得
  const {
    data: staffList,
    isLoading,
    refetch,
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
    refetchInterval: 60000, // 1分ごとに更新
  });

  // スタッフ作成
  const createStaff = useMutation({
    mutationFn: async (input: { circleId: string; name: string }) => {
      return await staffApi.create(input);
    },
    onSuccess: () => {
      toast.success("スタッフを追加しました");
      resetForm();
      refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || "追加に失敗しました");
    },
  });

  // スタッフ更新
  const updateStaff = useMutation({
    mutationFn: async (input: { id: string; name?: string }) => {
      const { id, ...data } = input;
      return await staffApi.update(id, data);
    },
    onSuccess: () => {
      toast.success("スタッフ情報を更新しました");
      resetForm();
      refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || "更新に失敗しました");
    },
  });

  // スタッフ削除
  const deleteStaff = useMutation({
    mutationFn: async (input: { id: string }) => {
      return await staffApi.delete(input.id);
    },
    onSuccess: () => {
      toast.success("スタッフを削除しました");
      refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message || "削除に失敗しました");
    },
  });

  const resetForm = () => {
    setStaffForm({ name: "", shiftStart: "", shiftEnd: "" });
    setIsAddingStaff(false);
    setEditingStaffId(null);
  };

  const handleSave = () => {
    if (!circleId) return;

    if (editingStaffId) {
      updateStaff.mutate({
        id: editingStaffId,
        name: staffForm.name || undefined,
      });
    } else {
      createStaff.mutate({
        circleId,
        name: staffForm.name,
      });
    }
  };

  const handleEdit = (staff: Staff) => {
    setStaffForm({
      name: staff.name,
      shiftStart: staff.shiftStart
        ? formatDateTimeLocal(new Date(staff.shiftStart))
        : "",
      shiftEnd: staff.shiftEnd
        ? formatDateTimeLocal(new Date(staff.shiftEnd))
        : "",
    });
    setEditingStaffId(staff.id);
    setIsAddingStaff(true);
  };

  const handleDelete = (staff: Staff) => {
    if (confirm(`「${staff.name}」さんを削除しますか？`)) {
      deleteStaff.mutate({ id: staff.id });
    }
  };

  // datetime-local用のフォーマット
  const formatDateTimeLocal = (date: Date) => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
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
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8" />
            スタッフ管理
          </h1>
          <p className="text-muted-foreground">スタッフの追加とシフト管理</p>
        </div>
        <PermissionGuard permission="staff:write">
          <Button onClick={() => setIsAddingStaff(true)}>
            <Plus className="mr-2 h-4 w-4" />
            スタッフを追加
          </Button>
        </PermissionGuard>
      </div>

      {/* 現在シフト中のスタッフ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-green-500" />
            現在シフト中
          </CardTitle>
          <CardDescription>現在勤務中のスタッフ一覧</CardDescription>
        </CardHeader>
        <CardContent>
          {currentShiftStaff && currentShiftStaff.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {currentShiftStaff.map((staff) => (
                <Badge
                  key={staff.id}
                  variant="default"
                  className="text-sm py-1 px-3 gap-1"
                >
                  <CheckCircle className="h-3 w-3" />
                  {staff.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              現在シフト中のスタッフはいません
            </p>
          )}
        </CardContent>
      </Card>

      {/* スタッフ追加/編集フォーム */}
      {isAddingStaff && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingStaffId ? "スタッフ情報を編集" : "新しいスタッフを追加"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="staffName">名前 *</Label>
                <Input
                  id="staffName"
                  value={staffForm.name}
                  onChange={(e) =>
                    setStaffForm({ ...staffForm, name: e.target.value })
                  }
                  placeholder="山田 太郎"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shiftStart">シフト開始</Label>
                <Input
                  id="shiftStart"
                  type="datetime-local"
                  value={staffForm.shiftStart}
                  onChange={(e) =>
                    setStaffForm({ ...staffForm, shiftStart: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shiftEnd">シフト終了</Label>
                <Input
                  id="shiftEnd"
                  type="datetime-local"
                  value={staffForm.shiftEnd}
                  onChange={(e) =>
                    setStaffForm({ ...staffForm, shiftEnd: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetForm}>
                <X className="mr-2 h-4 w-4" />
                キャンセル
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  !staffForm.name ||
                  createStaff.isPending ||
                  updateStaff.isPending
                }
              >
                <Save className="mr-2 h-4 w-4" />
                {editingStaffId ? "更新" : "追加"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* スタッフ一覧 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            スタッフ一覧
          </CardTitle>
          <CardDescription>
            {staffList?.length || 0}人のスタッフが登録されています
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staffList && staffList.length > 0 ? (
            <div className="space-y-3">
              {staffList.map((staff) => (
                <div
                  key={staff.id}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    isOnShift(staff)
                      ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{staff.name}</p>
                        {isOnShift(staff) && (
                          <Badge variant="default" className="text-xs">
                            シフト中
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDateTime(staff.shiftStart)} 〜{" "}
                          {formatDateTime(staff.shiftEnd)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <PermissionGuard permission="staff:write">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(staff)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <PermissionGuard permission="staff:delete">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(staff)}
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
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>まだスタッフが登録されていません</p>
              <p className="text-sm">
                上のボタンからスタッフを追加してください
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function StaffManagementPage() {
  return (
    <CircleAuthGuard>
      <PermissionGuard
        permission="staff:read"
        fallback={
          <div className="container mx-auto p-6">
            <Card>
              <CardContent className="py-8 text-center">
                <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium">アクセス権限がありません</p>
                <p className="text-muted-foreground">
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

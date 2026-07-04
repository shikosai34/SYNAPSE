
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
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);

  // フォーム状態
  const [staffForm, setStaffForm] = useState({
    name: "",
    shiftStart: "",
    shiftEnd: "",
  });

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
      <div className="space-y-6">
        <div className="flex justify-between items-center border-b-[1px] border-border pb-3">
          <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
            <Users className="h-4 w-4" />
            スタッフ一覧
          </h2>
          <PermissionGuard permission="staff:write">
            <Button onClick={() => setIsAddingStaff(true)} className="rounded-none border-[1px] border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold shadow-none px-3">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              スタッフを追加
            </Button>
          </PermissionGuard>
        </div>

        {/* 現在シフト中のスタッフ */}
        <Card className="border-[1px] border-border rounded-none shadow-none">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-xs uppercase font-bold">
              <Clock className="h-4 w-4 text-green-500" />
              現在シフト中
            </CardTitle>
            <CardDescription className="text-[10px]">現在勤務中のスタッフ一覧</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {currentShiftStaff && currentShiftStaff.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {currentShiftStaff.map((staff) => (
                  <Badge
                    key={staff.id}
                    variant="default"
                    className="text-[10px] py-1 px-3 gap-1 rounded-none font-bold"
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

        {/* スタッフ追加/編集フォーム */}
        {isAddingStaff && (
          <Card className="border-thick border-border rounded-none shadow-none p-2">
            <CardHeader className="pb-3 border-b-thick border-border">
              <CardTitle className="text-xs uppercase font-bold tracking-wider">
                {editingStaffId ? "[スタッフ情報を編集]" : "[新しいスタッフを追加]"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="staffName" className="text-[10px] font-bold uppercase">名前 *</Label>
                  <Input
                    id="staffName"
                    value={staffForm.name}
                    onChange={(e) =>
                      setStaffForm({ ...staffForm, name: e.target.value })
                    }
                    placeholder="山田 太郎"
                    className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shiftStart" className="text-[10px] font-bold uppercase">シフト開始</Label>
                  <Input
                    id="shiftStart"
                    type="datetime-local"
                    value={staffForm.shiftStart}
                    onChange={(e) =>
                      setStaffForm({ ...staffForm, shiftStart: e.target.value })
                    }
                    className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="shiftEnd" className="text-[10px] font-bold uppercase">シフト終了</Label>
                  <Input
                    id="shiftEnd"
                    type="datetime-local"
                    value={staffForm.shiftEnd}
                    onChange={(e) =>
                      setStaffForm({ ...staffForm, shiftEnd: e.target.value })
                    }
                    className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={resetForm} className="border-thick border-border rounded-none h-8 text-[11px] font-bold hover:bg-neutral-100 px-3">
                  <X className="mr-1.5 h-4 w-4" />
                  キャンセル
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={
                    !staffForm.name ||
                    createStaff.isPending ||
                    updateStaff.isPending
                  }
                  className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold rounded-none shadow-none px-3"
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  {editingStaffId ? "更新" : "追加"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* スタッフ一覧 */}
        <Card className="border-thick border-border rounded-none shadow-none">
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
                        ? "bg-green-50/30 dark:bg-green-950/10 border-l-[3px] border-l-green-500"
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
                            <Badge variant="default" className="text-[8px] font-mono rounded-none px-1.5 py-0">
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
                          onClick={() => handleEdit(staff)}
                          className="h-8 w-8 rounded-none"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <PermissionGuard permission="staff:delete">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive h-8 w-8 rounded-none"
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
              <div className="text-center py-12 text-muted-foreground font-mono">
                <Users className="h-10 w-10 mx-auto mb-4 opacity-50 text-foreground" />
                <p className="text-xs font-bold uppercase tracking-wider">登録スタッフはいません</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
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
            <Card className="border-[1px] border-border rounded-none shadow-none">
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

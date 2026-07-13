import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { circleApi } from "@/lib/api";
import { Card, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Building2, Plus, Edit, Trash2, Users, Settings2 } from "lucide-react";
import { toast } from "sonner";

// モーダル
import { CircleFormModal } from "./CircleFormModal";
import { CircleManageModal } from "./CircleManageModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface CirclesTabProps {
  eventId: string;
  circles: any[] | undefined;
  circlesLoading: boolean;
  /** サークル一覧取得の isError (省略時はエラー分岐を表示しない) */
  circlesError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function CirclesTab({
  eventId,
  circles,
  circlesLoading,
  circlesError,
  error,
  onRetry,
}: CirclesTabProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState<any | null>(null);

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [circleToDelete, setCircleToDelete] = useState<any | null>(null);

  // サークル運営管理 (拡張機能ON/OFF + メンバーのロール)
  const [manageCircle, setManageCircle] = useState<any | null>(null);

  // サークル削除 API
  const deleteCircleMutation = useMutation({
    mutationFn: (id: string) => circleApi.delete(id),
    onSuccess: () => {
      toast.success("サークルを削除しました");
      queryClient.invalidateQueries({ queryKey: ["circles", eventId] });
      setIsDeleteOpen(false);
      setCircleToDelete(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "削除に失敗しました");
    },
  });

  const handleOpenAdd = () => {
    setSelectedCircle(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (circle: any) => {
    setSelectedCircle(circle);
    setIsFormOpen(true);
  };

  const handleOpenDelete = (circle: any) => {
    setCircleToDelete(circle);
    setIsDeleteOpen(true);
  };

  // サークル管理画面へ切り替え
  const handleSwitchToCircle = (circle: any) => {
    const authStored = localStorage.getItem("circleAuth");
    if (authStored) {
      try {
        const authInfo = JSON.parse(authStored);
        localStorage.setItem(
          "circleAuth",
          JSON.stringify({
            ...authInfo,
            circleId: circle.id,
            circleName: circle.name,
            role: "circle_manager",
          })
        );
        localStorage.setItem("circleId", circle.id);
        toast.success(`「${circle.name}」のダッシュボードに切り替えました`);
        navigate("/circle/dashboard");
      } catch (_) {}
    }
  };

  return (
    <div className="space-y-6 font-mono text-foreground">
      <div className="flex justify-between items-center border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          サークル一覧 ({circles?.length || 0})
        </h2>
        <Button
          onClick={handleOpenAdd}
          className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] uppercase font-bold transition-all shadow-none px-3"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          新規追加
        </Button>
      </div>

      {circlesLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : circlesError ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : circles && circles.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {circles.map((cir) => (
            <Card
              key={cir.id}
              className="border-thick border-border rounded-none bg-background flex flex-col justify-between shadow-none hover:border-neutral-800 transition-all p-3"
            >
              <div>
                <div className="flex justify-between items-start border-b-thin border-border pb-2 mb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 truncate max-w-[80%]">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {cir.name}
                  </CardTitle>
                  <div className="flex gap-1 shrink-0">
                    <button
                      className="p-0.5 text-muted-foreground hover:text-primary transition-all rounded-none cursor-pointer border-thick border-transparent hover:border-border hover:bg-muted"
                      onClick={() => handleOpenEdit(cir)}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="p-0.5 text-destructive hover:text-neutral-800 transition-all rounded-none cursor-pointer border-thick border-transparent hover:border-border hover:bg-muted"
                      onClick={() => handleOpenDelete(cir)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {cir.description && (
                  <p className="text-[10px] text-muted-foreground truncate mb-3">{cir.description}</p>
                )}
                <div className="text-[10px] text-muted-foreground space-y-1 font-mono mb-4">
                  {/* 2026-07-07 (Phase 3b): サークル作成がセルフサービス化されたため
                      「代表者」= 作成時に circle_manager になったユーザーを表示する
                      (PIN/管理者代理作成の概念は廃止)。 */}
                  <p>管理者: {cir.managerName || "未設定"}</p>
                  {cir.managerEmail && <p className="truncate">メール: {cir.managerEmail}</p>}
                  <p className="opacity-50 text-[8px]">ID: {cir.id}</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-thick border-border hover:bg-neutral-100 rounded-none uppercase font-bold tracking-wider text-[10px] h-8 shadow-none"
                  onClick={() => setManageCircle(cir)}
                >
                  <Settings2 className="h-3.5 w-3.5 mr-1" /> 運営
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 border-thick border-border hover:bg-neutral-100 rounded-none uppercase font-bold tracking-wider text-[10px] h-8 shadow-none"
                  onClick={() => handleSwitchToCircle(cir)}
                >
                  管理へ切替
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          message="サークルが登録されていません"
          actionLabel="新規追加"
          onAction={handleOpenAdd}
        />
      )}

      {/* サークル追加・編集モーダル */}
      <CircleFormModal
        eventId={eventId}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        circle={selectedCircle}
      />

      {/* サークル運営管理モーダル (拡張機能ON/OFF + ロール調整) */}
      <CircleManageModal
        circle={manageCircle}
        isOpen={!!manageCircle}
        onClose={() => setManageCircle(null)}
      />

      {/* 削除確認ダイアログ (破壊的操作のため ConfirmDialog を使用) */}
      <ConfirmDialog
        isOpen={isDeleteOpen}
        title="[確認: サークルの削除]"
        description={`本当にサークル「${circleToDelete?.name}」を削除してよろしいですか？この操作はサークルに紐づくメニューや売上データもすべて削除されます。`}
        confirmLabel="削除する"
        isPending={deleteCircleMutation.isPending}
        onConfirm={() => circleToDelete && deleteCircleMutation.mutate(circleToDelete.id)}
        onCancel={() => setIsDeleteOpen(false)}
      />
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { circleApi, activeWaitTimeReport, recentWaitTimeReports } from "@/lib/api";
import { Card, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Building2, Plus, Edit, Trash2, Users, Settings2, Link2 } from "lucide-react";
import { toast } from "sonner";

// モーダル
import { CircleFormModal } from "./CircleFormModal";
import { CircleCreateLinkModal } from "./CircleCreateLinkModal";
import { CircleManageModal } from "./CircleManageModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getAuthInfo, saveAuthInfo, useAuth } from "@/hooks/useCircleAuth";

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
  const { role: effectiveRole, eventId: effectiveEventId } = useAuth();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState<any | null>(null);
  const [isCreateLinkOpen, setIsCreateLinkOpen] = useState(false);

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
    const authInfo = getAuthInfo();
    if (!authInfo || effectiveRole !== "event_manager" || effectiveEventId !== eventId) return;
    // 2026-09-27: タブ別の選択を保ち、権限の正本は実際のイベント所属または監査付きの実効権限に維持する。
    saveAuthInfo({ ...authInfo, circleId: circle.id, circleName: circle.name, eventId });
    void queryClient.invalidateQueries({ queryKey: ["circle", circle.id] });
    toast.success(`「${circle.name}」のダッシュボードに切り替えました`);
    navigate("/circle/dashboard");
  };

  const uniqueCircles = circles
    ? Array.from(new Map(circles.map(c => [c.id, c])).values())
    : undefined;

  return (
    <div className="space-y-6 font-mono text-foreground">
      <div className="flex flex-col items-start gap-3 border-b-thick border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          サークル一覧 ({uniqueCircles?.length || 0})
        </h2>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button
            onClick={() => setIsCreateLinkOpen(true)}
            variant="outline"
            className="w-full rounded-none border-thick h-8 text-[11px] uppercase font-bold transition-all shadow-none px-3 sm:w-auto"
          >
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            サークル作成リンクを作成
          </Button>
          <Button
            onClick={handleOpenAdd}
            className="w-full rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] uppercase font-bold transition-all shadow-none px-3 sm:w-auto"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            新規追加
          </Button>
        </div>
      </div>

      {circlesLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : circlesError ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : uniqueCircles && uniqueCircles.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {uniqueCircles.map((cir) => (
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
                {(() => {
                  const report = activeWaitTimeReport(cir.settings);
                  return <p className="mb-3 text-[10px] font-bold">待ち時間: {report ? `約${report.minutes}分（${report.minutesAgo}分前）` : "未報告"}</p>;
                })()}
                {(() => {
                  // 2026-10-07 (#9): 中央から直近の待ち時間と平均を見て、報告値の変化を把握できるようにする。
                  const reports = recentWaitTimeReports(cir.settings);
                  if (reports.length === 0) return null;
                  const average = Math.round(reports.reduce((sum, item) => sum + item.minutes, 0) / reports.length);
                  const maxMinutes = Math.max(10, ...reports.map((item) => item.minutes));
                  return (
                    <div className="mb-4" aria-label="待ち時間の推移">
                      <div className="mb-1 flex items-center justify-between text-[9px] text-muted-foreground">
                        <span>直近 {reports.length} 回の推移</span>
                        <span>平均 約{average}分</span>
                      </div>
                      <div className="flex h-12 items-end gap-1" role="img" aria-label={`直近${reports.length}回の待ち時間: ${reports.map((item) => `${item.minutes}分`).join("、")}`}>
                        {reports.map((item) => {
                          const height = Math.max(3, Math.round((item.minutes / maxMinutes) * 24));
                          const reportedDate = new Date(item.reportedAt);
                          const timeLabel = reportedDate.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
                          return (
                            <div key={item.reportedAt} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5" title={`${reportedDate.toLocaleString("ja-JP")} · 約${item.minutes}分`}>
                              <span className="text-[8px] tabular-nums">{item.minutes}</span>
                              <div className="w-full bg-info/70" style={{ height: `${height}px` }} />
                              <span className="text-[8px] text-muted-foreground">{timeLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
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

      <CircleCreateLinkModal
        eventId={eventId}
        isOpen={isCreateLinkOpen}
        onClose={() => setIsCreateLinkOpen(false)}
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

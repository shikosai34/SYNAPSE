import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventApi } from "@/lib/api";
import { SystemAdminGuard } from "@/hooks/useCircleAuth";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { FormField, FormSubmitButton } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Plus,
  Calendar,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [showEventForm, setShowEventForm] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("events");
  // イベント削除の確認ダイアログ用
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  // イベントフォーム
  const [eventForm, setEventForm] = useState({
    eventName: "",
    description: "",
    startDate: "",
    endDate: "",
  });

  // イベント一覧取得
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["events"],
    queryFn: () => eventApi.list(),
  });

  // イベント作成
  const createEventMutation = useMutation({
    mutationFn: async (input: {
      eventName: string;
      description?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      return await eventApi.create(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success("イベントを作成しました");
      setShowEventForm(false);
      setEventForm({
        eventName: "",
        description: "",
        startDate: "",
        endDate: "",
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "イベント作成に失敗しました");
    },
  });

  // イベント削除 (論理削除)
  const deleteEventMutation = useMutation({
    mutationFn: (id: string) => eventApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      toast.success("イベントを削除しました");
      setPendingDelete(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "イベント削除に失敗しました");
      setPendingDelete(null);
    },
  });

  const handleCreateEvent = () => {
    createEventMutation.mutate({
      eventName: eventForm.eventName,
      description: eventForm.description || undefined,
      startDate: eventForm.startDate || undefined,
      endDate: eventForm.endDate || undefined,
    });
  };

  return (
    <SystemAdminGuard>
      <DashboardLayout
        title="SYSTEM ADMIN"
        subtitle="システム管理コンソール"
        type="system"
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        <div className="space-y-6">
          {/* アクションバー */}
          <div className="flex justify-between items-center border-b-thin border-border pb-3">
            <h2 className="text-sm font-bold flex items-center gap-2 uppercase tracking-wider">
              <Calendar className="h-4 w-4" />
              イベント一覧 ({events?.length || 0})
            </h2>
            <Button
              onClick={() => setShowEventForm(true)}
              className="rounded-none border-thin border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] uppercase font-bold transition-all shadow-none px-3"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新規イベント開設
            </Button>
          </div>

          {/* イベント作成モーダル */}
          <Modal
            isOpen={showEventForm}
            onClose={() => setShowEventForm(false)}
            title="[新規イベント作成]"
            subtitle="新しい学園祭イベントを開設します。"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                id="eventName"
                label="イベント名"
                required
                placeholder="例: 茨香祭 2026"
                value={eventForm.eventName}
                onChange={(e) => setEventForm({ ...eventForm, eventName: e.target.value })}
              />
              <FormField
                id="eventDescription"
                label="説明"
                placeholder="第34回 茨香祭 など"
                value={eventForm.description}
                onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
              />
              <FormField
                id="startDate"
                label="開始日"
                type="date"
                value={eventForm.startDate}
                onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value })}
              />
              <FormField
                id="endDate"
                label="終了日"
                type="date"
                value={eventForm.endDate}
                onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })}
              />
            </div>

            <FormSubmitButton
              onClick={handleCreateEvent}
              disabled={!eventForm.eventName}
              isPending={createEventMutation.isPending}
              icon={Plus}
            >
              イベントを開設
            </FormSubmitButton>
          </Modal>

          {/* イベント一覧グリッド */}
          {eventsLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          ) : events && events.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {events.map((evt) => (
                <Card
                  key={evt.id}
                  className="border-thin border-border hover:border-neutral-800 rounded-none bg-background flex flex-col justify-between shadow-none transition-all p-3"
                >
                  <CardHeader className="p-0 border-b-thin border-muted pb-2 mb-2">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 min-w-0">
                        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{evt.eventName}</span>
                      </CardTitle>
                      <button
                        className="p-0.5 text-destructive hover:text-neutral-800 transition-all rounded-none cursor-pointer border-thick border-transparent hover:border-border hover:bg-muted shrink-0"
                        title="イベントを削除"
                        onClick={() => setPendingDelete({ id: evt.id, name: evt.eventName })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {evt.description && (
                      <CardDescription className="text-[10px] text-muted-foreground truncate">{evt.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="p-0 pt-2 space-y-2">
                    <div className="text-[10px] text-muted-foreground space-y-1 font-mono">
                      {evt.startDate && (
                        <p>開始: {new Date(evt.startDate).toLocaleDateString("ja-JP")}</p>
                      )}
                      {evt.endDate && (
                        <p>終了: {new Date(evt.endDate).toLocaleDateString("ja-JP")}</p>
                      )}
                      <p className="opacity-50 text-[8px]">ID: {evt.id}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Calendar}
              message="イベントがありません"
              actionLabel="新規イベント開設"
              onAction={() => setShowEventForm(true)}
            />
          )}
        </div>

        <ConfirmDialog
          isOpen={!!pendingDelete}
          title="[確認: イベントの削除]"
          description={`イベント「${pendingDelete?.name ?? ""}」を削除しますか？イベント一覧から非表示になります (論理削除)。`}
          confirmLabel="削除する"
          onConfirm={() => {
            if (pendingDelete) deleteEventMutation.mutate(pendingDelete.id);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      </DashboardLayout>
    </SystemAdminGuard>
  );
}

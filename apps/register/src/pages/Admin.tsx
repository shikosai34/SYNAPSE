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
import {
  Plus,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [showEventForm, setShowEventForm] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("events");

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
            <div className="text-center py-12 text-muted-foreground text-xs uppercase tracking-wider">Loading...</div>
          ) : events && events.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {events.map((evt) => (
                <Card
                  key={evt.id}
                  className="border-thin border-border hover:border-neutral-800 rounded-none bg-background flex flex-col justify-between shadow-none transition-all p-3"
                >
                  <CardHeader className="p-0 border-b-thin border-muted pb-2 mb-2">
                    <CardTitle className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {evt.eventName}
                    </CardTitle>
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
            <Card className="border-thin border-dashed border-border rounded-none p-12 text-center text-muted-foreground bg-background shadow-none">
              <Calendar className="h-8 w-8 mx-auto mb-4 opacity-40 text-foreground" />
              <p className="text-xs uppercase tracking-widest font-bold font-headline">イベントがありません</p>
            </Card>
          )}
        </div>
      </DashboardLayout>
    </SystemAdminGuard>
  );
}

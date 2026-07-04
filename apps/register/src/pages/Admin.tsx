import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventApi } from "@/lib/api";
import { SystemAdminGuard } from "@/hooks/useCircleAuth";
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
import {
  Plus,
  Calendar,
  Shield,
} from "lucide-react";
import { toast } from "sonner";

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [showEventForm, setShowEventForm] = useState(false);

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
      <div className="container mx-auto p-6 space-y-8 font-mono bg-background text-foreground max-w-7xl">
        {/* ヘッダーセクション */}
        <div className="flex items-center justify-between border-b-[1px] border-neutral-200 pb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-headline font-black uppercase tracking-tight flex items-center gap-2">
              <Shield className="h-6 w-6 text-foreground" />
              [SYSTEM ADMIN]
            </h1>
            <p className="text-xs text-muted-foreground mt-1">学園祭イベント一覧の管理と新規イベント開設</p>
          </div>
        </div>

        {/* アクションバー */}
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-wider">
            <Calendar className="h-4 w-4" />
            イベント一覧
          </h2>
          <Button
            onClick={() => setShowEventForm(!showEventForm)}
            className="rounded-none border-[1px] border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs uppercase font-bold transition-all shadow-none"
          >
            <Plus className="mr-2 h-4 w-4" />
            新規イベント開設
          </Button>
        </div>

        {/* イベント作成フォーム (1px ボーダー, シャープエッジ, フラットカラー) */}
        {showEventForm && (
          <Card className="border-[1px] border-neutral-200 rounded-none bg-background shadow-none p-2">
            <CardHeader className="border-b-[1px] border-neutral-100 pb-3">
              <CardTitle className="text-sm uppercase font-bold tracking-wider">[新規イベント作成]</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">新しい学園祭イベントを開設します。</CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="eventName" className="text-xs font-bold uppercase">イベント名 *</Label>
                  <Input
                    id="eventName"
                    placeholder="例: 茨香祭 2026"
                    className="border-[1px] border-neutral-300 rounded-none focus-visible:ring-0 h-9 text-sm focus:border-neutral-900 bg-background"
                    value={eventForm.eventName}
                    onChange={(e) =>
                      setEventForm({
                        ...eventForm,
                        eventName: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eventDescription" className="text-xs font-bold uppercase">説明</Label>
                  <Input
                    id="eventDescription"
                    placeholder="第34回 茨香祭 など"
                    className="border-[1px] border-neutral-300 rounded-none focus-visible:ring-0 h-9 text-sm focus:border-neutral-900 bg-background"
                    value={eventForm.description}
                    onChange={(e) =>
                      setEventForm({
                        ...eventForm,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startDate" className="text-xs font-bold uppercase">開始日</Label>
                  <Input
                    id="startDate"
                    type="date"
                    className="border-[1px] border-neutral-300 rounded-none focus-visible:ring-0 h-9 text-sm focus:border-neutral-900 bg-background"
                    value={eventForm.startDate}
                    onChange={(e) =>
                      setEventForm({
                        ...eventForm,
                        startDate: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate" className="text-xs font-bold uppercase">終了日</Label>
                  <Input
                    id="endDate"
                    type="date"
                    className="border-[1px] border-neutral-300 rounded-none focus-visible:ring-0 h-9 text-sm focus:border-neutral-900 bg-background"
                    value={eventForm.endDate}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, endDate: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  className="border-[1px] border-neutral-300 rounded-none h-9 text-xs font-bold hover:bg-neutral-100"
                  onClick={() => setShowEventForm(false)}
                >
                  キャンセル
                </Button>
                <Button
                  onClick={handleCreateEvent}
                  disabled={!eventForm.eventName || createEventMutation.isPending}
                  className="border-[1px] border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold rounded-none transition-all shadow-none"
                >
                  {createEventMutation.isPending ? "作成中..." : "イベントを開設"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* イベント一覧グリッド (StudioBlank デザインルール準拠のフラットスタイル) */}
        {eventsLoading ? (
          <div className="text-center py-12 text-muted-foreground text-xs uppercase tracking-wider">Loading...</div>
        ) : events && events.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {events.map((evt) => (
              <Card
                key={evt.id}
                className="border-[1px] border-neutral-200 hover:border-neutral-800 rounded-none bg-background flex flex-col justify-between shadow-none transition-all p-2"
              >
                <CardHeader className="border-b-[1px] border-neutral-100 p-4 pb-3">
                  <CardTitle className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                    <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {evt.eventName}
                  </CardTitle>
                  {evt.description && (
                    <CardDescription className="text-xs text-muted-foreground truncate">{evt.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="p-4 pt-3 space-y-3">
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    {evt.startDate && (
                      <p>開始: {new Date(evt.startDate).toLocaleDateString("ja-JP")}</p>
                    )}
                    {evt.endDate && (
                      <p>終了: {new Date(evt.endDate).toLocaleDateString("ja-JP")}</p>
                    )}
                    <p className="text-[9px] font-mono text-muted-foreground/60 pt-1">ID: {evt.id}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-[1px] border-dashed border-neutral-300 rounded-none p-12 text-center text-muted-foreground bg-background shadow-none">
            <Calendar className="h-8 w-8 mx-auto mb-4 opacity-40 text-foreground" />
            <p className="text-xs uppercase tracking-widest font-bold">No active events found.</p>
            <p className="text-[11px] text-muted-foreground mt-1">新規イベントを作成してください。</p>
          </Card>
        )}
      </div>
    </SystemAdminGuard>
  );
}

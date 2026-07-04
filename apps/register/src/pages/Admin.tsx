
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventApi, circleApi } from "@/lib/api";
import { AdminAuthGuard } from "@/hooks/useCircleAuth";
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
import {
  Plus,
  Calendar,
  Users,
  Trash2,
  Building2,
  Shield,
  Eye,
  EyeOff,
  Edit,
} from "lucide-react";
import { toast } from "sonner";
import Link from "@/components/link";

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [showEventForm, setShowEventForm] = useState(false);
  const [showCircleForm, setShowCircleForm] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // イベントフォーム
  const [eventForm, setEventForm] = useState({
    eventName: "",
    description: "",
    startDate: "",
    endDate: "",
  });

  // サークルフォーム
  const [circleForm, setCircleForm] = useState({
    name: "",
    description: "",
    managerPin: "",
    managerEmail: "",
    managerName: "",
  });

  // サークル編集フォーム
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingCircleId, setEditingCircleId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    managerPin: "",
    managerEmail: "",
    managerName: "",
  });

  // イベント一覧取得
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["events"],
    queryFn: () => eventApi.list(),
  });

  // サークル一覧取得（選択したイベント）
  const { data: circles, isLoading: circlesLoading } = useQuery({
    queryKey: ["circles", selectedEventId],
    queryFn: () => circleApi.list(selectedEventId!),
    enabled: !!selectedEventId,
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

  // サークル作成
  const createCircleMutation = useMutation({
    mutationFn: async (input: {
      eventId: string;
      name: string;
      managerPin?: string;
      description?: string;
      managerEmail: string;
      managerName?: string;
    }) => {
      return await circleApi.create(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      toast.success("サークルを作成しました");
      setShowCircleForm(false);
      setCircleForm({
        name: "",
        description: "",
        managerPin: "",
        managerEmail: "",
        managerName: "",
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "サークル作成に失敗しました");
    },
  });

  // サークル更新
  const updateCircleMutation = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      description?: string;
      managerPin?: string;
      managerEmail?: string;
      managerName?: string;
    }) => {
      const { id, ...data } = input;
      return await circleApi.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      toast.success("サークル情報を更新しました");
      setShowEditForm(false);
      setEditingCircleId(null);
      setEditForm({
        name: "",
        description: "",
        managerPin: "",
        managerEmail: "",
        managerName: "",
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || "サークル更新に失敗しました");
    },
  });

  // サークル削除
  const deleteCircleMutation = useMutation({
    mutationFn: async (input: { id: string }) => {
      return await circleApi.delete(input.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles"] });
      toast.success("サークルを削除しました");
    },
    onError: (error: Error) => {
      toast.error(error.message || "サークル削除に失敗しました");
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

  const handleCreateCircle = () => {
    if (!selectedEventId) {
      toast.error("イベントを選択してください");
      return;
    }
    createCircleMutation.mutate({
      eventId: selectedEventId,
      name: circleForm.name,
      managerPin: circleForm.managerPin || undefined,
      description: circleForm.description || undefined,
      managerEmail: circleForm.managerEmail,
      managerName: circleForm.managerName || undefined,
    });
  };

  const handleEditCircle = () => {
    if (!editingCircleId) return;
    updateCircleMutation.mutate({
      id: editingCircleId,
      name: editForm.name,
      description: editForm.description || undefined,
      managerPin: editForm.managerPin || undefined,
      managerEmail: editForm.managerEmail,
      managerName: editForm.managerName || undefined,
    });
  };

  return (
    <AdminAuthGuard>
      <div className="container mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
            <Shield className="h-10 w-10" />
            管理者ダッシュボード
          </h1>
          <p className="text-muted-foreground">イベントとサークルの管理</p>
        </div>
        <Link href="/">
          <Button variant="outline">ホームに戻る</Button>
        </Link>
      </div>

      {/* イベント管理セクション */}
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold flex items-center gap-2">
            <Calendar className="h-6 w-6" />
            イベント選択
          </h2>
          <Button onClick={() => setShowEventForm(!showEventForm)}>
            <Plus className="mr-2 h-4 w-4" />
            新規イベント
          </Button>
        </div>

        {/* イベント作成フォーム */}
        {showEventForm && (
          <Card>
            <CardHeader>
              <CardTitle>新規イベント作成</CardTitle>
              <CardDescription>
                新しいイベント（文化祭など）を作成します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="eventName">イベント名 *</Label>
                  <Input
                    id="eventName"
                    placeholder="例: 茨香祭2025"
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
                  <Label htmlFor="eventDescription">説明</Label>
                  <Input
                    id="eventDescription"
                    placeholder="イベントの説明"
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
                  <Label htmlFor="startDate">開始日</Label>
                  <Input
                    id="startDate"
                    type="date"
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
                  <Label htmlFor="endDate">終了日</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={eventForm.endDate}
                    onChange={(e) =>
                      setEventForm({ ...eventForm, endDate: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowEventForm(false)}
                >
                  キャンセル
                </Button>
                <Button
                  onClick={handleCreateEvent}
                  disabled={
                    !eventForm.eventName || createEventMutation.isPending
                  }
                >
                  {createEventMutation.isPending ? "作成中..." : "作成"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* イベント一覧 */}
        {eventsLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            読み込み中...
          </div>
        ) : events && events.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {events.map((evt) => (
              <Card
                key={evt.id}
                className={`cursor-pointer transition-all hover:border-primary ${
                  selectedEventId === evt.id
                    ? "border-primary ring-2 ring-primary"
                    : ""
                }`}
                onClick={() => setSelectedEventId(evt.id)}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    {evt.eventName}
                  </CardTitle>
                  {evt.description && (
                    <CardDescription>{evt.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {evt.startDate && (
                      <p>
                        開始:{" "}
                        {new Date(evt.startDate).toLocaleDateString("ja-JP")}
                      </p>
                    )}
                    {evt.endDate && (
                      <p>
                        終了:{" "}
                        {new Date(evt.endDate).toLocaleDateString("ja-JP")}
                      </p>
                    )}
                    <p className="text-xs mt-2">ID: {evt.id}</p>
                  </div>
                  {selectedEventId === evt.id && (
                    <Badge className="mt-2">選択中</Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>まだイベントがありません</p>
              <p className="text-sm">
                上のボタンから新規イベントを作成してください
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* サークル管理セクション */}
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Building2 className="h-6 w-6" />
              サークル管理
            </h2>
            {selectedEventId && (
              <p className="text-sm text-muted-foreground mt-1">
                選択中のイベント:{" "}
                {events?.find((e) => e.id === selectedEventId)?.eventName}
              </p>
            )}
          </div>
          <Button
            onClick={() => setShowCircleForm(!showCircleForm)}
            disabled={!selectedEventId}
          >
            <Plus className="mr-2 h-4 w-4" />
            新規サークル
          </Button>
        </div>

        {!selectedEventId && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>イベントを選択してください</p>
              <p className="text-sm">
                上のイベント一覧からイベントをクリックして選択
              </p>
            </CardContent>
          </Card>
        )}

        {/* サークル作成フォーム */}
        {showCircleForm && selectedEventId && (
          <Card>
            <CardHeader>
              <CardTitle>新規サークル作成</CardTitle>
              <CardDescription>
                選択したイベントに新しいサークル（出店）を追加し、代表者を設定します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="circleName">サークル名 *</Label>
                  <Input
                    id="circleName"
                    placeholder="例: 2年1組"
                    value={circleForm.name}
                    onChange={(e) =>
                      setCircleForm({ ...circleForm, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="circlePin">代表者一時PINコード (4〜6桁)</Label>
                  <Input
                    id="circlePin"
                    type="password"
                    placeholder="例: 1234"
                    value={circleForm.managerPin}
                    onChange={(e) =>
                      setCircleForm({
                        ...circleForm,
                        managerPin: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="managerEmail">代表者メールアドレス *</Label>
                  <Input
                    id="managerEmail"
                    type="email"
                    placeholder="leader@example.com"
                    value={circleForm.managerEmail}
                    onChange={(e) =>
                      setCircleForm({
                        ...circleForm,
                        managerEmail: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="managerName">代表者名</Label>
                  <Input
                    id="managerName"
                    placeholder="代表者の名前 (未入力時は「サークル名 代表者」)"
                    value={circleForm.managerName}
                    onChange={(e) =>
                      setCircleForm({
                        ...circleForm,
                        managerName: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="circleDescription">説明</Label>
                  <Input
                    id="circleDescription"
                    placeholder="サークルの説明（例: たこ焼き屋）"
                    value={circleForm.description}
                    onChange={(e) =>
                      setCircleForm({
                        ...circleForm,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowCircleForm(false)}
                >
                  キャンセル
                </Button>
                <Button
                  onClick={handleCreateCircle}
                  disabled={
                    !circleForm.name ||
                    !circleForm.managerEmail ||
                    createCircleMutation.isPending
                  }
                >
                  {createCircleMutation.isPending ? "作成中..." : "作成"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* サークル編集フォーム */}
        {showEditForm && selectedEventId && editingCircleId && (
          <Card>
            <CardHeader>
              <CardTitle>サークル情報の編集</CardTitle>
              <CardDescription>
                サークルの詳細情報や代表者情報を変更します。代表者一時PINを変更しない場合は空欄のままにしてください。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="editCircleName">サークル名 *</Label>
                  <Input
                    id="editCircleName"
                    placeholder="例: 2年1組"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editCirclePin">代表者一時PINコード (変更する場合のみ)</Label>
                  <Input
                    id="editCirclePin"
                    type="password"
                    placeholder="新しい一時PINコード (4〜6桁)"
                    value={editForm.managerPin}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        managerPin: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editManagerEmail">代表者メールアドレス *</Label>
                  <Input
                    id="editManagerEmail"
                    type="email"
                    placeholder="leader@example.com"
                    value={editForm.managerEmail}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        managerEmail: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editManagerName">代表者名</Label>
                  <Input
                    id="editManagerName"
                    placeholder="代表者の名前"
                    value={editForm.managerName}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        managerName: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="editCircleDescription">説明</Label>
                  <Input
                    id="editCircleDescription"
                    placeholder="サークルの説明"
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowEditForm(false);
                    setEditingCircleId(null);
                  }}
                >
                  キャンセル
                </Button>
                <Button
                  onClick={handleEditCircle}
                  disabled={
                    !editForm.name ||
                    !editForm.managerEmail ||
                    updateCircleMutation.isPending
                  }
                >
                  {updateCircleMutation.isPending ? "更新中..." : "保存"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* サークル一覧 */}
        {selectedEventId && (
          <>
            {circlesLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                読み込み中...
              </div>
            ) : circles && circles.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {circles.map((cir) => (
                  <Card key={cir.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Users className="h-5 w-5" />
                          {cir.name}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCircleId(cir.id);
                              setEditForm({
                                name: cir.name,
                                description: cir.description || "",
                                managerPin: "",
                                managerEmail: cir.managerEmail || "",
                                managerName: cir.managerName || "",
                              });
                              setShowEditForm(true);
                              setShowCircleForm(false); // 作成フォームを閉じる
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`「${cir.name}」を削除しますか？`)) {
                                deleteCircleMutation.mutate({ id: cir.id });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardTitle>
                      {cir.description && (
                        <CardDescription>{cir.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>代表者: {cir.managerName || "未設定"} ({cir.managerEmail || "未設定"})</p>
                        <p className="mt-2">ID: {cir.id}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>このイベントにはまだサークルがありません</p>
                  <p className="text-sm">
                    上のボタンから新規サークルを作成してください
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  </AdminAuthGuard>
  );
}

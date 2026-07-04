import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  eventApi,
  circleApi,
  orderApi,
  membershipApi,
  wristbandApi,
  uploadImage,
} from "@/lib/api";
import { EventAdminGuard, useAuth } from "@/hooks/useCircleAuth";
import { useNavigate } from "react-router-dom";
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
import { QRCodeSVG } from "qrcode.react";
import {
  Plus,
  Users,
  Trash2,
  Building2,
  Edit,
  Save,
  Lock,
  Smartphone,
  RefreshCw,
  Search,
  Upload,
  UserPlus,
  TrendingUp,
  Settings
} from "lucide-react";

export default function EventDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { eventId } = useAuth();

  const [activeTab, setActiveTab] = useState<string>("circles");

  // サークル追加/編集フォームステート
  const [showCircleForm, setShowCircleForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingCircleId, setEditingCircleId] = useState<string | null>(null);

  const [circleForm, setCircleForm] = useState({
    name: "",
    description: "",
    managerPin: "",
    managerEmail: "",
    managerName: "",
  });

  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    managerPin: "",
    managerEmail: "",
    managerName: "",
  });

  // スタッフ管理ステート
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"event_admin" | "event_staff">("event_staff");

  // イベント設定フォームステート
  const [eventForm, setEventForm] = useState({
    eventName: "",
    description: "",
    startDate: "",
    endDate: "",
    logoUrl: "",
  });

  // リストバンド紛失処理ステート
  const [lostSearchCode, setLostSearchCode] = useState("");
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [newWristbandId, setNewWristbandId] = useState("");

  // スマホリストバンド発行ステート
  const [issuedUser, setIssuedUser] = useState<{ userId: string; displayId: number } | null>(null);

  // ----------------------------------------------------
  // API Queries & Mutations
  // ----------------------------------------------------

  // イベント情報取得
  const { data: eventData, isLoading: eventLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId!),
    enabled: !!eventId,
  });

  // 各フォームの初期値ロード
  useEffect(() => {
    if (eventData) {
      setEventForm({
        eventName: eventData.eventName || "",
        description: eventData.description || "",
        startDate: eventData.startDate ? new Date(eventData.startDate).toISOString().split("T")[0] : "",
        endDate: eventData.endDate ? new Date(eventData.endDate).toISOString().split("T")[0] : "",
        logoUrl: eventData.logoUrl || "",
      });
    }
  }, [eventData]);

  // サークル一覧取得
  const { data: circles, isLoading: circlesLoading } = useQuery({
    queryKey: ["circles", eventId],
    queryFn: () => circleApi.list(eventId!),
    enabled: !!eventId,
  });

  // 全サークルの売上・注文情報の一括取得 (Promise.all)
  const { data: allCirclesOrders, isLoading: ordersLoading } = useQuery({
    queryKey: ["allCirclesOrders", circles?.map((c) => c.id)],
    queryFn: async () => {
      if (!circles) return [];
      return await Promise.all(
        circles.map(async (cir) => {
          try {
            const oList = await orderApi.list(cir.id);
            return { circleId: cir.id, circleName: cir.name, orders: oList };
          } catch (e) {
            console.error(e);
            return { circleId: cir.id, circleName: cir.name, orders: [] };
          }
        })
      );
    },
    enabled: !!circles && circles.length > 0,
  });

  // イベントスタッフ一覧取得
  const { data: staffMembers, isLoading: staffLoading } = useQuery({
    queryKey: ["eventStaff", eventId],
    queryFn: () => membershipApi.listByEvent(eventId!),
    enabled: !!eventId,
  });

  // 招待中一覧取得
  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ["eventInvites", eventId],
    queryFn: () => membershipApi.listInvites(undefined, eventId!),
    enabled: !!eventId,
  });

  // サークル作成
  const createCircleMutation = useMutation({
    mutationFn: (input: any) => circleApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles", eventId] });
      toast.success("サークルを作成しました");
      setShowCircleForm(false);
      setCircleForm({ name: "", description: "", managerPin: "", managerEmail: "", managerName: "" });
    },
    onError: (error: Error) => {
      toast.error(error.message || "サークル作成に失敗しました");
    },
  });

  // サークル更新
  const updateCircleMutation = useMutation({
    mutationFn: (input: { id: string; name?: string; description?: string; managerPin?: string; managerEmail?: string; managerName?: string }) => {
      const { id, ...data } = input;
      return circleApi.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles", eventId] });
      toast.success("サークル情報を更新しました");
      setShowEditForm(false);
      setEditingCircleId(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "サークル更新に失敗しました");
    },
  });

  // サークル削除
  const deleteCircleMutation = useMutation({
    mutationFn: (id: string) => circleApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circles", eventId] });
      toast.success("サークルを削除しました");
    },
  });

  // スタッフ招待作成
  const createInviteMutation = useMutation({
    mutationFn: (data: any) => membershipApi.createInvite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eventInvites", eventId] });
      toast.success("招待を作成しました");
      setInviteEmail("");
    },
    onError: (error: Error) => {
      toast.error(error.message || "招待作成に失敗しました");
    },
  });

  // 招待削除
  const deleteInviteMutation = useMutation({
    mutationFn: (id: string) => membershipApi.deleteInvite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eventInvites", eventId] });
      toast.success("招待を取り消しました");
    },
  });

  // スタッフ削除（メンバーシップ無効化）
  const deactivateStaffMutation = useMutation({
    mutationFn: (id: string) => membershipApi.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eventStaff", eventId] });
      toast.success("スタッフ登録を解除しました");
    },
  });

  // イベント設定更新
  const updateEventMutation = useMutation({
    mutationFn: (input: any) => eventApi.updateTheme(eventId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      toast.success("イベント基本設定を更新しました");
    },
    onError: (error: Error) => {
      toast.error(error.message || "設定更新に失敗しました");
    },
  });

  // リストバンド検索 (Lookup)
  const lookupWristbandMutation = useMutation({
    mutationFn: (code: string) => wristbandApi.lookup(code),
    onSuccess: (data) => {
      setLookupResult(data);
      if (!data.wristband) {
        toast.info("指定のコードに紐づく有効なリストバンドはありません");
      }
    },
    onError: () => {
      toast.error("照会に失敗しました。正しいコードを入力してください。");
    },
  });

  // リストバンド紛失報告 (Report Lost)
  const reportLostMutation = useMutation({
    mutationFn: (wristbandId: string) => wristbandApi.reportLost(wristbandId),
    onSuccess: () => {
      toast.success("紛失ロック（無効化）が完了しました");
      if (lostSearchCode) {
        lookupWristbandMutation.mutate(lostSearchCode);
      }
    },
  });

  // 新規リストバンド再紐付け (Register/Reissue)
  const registerWristbandMutation = useMutation({
    mutationFn: (input: { userId: string; wristbandId: string }) =>
      wristbandApi.register(input.userId, input.wristbandId),
    onSuccess: () => {
      toast.success("新しいリストバンドをアカウントに紐付けました");
      setNewWristbandId("");
      if (lostSearchCode) {
        lookupWristbandMutation.mutate(lostSearchCode);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "紐付けに失敗しました");
    },
  });

  // スマホ用リストバンド発行 (Issue)
  const issueUserMutation = useMutation({
    mutationFn: () => wristbandApi.issue(eventId!),
    onSuccess: (data) => {
      setIssuedUser({ userId: data.userId, displayId: data.displayId });
      toast.success("新規来場者アカウントを発行しました");
    },
    onError: (error: Error) => {
      toast.error(error.message || "発行に失敗しました");
    },
  });

  // ----------------------------------------------------
  // Actions Handlers
  // ----------------------------------------------------

  const handleCreateCircle = () => {
    if (!eventId) return;
    createCircleMutation.mutate({
      eventId,
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

  const handleInviteStaff = () => {
    if (!eventId || !inviteEmail) return;
    createInviteMutation.mutate({
      eventId,
      targetEmail: inviteEmail.toLowerCase(),
      role: inviteRole,
      createdBy: "event_admin",
    });
  };

  const handleSaveSettings = () => {
    updateEventMutation.mutate({
      eventName: eventForm.eventName,
      description: eventForm.description,
      startDate: eventForm.startDate || null,
      endDate: eventForm.endDate || null,
      logoUrl: eventForm.logoUrl || null,
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      toast.loading("画像をアップロード中...", { id: "upload" });
      const res = await uploadImage(file);
      const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:8787";
      const fullPath = `${baseUrl}${res.path}`;
      setEventForm((prev) => ({ ...prev, logoUrl: fullPath }));
      toast.success("画像をアップロードしました", { id: "upload" });
    } catch (err: any) {
      toast.error(err.message || "アップロードに失敗しました", { id: "upload" });
    }
  };

  const handleSearchLost = () => {
    if (!lostSearchCode) return;
    lookupWristbandMutation.mutate(lostSearchCode);
  };

  const handleReportLost = (wbId: string) => {
    if (confirm("このリストバンドを無効化（紛失）としてマークしますか？この操作は取り消せません。")) {
      reportLostMutation.mutate(wbId);
    }
  };

  const handleReissueWb = (userId: string) => {
    if (!newWristbandId) return;
    registerWristbandMutation.mutate({ userId, wristbandId: newWristbandId });
  };

  // 来場者アプリ接続URL (QRコード用)
  const getVisitorLink = (userId: string) => {
    const visitorBase = import.meta.env.VITE_VISITOR_URL || window.location.origin.replace("3000", "3001");
    return `${visitorBase}/w/${userId}`;
  };

  // ----------------------------------------------------
  // Sales Aggregations
  // ----------------------------------------------------
  const salesStats = (() => {
    if (!allCirclesOrders) return { totalSales: 0, completedOrdersCount: 0, totalOrdersCount: 0 };
    let totalSales = 0;
    let completedOrdersCount = 0;
    let totalOrdersCount = 0;

    allCirclesOrders.forEach((item) => {
      totalOrdersCount += item.orders.length;
      item.orders.forEach((o) => {
        if (o.status === "completed") {
          totalSales += o.totalPrice || 0;
          completedOrdersCount += 1;
        }
      });
    });

    return { totalSales, completedOrdersCount, totalOrdersCount };
  })();

  // サークル別の売上構成
  const circleSalesData = (() => {
    if (!allCirclesOrders) return [];
    return allCirclesOrders
      .map((item) => {
        const sales = item.orders
          .filter((o) => o.status === "completed")
          .reduce((sum, o) => sum + (o.totalPrice || 0), 0);
        return { name: item.circleName, sales };
      })
      .sort((a, b) => b.sales - a.sales);
  })();

  const maxCircleSales = Math.max(...circleSalesData.map((d) => d.sales), 1000);

  // 時間帯別の売上推移 (全サークルマージ)
  const hourlySalesData = (() => {
    const data = Array.from({ length: 10 }, (_, i) => ({
      hour: `${i + 9}:00`,
      sales: 0,
    }));

    if (allCirclesOrders) {
      allCirclesOrders.forEach((item) => {
        item.orders.forEach((o) => {
          if (o.status === "completed" && o.createdAt) {
            const hour = new Date(o.createdAt).getHours();
            if (hour >= 9 && hour <= 18) {
              data[hour - 9].sales += o.totalPrice || 0;
            }
          }
        });
      });
    }
    return data;
  })();

  const maxHourlySales = Math.max(...hourlySalesData.map((d) => d.sales), 1000);

  // 折れ線グラフ用座標
  const svgWidth = 500;
  const svgHeight = 200;
  const padding = 35;
  const chartWidth = svgWidth - padding * 2;
  const chartHeight = svgHeight - padding * 2;

  const points = hourlySalesData.map((d, i) => {
    const x = padding + (i / (hourlySalesData.length - 1)) * chartWidth;
    const y = padding + chartHeight - (d.sales / maxHourlySales) * chartHeight;
    return { x, y, ...d };
  });

  const linePath = points.reduce(
    (acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`),
    ""
  );

  if (!eventId) {
    return (
      <EventAdminGuard>
        <div className="container mx-auto p-6 text-center font-mono pt-20 border-thick border-dashed border-border rounded-none max-w-lg">
          <p className="text-muted-foreground uppercase text-xs font-bold tracking-widest">
            アクティブなイベントが選択されていません。
          </p>
          <p className="text-[10px] text-muted-foreground mt-2">ヘッダーのスペース切り替えから対象のイベントを選択してください。</p>
        </div>
      </EventAdminGuard>
    );
  }

  return (
    <EventAdminGuard>
      <DashboardLayout
        title={eventLoading ? "LOADING..." : `[EVENT: ${eventData?.eventName}]`}
        subtitle="イベント統合管理"
        type="event"
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {/* ==================================================== */}
        {/* TAB 1: サークル管理 */}
        {/* ==================================================== */}
        {activeTab === "circles" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-thick border-border pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                サークル一覧 ({circles?.length || 0})
              </h2>
              <Button
                onClick={() => {
                  setShowCircleForm(!showCircleForm);
                  setShowEditForm(false);
                }}
                className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] uppercase font-bold transition-all shadow-none px-3"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                新規追加
              </Button>
            </div>

            {/* 作成フォーム */}
            {showCircleForm && (
              <Card className="border-thick border-border rounded-none bg-background shadow-none p-2">
                <CardHeader className="pb-3 border-b-thick border-border">
                  <CardTitle className="text-xs uppercase font-bold tracking-wider">[新規サークル登録]</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="circleName" className="text-[10px] font-bold uppercase">サークル名 *</Label>
                      <Input
                        id="circleName"
                        placeholder="例: たこ焼き 茨香庵"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={circleForm.name}
                        onChange={(e) => setCircleForm({ ...circleForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="circlePin" className="text-[10px] font-bold uppercase">代表者一時PINコード (4〜6桁)</Label>
                      <Input
                        id="circlePin"
                        type="password"
                        placeholder="例: 1234"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={circleForm.managerPin}
                        onChange={(e) => setCircleForm({ ...circleForm, managerPin: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="managerEmail" className="text-[10px] font-bold uppercase">代表者メールアドレス *</Label>
                      <Input
                        id="managerEmail"
                        type="email"
                        placeholder="leader@example.com"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={circleForm.managerEmail}
                        onChange={(e) => setCircleForm({ ...circleForm, managerEmail: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="managerName" className="text-[10px] font-bold uppercase">代表者名</Label>
                      <Input
                        id="managerName"
                        placeholder="代表者のお名前"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={circleForm.managerName}
                        onChange={(e) => setCircleForm({ ...circleForm, managerName: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <Label htmlFor="circleDescription" className="text-[10px] font-bold uppercase">説明</Label>
                      <Input
                        id="circleDescription"
                        placeholder="出店ジャンルや販売メニュー等の説明"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={circleForm.description}
                        onChange={(e) => setCircleForm({ ...circleForm, description: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="border-thick border-border rounded-none h-8 text-[11px] font-bold hover:bg-neutral-100 px-3"
                      onClick={() => setShowCircleForm(false)}
                    >
                      キャンセル
                    </Button>
                    <Button
                      onClick={handleCreateCircle}
                      disabled={!circleForm.name || !circleForm.managerEmail || createCircleMutation.isPending}
                      className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold rounded-none shadow-none px-3"
                    >
                      サークルを追加
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 編集フォーム */}
            {showEditForm && editingCircleId && (
              <Card className="border-thick border-border rounded-none bg-background shadow-none p-2">
                <CardHeader className="pb-3 border-b-thick border-border">
                  <CardTitle className="text-xs uppercase font-bold tracking-wider">[サークル情報の編集]</CardTitle>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label htmlFor="editCircleName" className="text-[10px] font-bold uppercase">サークル名 *</Label>
                      <Input
                        id="editCircleName"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="editCirclePin" className="text-[10px] font-bold uppercase">代表者一時PIN (変更時のみ入力)</Label>
                      <Input
                        id="editCirclePin"
                        type="password"
                        placeholder="変更時のみ入力"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={editForm.managerPin}
                        onChange={(e) => setEditForm({ ...editForm, managerPin: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="editManagerEmail" className="text-[10px] font-bold uppercase">代表者メールアドレス *</Label>
                      <Input
                        id="editManagerEmail"
                        type="email"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={editForm.managerEmail}
                        onChange={(e) => setEditForm({ ...editForm, managerEmail: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="editManagerName" className="text-[10px] font-bold uppercase">代表者名</Label>
                      <Input
                        id="editManagerName"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={editForm.managerName}
                        onChange={(e) => setEditForm({ ...editForm, managerName: e.target.value })}
                      />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <Label htmlFor="editCircleDescription" className="text-[10px] font-bold uppercase">説明</Label>
                      <Input
                        id="editCircleDescription"
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="border-thick border-border rounded-none h-8 text-[11px] font-bold hover:bg-neutral-100 px-3"
                      onClick={() => {
                        setShowEditForm(false);
                        setEditingCircleId(null);
                      }}
                    >
                      キャンセル
                    </Button>
                    <Button
                      onClick={handleEditCircle}
                      disabled={!editForm.name || !editForm.managerEmail || updateCircleMutation.isPending}
                      className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold rounded-none shadow-none px-3"
                    >
                      変更を保存
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* サークル一覧 */}
            {circlesLoading ? (
              <div className="text-center py-12 text-muted-foreground text-xs uppercase tracking-wider">Loading...</div>
            ) : circles && circles.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {circles.map((cir) => (
                  <Card
                    key={cir.id}
                    className="border-thick border-border rounded-none bg-background flex flex-col justify-between shadow-none hover:border-neutral-800 transition-all p-3"
                  >
                    <div>
                      <div className="flex justify-between items-start border-b-thick border-muted pb-2 mb-2">
                        <CardTitle className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 truncate max-w-[80%]">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {cir.name}
                        </CardTitle>
                        <div className="flex gap-1 shrink-0">
                          <button
                            className="p-0.5 text-muted-foreground hover:text-primary transition-all rounded-none cursor-pointer"
                            onClick={() => {
                              setEditingCircleId(cir.id);
                              setEditForm({
                                name: cir.name,
                                description: cir.description || "",
                                managerPin: "",
                                managerEmail: cir.managerEmail || "",
                                managerName: cir.managerName || "",
                              });
                              setShowEditForm(true);
                              setShowCircleForm(false);
                            }}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="p-0.5 text-destructive hover:text-neutral-800 transition-all rounded-none cursor-pointer"
                            onClick={() => {
                              if (confirm(`サークル「${cir.name}」を削除してよろしいですか？`)) {
                                deleteCircleMutation.mutate(cir.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {cir.description && (
                        <p className="text-[10px] text-muted-foreground truncate mb-3">{cir.description}</p>
                      )}
                      <div className="text-[10px] text-muted-foreground space-y-1 font-mono mb-4">
                        <p>代表者: {cir.managerName || "未設定"}</p>
                        <p className="truncate">メール: {cir.managerEmail}</p>
                        <p className="opacity-50 text-[8px]">ID: {cir.id}</p>
                      </div>
                    </div>
                    {/* ※「このサークルを管理」は、ローカルストレージのアクティブサークルIDを書き換えてサークル画面へ移動する処理 */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-thick border-border hover:bg-neutral-100 rounded-none uppercase font-bold tracking-wider text-[10px] h-8 shadow-none"
                      onClick={() => {
                        const authStored = localStorage.getItem("circleAuth");
                        if (authStored) {
                          try {
                            const authInfo = JSON.parse(authStored);
                            localStorage.setItem(
                              "circleAuth",
                              JSON.stringify({
                                ...authInfo,
                                circleId: cir.id,
                                circleName: cir.name,
                                role: "circle_manager",
                              })
                            );
                            localStorage.setItem("circleId", cir.id);
                            toast.success(`「${cir.name}」のダッシュボードに切り替えました`);
                            navigate("/circle/dashboard");
                          } catch (_) {}
                        }
                      }}
                    >
                      サークル管理へ切替
                    </Button>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="border-thick border-dashed border-border rounded-none p-12 text-center text-muted-foreground bg-background shadow-none">
                <Users className="h-8 w-8 mx-auto mb-4 opacity-40 text-foreground" />
                <p className="text-xs uppercase tracking-widest font-bold font-headline">サークルが登録されていません</p>
              </Card>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 2: 全体売上管理 */}
        {/* ==================================================== */}
        {activeTab === "sales" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-thick border-border pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                イベント全体売上統計
              </h2>
            </div>

            {ordersLoading ? (
              <div className="text-center py-12 text-muted-foreground text-xs uppercase tracking-wider">Loading sales stats...</div>
            ) : (
              <div className="space-y-6">
                {/* 売上概要カード */}
                <div className="grid gap-4 md:grid-cols-3 font-mono">
                  <Card className="rounded-none border-thick border-border shadow-none">
                    <CardHeader className="p-3 pb-1">
                      <CardTitle className="text-[10px] uppercase font-bold text-muted-foreground">総注文数</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <p className="text-xl font-black">{salesStats.totalOrdersCount}件</p>
                    </CardContent>
                  </Card>

                  <Card className="rounded-none border-thick border-border shadow-none">
                    <CardHeader className="p-3 pb-1">
                      <CardTitle className="text-[10px] uppercase font-bold text-muted-foreground">完了取引数</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <p className="text-xl font-black">{salesStats.completedOrdersCount}件</p>
                    </CardContent>
                  </Card>

                  <Card className="rounded-none border-thick border-border shadow-none bg-primary text-primary-foreground">
                    <CardHeader className="p-3 pb-1">
                      <CardTitle className="text-[10px] uppercase font-bold text-primary-foreground/75">イベント総売上</CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <p className="text-xl font-black">¥{salesStats.totalSales.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* グラフ */}
                <div className="grid gap-6 md:grid-cols-2">
                  {/* サークル別売上 (横棒) */}
                  <Card className="rounded-none border-thick border-border shadow-none">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-bold uppercase">[サークル別売上比率]</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      {circleSalesData.length > 0 ? (
                        <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1 no-scrollbar">
                          {circleSalesData.map((cir, idx) => {
                            const pct = (cir.sales / maxCircleSales) * 100;
                            return (
                              <div key={idx} className="space-y-1">
                                <div className="flex justify-between text-[10px] font-bold uppercase font-mono">
                                  <span>{cir.name}</span>
                                  <span>¥{cir.sales.toLocaleString()}</span>
                                </div>
                                <div className="w-full h-3.5 border border-border bg-muted rounded-none relative">
                                  <div
                                    style={{ width: `${pct}%` }}
                                    className="h-full bg-primary transition-all"
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground text-center py-12">売上データはありません</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* 時間帯別売上推移 (折れ線SVG) */}
                  <Card className="rounded-none border-thick border-border shadow-none">
                    <CardHeader className="p-4">
                      <CardTitle className="text-xs font-bold uppercase">[イベント時間帯別売上]</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 flex justify-center">
                      <div className="w-full max-w-[450px]">
                        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto overflow-visible">
                          {Array.from({ length: 5 }).map((_, i) => {
                            const y = padding + (i / 4) * chartHeight;
                            const val = Math.round(maxHourlySales * (1 - i / 4));
                            return (
                              <g key={i}>
                                <line
                                  x1={padding}
                                  y1={y}
                                  x2={svgWidth - padding}
                                  y2={y}
                                  stroke="#E5E5E5"
                                  strokeWidth="1"
                                  strokeDasharray="2 2"
                                />
                                <text
                                  x={padding - 6}
                                  y={y + 3}
                                  className="font-mono text-[7px] fill-muted-foreground"
                                  textAnchor="end"
                                >
                                  ¥{val.toLocaleString()}
                                </text>
                              </g>
                            );
                          })}

                          {points.map((p, i) => (
                            <text
                              key={i}
                              x={p.x}
                              y={svgHeight - padding + 12}
                              className="font-mono text-[7px] fill-muted-foreground"
                              textAnchor="middle"
                            >
                              {p.hour}
                            </text>
                          ))}

                          <path
                            d={linePath}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-foreground"
                          />

                          {points.map((p, i) => (
                            <g key={i} className="group">
                              <rect
                                x={p.x - 2.5}
                                y={p.y - 2.5}
                                width="5"
                                height="5"
                                fill="currentColor"
                                className="text-foreground cursor-pointer"
                              />
                              <title>{`${p.hour}: ¥${p.sales.toLocaleString()}`}</title>
                            </g>
                          ))}
                        </svg>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 3: スタッフ管理 */}
        {/* ==================================================== */}
        {activeTab === "staff" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-thick border-border pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Users className="h-4 w-4" />
                イベント所属スタッフ管理
              </h2>
            </div>

            {/* 新規スタッフ招待 */}
            <Card className="border-thick border-border rounded-none bg-background shadow-none">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs uppercase font-bold">[スタッフ招待トークンの発行]</CardTitle>
                <CardDescription className="text-[10px]">追加したいスタッフのメールアドレスを入力して、招待トークンを生成します。</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="inviteEmail" className="text-[10px] font-bold uppercase">メールアドレス</Label>
                    <Input
                      id="inviteEmail"
                      type="email"
                      placeholder="staff@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                    />
                  </div>
                  <div className="w-full sm:w-48 space-y-1">
                    <Label htmlFor="inviteRole" className="text-[10px] font-bold uppercase">付与権限 (ロール)</Label>
                    <select
                      id="inviteRole"
                      value={inviteRole}
                      onChange={(e: any) => setInviteRole(e.target.value)}
                      className="w-full h-9 border-thick border-border rounded-none bg-background px-2 text-xs font-bold uppercase font-mono"
                    >
                      <option value="event_staff">イベントスタッフ (一般)</option>
                      <option value="event_admin">イベント管理者 (フルアクセス)</option>
                    </select>
                  </div>
                  <Button
                    onClick={handleInviteStaff}
                    disabled={!inviteEmail || createInviteMutation.isPending}
                    className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold rounded-none shadow-none px-4"
                  >
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    招待を発行
                  </Button>
                </div>

                {/* 招待一覧 */}
                {invites && invites.length > 0 && (
                  <div className="border-t-thick border-border pt-4">
                    <h3 className="text-[10px] font-bold uppercase text-muted-foreground mb-2">[アクティブな招待リンク一覧]</h3>
                    <div className="space-y-2">
                      {invites.map((inv) => {
                        const inviteUrl = `${window.location.origin}/login?invite=${inv.token}`;
                        return (
                          <div key={inv.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-2.5 border-thick border-border text-[10px] font-mono bg-muted/30">
                            <div className="space-y-0.5">
                              <p className="font-bold text-foreground">ロール: {inv.role}</p>
                              <p className="text-muted-foreground text-[8px] break-all select-all">リンク: {inviteUrl}</p>
                            </div>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => deleteInviteMutation.mutate(inv.id)}
                              className="h-7 text-[8px] font-bold uppercase rounded-none px-2 shadow-none border border-transparent mt-2 sm:mt-0 shrink-0"
                            >
                              取消
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* スタッフ一覧 */}
            <Card className="border-thick border-border rounded-none shadow-none">
              <CardHeader className="p-4 pb-2 border-b-thick border-border">
                <CardTitle className="text-xs uppercase font-bold">[登録済みスタッフ一覧]</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {staffLoading ? (
                  <div className="p-6 text-center text-xs uppercase tracking-wider text-muted-foreground">Loading staff...</div>
                ) : staffMembers && staffMembers.length > 0 ? (
                  <div className="divide-y divide-border">
                    {staffMembers.map((member) => (
                      <div key={member.id} className="flex justify-between items-center p-3 text-xs font-mono">
                        <div>
                          <p className="font-bold text-foreground">{member.userName || "名前未設定"}</p>
                          <p className="text-[10px] text-muted-foreground">{member.userEmail}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="default" className="rounded-none text-[8px] font-mono border-thick border-border bg-transparent text-foreground border uppercase">
                            {member.role === "event_admin" ? "管理者" : "スタッフ"}
                          </Badge>
                          {/* 最上位管理者は削除不可などの制御 */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (confirm(`スタッフ「${member.userName}」の登録を解除しますか？`)) {
                                deactivateStaffMutation.mutate(member.id);
                              }
                            }}
                            className="border-thick border-border hover:bg-destructive hover:text-destructive-foreground text-[10px] h-7 px-2 rounded-none shadow-none"
                          >
                            解除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="p-6 text-center text-xs text-muted-foreground uppercase">スタッフは登録されていません</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 4: イベント設定 */}
        {/* ==================================================== */}
        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-thick border-border pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Settings className="h-4 w-4" />
                イベント基本設定・ロゴ画像
              </h2>
            </div>

            <Card className="border-thick border-border rounded-none bg-background shadow-none">
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* 設定項目 */}
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <Label htmlFor="settingsEventName" className="text-[10px] font-bold uppercase">イベント名 *</Label>
                      <Input
                        id="settingsEventName"
                        value={eventForm.eventName}
                        onChange={(e) => setEventForm({ ...eventForm, eventName: e.target.value })}
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="settingsDescription" className="text-[10px] font-bold uppercase">説明・概要</Label>
                      <Input
                        id="settingsDescription"
                        value={eventForm.description}
                        onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
                        className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="settingsStartDate" className="text-[10px] font-bold uppercase">開始日</Label>
                        <Input
                          id="settingsStartDate"
                          type="date"
                          value={eventForm.startDate}
                          onChange={(e) => setEventForm({ ...eventForm, startDate: e.target.value })}
                          className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="settingsEndDate" className="text-[10px] font-bold uppercase">終了日</Label>
                        <Input
                          id="settingsEndDate"
                          type="date"
                          value={eventForm.endDate}
                          onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })}
                          className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ロゴ画像アップロード */}
                  <div className="space-y-2 border-thick border-dashed border-border p-4 flex flex-col justify-center items-center bg-muted/20">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground block text-center mb-2">イベント画像（ロゴ・背景用）</Label>
                    
                    {eventForm.logoUrl ? (
                      <div className="space-y-2 text-center w-full">
                        <img
                          src={eventForm.logoUrl}
                          alt="Event logo"
                          className="max-h-24 mx-auto block border-thick border-border bg-background"
                        />
                        <button
                          onClick={() => setEventForm((prev) => ({ ...prev, logoUrl: "" }))}
                          className="text-[8px] font-bold text-destructive uppercase hover:underline block mx-auto cursor-pointer"
                        >
                          画像を削除
                        </button>
                      </div>
                    ) : (
                      <div className="text-center space-y-2">
                        <div className="bg-background border-thick border-border p-3 inline-block">
                          <Upload className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-[9px] text-muted-foreground uppercase">PNG, JPG (Max 5MB)</p>
                      </div>
                    )}

                    <div className="pt-2">
                      <input
                        type="file"
                        accept="image/*"
                        id="logo-file-input"
                        className="hidden"
                        onChange={handleLogoUpload}
                      />
                      <Label
                        htmlFor="logo-file-input"
                        className="border-thick border-border bg-background hover:bg-muted text-[10px] font-bold uppercase px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5"
                      >
                        画像ファイルを選択
                      </Label>
                    </div>
                  </div>
                </div>

                <div className="border-t-thick border-border pt-4 flex justify-end">
                  <Button
                    onClick={handleSaveSettings}
                    disabled={!eventForm.eventName || updateEventMutation.isPending}
                    className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold rounded-none shadow-none px-4 flex items-center gap-1.5"
                  >
                    <Save className="h-4 w-4" />
                    設定を保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 5: リストバンド紛失処理 */}
        {/* ==================================================== */}
        {activeTab === "wristbands" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-thick border-border pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Lock className="h-4 w-4" />
                リストバンド紛失のロック・再発行処理
              </h2>
            </div>

            <Card className="border-thick border-border rounded-none bg-background shadow-none">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs uppercase font-bold">[登録情報スキャン・照会]</CardTitle>
                <CardDescription className="text-[10px]">紛失したと思われるリストバンドID、または来場者ユーザーIDを入力して照会します。</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="例: wb_test_001 または usr_xxxx"
                    value={lostSearchCode}
                    onChange={(e) => setLostSearchCode(e.target.value)}
                    className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background font-mono flex-1"
                  />
                  <Button
                    onClick={handleSearchLost}
                    disabled={!lostSearchCode || lookupWristbandMutation.isPending}
                    className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-9 text-xs font-bold rounded-none shadow-none px-4"
                  >
                    <Search className="h-4 w-4 mr-1" />
                    照会
                  </Button>
                </div>

                {/* 照会結果表示 */}
                {lookupResult && (
                  <div className="border-thick border-border p-4 bg-muted/10 space-y-4 text-xs font-mono">
                    <div className="border-b-thick border-border pb-2">
                      <h4 className="font-bold uppercase text-[10px] text-muted-foreground mb-1">[来場者アカウント情報]</h4>
                      <p>ユーザーID: {lookupResult.user.id}</p>
                      <p>表示用呼び出しID: #{lookupResult.user.displayId}</p>
                      <p>状態: {lookupResult.user.status}</p>
                      <p>ニックネーム: {lookupResult.user.nickname || "未登録"}</p>
                    </div>

                    <div className="border-b-thick border-border pb-2">
                      <h4 className="font-bold uppercase text-[10px] text-muted-foreground mb-1">[紐付く物理リストバンド]</h4>
                      {lookupResult.wristband ? (
                        <div className="space-y-2">
                          <p>リストバンドコード: {lookupResult.wristband.id}</p>
                          <p className="flex items-center gap-2">
                            状態:
                            <Badge variant="default" className={`rounded-none text-[8px] font-mono border-thick border-border uppercase ${
                              lookupResult.wristband.status === "active" ? "bg-success/20 text-success border-success" : "bg-destructive/20 text-destructive border-destructive"
                            }`}>
                              {lookupResult.wristband.status}
                            </Badge>
                          </p>
                          <p>割当日時: {new Date(lookupResult.wristband.assignedAt).toLocaleString("ja-JP")}</p>

                          {lookupResult.wristband.status === "active" && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleReportLost(lookupResult.wristband.id)}
                              className="rounded-none text-[9px] font-bold h-7 uppercase mt-1.5 shadow-none border border-transparent"
                            >
                              リストバンド紛失報告（即時ロック）
                            </Button>
                          )}
                        </div>
                      ) : (
                        <p className="text-muted-foreground italic text-[10px]">有効な物理リストバンドは紐付いていません</p>
                      )}
                    </div>

                    {/* 再発行（新規リストバンドの紐付け） */}
                    <div className="space-y-2">
                      <h4 className="font-bold uppercase text-[10px] text-muted-foreground">[新しいリストバンドの紐付け・再発行]</h4>
                      <p className="text-[10px] text-muted-foreground">新しい物理リストバンドのQR/コード値を入力して登録します（古いリストバンドは自動的に無効化されます）。</p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="新しいリストバンドIDを入力"
                          value={newWristbandId}
                          onChange={(e) => setNewWristbandId(e.target.value)}
                          className="border-thick border-border rounded-none focus-visible:ring-0 h-9 text-xs bg-background font-mono flex-1"
                        />
                        <Button
                          onClick={() => handleReissueWb(lookupResult.user.id)}
                          disabled={!newWristbandId || registerWristbandMutation.isPending}
                          className="border-thick border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground h-9 text-xs font-bold rounded-none shadow-none px-4"
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                          再発行登録
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ==================================================== */}
        {/* TAB 6: スマホリストバンド発行 */}
        {/* ==================================================== */}
        {activeTab === "issue" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-thick border-border pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                スマホ用リストバンド（デジタルQR）の発行
              </h2>
            </div>

            <Card className="border-thick border-border rounded-none bg-background shadow-none">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs uppercase font-bold">[デジタルQRコードの新規生成]</CardTitle>
                <CardDescription className="text-[10px]">
                  物理的なリストバンドを使わず、スマートフォンの画面をリストバンドとして利用する来場者向けのアカウントIDをその場で発行します。
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                <div className="bg-muted/10 border-thick border-border p-4 text-center space-y-4">
                  <p className="text-[11px] text-muted-foreground uppercase font-mono">
                    発行ボタンを押すと、来場者専用のチェックイン用URLとQRコードが生成されます。
                  </p>
                  <Button
                    onClick={() => issueUserMutation.mutate()}
                    disabled={issueUserMutation.isPending}
                    className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-11 text-xs font-black uppercase rounded-none shadow-none px-6"
                  >
                    <Smartphone className="mr-1.5 h-4 w-4" />
                    スマホ用来場者QRを発行する
                  </Button>
                </div>

                {/* 発行されたQRコードの表示 */}
                {issuedUser && (
                  <div className="border-thick border-border p-6 bg-background space-y-6 text-center max-w-sm mx-auto shadow-none font-mono">
                    <div className="space-y-1">
                      <span className="bg-primary text-primary-foreground px-2 py-0.5 text-[9px] font-black uppercase tracking-widest inline-block">
                        ONLINE ENTRY QR
                      </span>
                      <h4 className="text-sm font-black uppercase tracking-wider">スマホチェックイン用QRコード</h4>
                      <p className="text-[9px] text-muted-foreground">表示呼び出し番号: #{issuedUser.displayId}</p>
                    </div>

                    {/* QRコード画像 (SVG) */}
                    <div className="bg-background p-4 inline-block border-[3px] border-border mx-auto">
                      <QRCodeSVG
                        value={getVisitorLink(issuedUser.userId)}
                        size={160}
                        level="M"
                        includeMargin={false}
                      />
                    </div>

                    <div className="space-y-2 text-left text-[9px] text-muted-foreground border-t-thick border-border pt-4">
                      <p className="break-all select-all"><strong>チェックインURL:</strong><br />{getVisitorLink(issuedUser.userId)}</p>
                      <p className="pt-1">
                        ※来場者は、自身のスマートフォンでこのQRコードをスキャンしてアクセスし、ニックネームや生年月日を入力することで、スマホ単体での入場・注文が可能になります。
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DashboardLayout>
    </EventAdminGuard>
  );
}

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard, useAuth } from "@/hooks/useCircleAuth";
import {
  circleApi,
  membershipApi,
  parseCircleSettings,
  type OrderFlowMode,
} from "@/lib/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { OptionCard } from "@/components/ui/OptionCard";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { toast } from "sonner";
import { Save, Package, UserCheck, Crown, Clock, ChefHat, CheckCircle2 } from "lucide-react";

// 注文モードの選択肢
const ORDER_FLOW_OPTIONS: {
  value: OrderFlowMode;
  label: string;
  description: string;
  icon: any;
}[] = [
  {
    value: "pending",
    label: "未着手で受付",
    description: "注文は「未着手」で厨房に入り、調理開始→完成の順で進みます (既定)",
    icon: Clock,
  },
  {
    value: "preparing",
    label: "調理中から開始",
    description: "注文を最初から「調理中」として厨房に入れます",
    icon: ChefHat,
  },
  {
    value: "completed",
    label: "即完成",
    description: "注文と同時に「完成」扱いにします。厨房を経由しない模擬店向け",
    icon: CheckCircle2,
  },
];

function CircleSettingsContent() {
  const { role, membershipId, isEventAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [circleId, setCircleId] = useState<string>("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const [form, setForm] = useState({ name: "", description: "" });

  // 運用設定 (注文モード・拡張機能ON/OFF)
  const [orderFlowMode, setOrderFlowMode] = useState<OrderFlowMode>("pending");
  const [stockEnabled, setStockEnabled] = useState(false);
  const [staffEnabled, setStaffEnabled] = useState(false);

  // オーナー譲渡確認
  const [pendingTransfer, setPendingTransfer] = useState<{ id: string; name: string } | null>(
    null
  );

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) setCircleId(storedCircleId);
    const authStored = localStorage.getItem("circleAuth");
    if (authStored) {
      try {
        const authInfo = JSON.parse(authStored);
        if (authInfo.circleName) setCircleName(authInfo.circleName);
      } catch (_) {}
    }
  }, []);

  const { data: circle, isLoading } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
  });

  // サークルメンバー (オーナー譲渡用)
  const { data: members } = useQuery({
    queryKey: ["circleMembers", circleId],
    queryFn: () => membershipApi.listByCircle(circleId),
    enabled: !!circleId,
  });

  useEffect(() => {
    if (circle) {
      setForm({ name: circle.name, description: circle.description || "" });
      const s = parseCircleSettings(circle.settings);
      setOrderFlowMode(s.orderFlowMode);
      setStockEnabled(s.extensions.stock);
      setStaffEnabled(s.extensions.staff);
    }
  }, [circle]);

  const updateCircle = useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string }) => {
      const { id, ...data } = input;
      return await circleApi.update(id, data);
    },
    onSuccess: () => {
      toast.success("サークル情報を更新しました");
      localStorage.setItem("circleName", form.name);
      queryClient.invalidateQueries({ queryKey: ["circle", circleId] });
    },
    onError: (error: any) => toast.error(error.message || "更新に失敗しました"),
  });

  const updateSettings = useMutation({
    mutationFn: async () =>
      circleApi.updateSettings(circleId, {
        orderFlowMode,
        extensions: { stock: stockEnabled, staff: staffEnabled },
      }),
    onSuccess: () => {
      toast.success("運用設定を保存しました");
      queryClient.invalidateQueries({ queryKey: ["circle", circleId] });
    },
    onError: (error: any) => toast.error(error.message || "設定の保存に失敗しました"),
  });

  const transferOwner = useMutation({
    mutationFn: async (targetMembershipId: string) =>
      circleApi.transferOwner(circleId, targetMembershipId),
    onSuccess: () => {
      toast.success("オーナー権限を譲渡しました");
      queryClient.invalidateQueries({ queryKey: ["circleMembers", circleId] });
      setPendingTransfer(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "譲渡に失敗しました");
      setPendingTransfer(null);
    },
  });

  const handleSave = () => {
    updateCircle.mutate({ id: circleId, name: form.name, description: form.description });
  };

  // 上位管理者(オーナー/イベント管理者/システム管理者)のみオーナー譲渡を実行できる
  const canTransfer =
    role === "circle_manager" ||
    role === "event_manager" ||
    role === "super_admin" ||
    isEventAdmin;

  const activeMembers = (members ?? []).filter((m: any) => m.isActive !== false);
  const currentOwner = activeMembers.find((m: any) => m.role === "circle_manager");
  // 譲渡先候補: 現オーナー以外のアクティブメンバー
  const transferCandidates = activeMembers.filter(
    (m: any) => m.role !== "circle_manager" && m.id !== membershipId
  );

  if (isLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="サークル設定" type="circle">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={circleName} subtitle="サークル設定" type="circle">
      <div className="space-y-6">
        {/* 基本情報 */}
        <Card className="rounded-none shadow-none">
          <CardHeader className="pb-3 border-b-thick border-border">
            <CardTitle className="text-sm font-bold uppercase">基本情報</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              サークルの基本情報を編集できます
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs font-bold uppercase">
                サークル名
              </Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例: 2年1組"
                className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description" className="text-xs font-bold uppercase">
                説明
              </Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="サークルの説明"
                className="border-thick border-border rounded-none focus-visible:ring-0 bg-background text-sm"
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={updateCircle.isPending}
              className="rounded-none text-xs font-bold bg-primary text-primary-foreground hover:bg-background hover:text-foreground border-thick border-transparent hover:border-border h-9 shadow-none px-4"
            >
              <Save className="mr-2 h-4 w-4" />
              {updateCircle.isPending ? "保存中..." : "変更を保存"}
            </Button>
          </CardContent>
        </Card>

        {/* 注文モード */}
        <Card className="rounded-none shadow-none">
          <CardHeader className="pb-3 border-b-thick border-border">
            <CardTitle className="text-sm font-bold uppercase">注文モード</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              新規注文が入ったときの初期状態を選べます
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-2">
            {ORDER_FLOW_OPTIONS.map((opt) => (
              <OptionCard
                key={opt.value}
                icon={opt.icon}
                label={opt.label}
                description={opt.description}
                selected={orderFlowMode === opt.value}
                onSelect={() => setOrderFlowMode(opt.value)}
              />
            ))}
          </CardContent>
        </Card>

        {/* 拡張機能 (在庫/スタッフ) */}
        <Card className="rounded-none shadow-none">
          <CardHeader className="pb-3 border-b-thick border-border">
            <CardTitle className="text-sm font-bold uppercase">拡張機能</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              使いたい機能だけONにできます。OFFの機能はダッシュボードから隠れます
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <ExtensionToggle
              icon={Package}
              label="在庫管理"
              description="在庫数の確認と更新"
              enabled={stockEnabled}
              onToggle={() => setStockEnabled((v) => !v)}
            />
            <ExtensionToggle
              icon={UserCheck}
              label="スタッフ管理"
              description="シフトとスタッフの管理"
              enabled={staffEnabled}
              onToggle={() => setStaffEnabled((v) => !v)}
            />
          </CardContent>
        </Card>

        {/* 運用設定 (注文モード + 拡張機能) の保存 */}
        <div className="flex justify-end">
          <Button
            onClick={() => updateSettings.mutate()}
            disabled={updateSettings.isPending}
            className="h-11 border-thick border-primary bg-primary font-mono text-xs font-bold text-primary-foreground rounded-none hover:bg-background hover:text-foreground uppercase px-6"
          >
            <Save className="mr-1.5 h-4 w-4" />
            {updateSettings.isPending ? "保存中..." : "運用設定を保存"}
          </Button>
        </div>

        {/* オーナー権限の譲渡 */}
        {canTransfer && (
          <Card className="rounded-none shadow-none">
            <CardHeader className="pb-3 border-b-thick border-border">
              <CardTitle className="text-sm font-bold uppercase flex items-center gap-1.5">
                <Crown className="h-4 w-4" />
                オーナー権限の譲渡
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                サークルのオーナー(店舗管理者)を別のメンバーに引き継ぎます。譲渡すると自分は一般スタッフになります
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                現在のオーナー:{" "}
                <span className="text-foreground">
                  {currentOwner ? `${currentOwner.userName} (${currentOwner.userEmail})` : "未設定"}
                </span>
              </div>

              {transferCandidates.length === 0 ? (
                <div className="border-thick border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
                  譲渡できるメンバーがいません。先にメンバー管理からメンバーを追加してください。
                </div>
              ) : (
                <div className="space-y-2">
                  {transferCandidates.map((m: any) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 border-thick border-border p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">{m.userName}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{m.userEmail}</div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setPendingTransfer({ id: m.id, name: m.userName })}
                        disabled={transferOwner.isPending}
                        className="border-thick border-border rounded-none h-8 text-[10px] uppercase font-bold shrink-0 px-3"
                      >
                        <Crown className="mr-1 h-3.5 w-3.5" />
                        譲渡
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* サークルID */}
        <Card className="rounded-none shadow-none">
          <CardHeader className="pb-3 border-b-thick border-border">
            <CardTitle className="text-sm font-bold uppercase">サークルID</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              このIDはシステム内で一意であり、変更できません
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <code className="bg-muted px-3 py-1.5 text-xs rounded-none border-thick border-border block w-fit font-mono">
              {circleId}
            </code>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        isOpen={!!pendingTransfer}
        title="[オーナー権限の譲渡]"
        description={`「${pendingTransfer?.name ?? ""}」にオーナー権限を譲渡しますか？あなたは一般スタッフになります。`}
        confirmLabel="譲渡する"
        onConfirm={() => {
          if (pendingTransfer) transferOwner.mutate(pendingTransfer.id);
        }}
        onCancel={() => setPendingTransfer(null)}
      />
    </DashboardLayout>
  );
}

// 拡張機能のON/OFFトグル行
function ExtensionToggle({
  icon: Icon,
  label,
  description,
  enabled,
  onToggle,
}: {
  icon: any;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-thick border-border p-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase">{label}</div>
          <div className="text-[10px] text-muted-foreground">{description}</div>
        </div>
      </div>
      <ToggleSwitch checked={enabled} onChange={onToggle} label={label} />
    </div>
  );
}

export default function CircleSettingsPage() {
  return (
    <CircleAuthGuard>
      <CircleSettingsContent />
    </CircleAuthGuard>
  );
}

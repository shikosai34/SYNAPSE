
import { useState, useEffect } from "react";
import Script from "@/components/script";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { preOrderApi, wristbandApi, orderApi, circleApi, eventApi } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { ModSandbox } from "@/components/ModSandbox";
import { useGuestUser } from "@/hooks/useGuestUser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { useRouter } from "@/lib/next-navigation";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  QrCode,
  Link as LinkIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/useCircleAuth";

export default function MyOrderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId: guestUserId, isLoaded: isGuestLoaded } = useGuestUser();
  const { session } = useVisitor();
  const eventId = session?.eventId;

  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId!),
    enabled: !!eventId,
  });
  const { userId: authUserId, isAuthenticated, isLoading: authLoading } = useAuth();
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [newWristbandId, setNewWristbandId] = useState("");
  const [isReportLostConfirmOpen, setIsReportLostConfirmOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [modHooks, setModHooks] = useState<{ id: string; hook: any }[]>([]);
  const [directOrders, setDirectOrders] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  // 代引き注文のロードとポーリング
  useEffect(() => {
    const fetchLatestStatuses = async () => {
      const stored = localStorage.getItem("fesorder_direct_orders");
      if (!stored) return;
      try {
        const orders = JSON.parse(stored);
        if (!orders.length) return;

        // 初期状態で即セット
        setDirectOrders((prev) => (prev.length === 0 ? orders : prev));

        const updated = await Promise.all(
          orders.map(async (o: any) => {
            try {
              const res = await fetch(`/api/orders/${o.orderId}`);
              if (!res.ok) return o;
              const data = await res.json();
              return { ...o, status: data.status };
            } catch {
              return o;
            }
          })
        );
        localStorage.setItem("fesorder_direct_orders", JSON.stringify(updated));
        setDirectOrders(updated);
      } catch (err) {
        console.error("Failed to sync direct orders status:", err);
      }
    };

    fetchLatestStatuses();
    const intervalId = setInterval(fetchLatestStatuses, 10000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const loadModHooks = async () => {
      try {
        const stored = localStorage.getItem("fesorder_direct_orders");
        const parsed = stored ? JSON.parse(stored) : [];
        const circleIds = Array.from(new Set(parsed.map((o: any) => o.circleId))) as string[];
        
        const hooks: { id: string; hook: any }[] = [];
        for (const cid of circleIds) {
          try {
            const circleData = await circleApi.get(cid);
            if (circleData && circleData.mods) {
              const modsPayload = JSON.parse(circleData.mods);
              Object.values(modsPayload.installed || {}).forEach((m: any) => {
                if (m.enabled && m.manifest.hooks?.myOrderBodyBottom) {
                  hooks.push({
                    id: m.manifest.id,
                    hook: m.manifest.hooks.myOrderBodyBottom,
                  });
                }
              });
            }
          } catch (e) {
            // Ignore individual fetch errors
          }
        }
        setModHooks(hooks);
      } catch (err) {
        console.error("Failed to load mod hooks:", err);
      }
    };
    loadModHooks();
  }, [directOrders.length]);

  const userId = isAuthenticated && authUserId ? authUserId : guestUserId;

  const isLoaded = isGuestLoaded && !authLoading;

  // 事前オーダー取得
  const { data: preOrders, isLoading: preOrdersLoading } = useQuery({
    queryKey: ["myPreOrders", userId],
    queryFn: () => preOrderApi.getByCode(userId),
    enabled: !!userId,
  });

  // ユーザー＆リストバンド状態取得
  const { data: userStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["userWristbandStatus", userId],
    queryFn: () => wristbandApi.lookup(userId),
    enabled: !!userId,
  });


  // リストバンド新規登録・再発行ミューテーション
  const registerMutation = useMutation({
    mutationFn: async (wbId: string) => {
      // 既存のアクティブなリストバンドがある場合、まず紛失ロックを行ってから登録する（乗っ取り防止制限をセルフ無効化で回避するため）
      if (activeWristband) {
        await wristbandApi.reportLost(activeWristband.id);
      }
      return await wristbandApi.register(userId, wbId);
    },
    onSuccess: () => {
      toast.success("リストバンドの紐付けを完了しました！");
      setIsRegisterOpen(false);
      setNewWristbandId("");
      queryClient.invalidateQueries({ queryKey: ["userWristbandStatus", userId] });
    },
    onError: (error: any) => {
      toast.error(error.message || "紐付けに失敗しました");
    },
  });

  // リストバンド紛失報告ミューテーション
  const reportLostMutation = useMutation({
    mutationFn: async (wbId: string) => {
      return await wristbandApi.reportLost(wbId);
    },
    onSuccess: () => {
      toast.warning("旧リストバンドを無効化（ロック）しました。スマホQRはそのままご利用いただけます。");
      queryClient.invalidateQueries({ queryKey: ["userWristbandStatus", userId] });
      setIsReportLostConfirmOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "紛失報告に失敗しました");
      setIsReportLostConfirmOpen(false);
    },
  });

  if (!isLoaded || preOrdersLoading || statusLoading) {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-4 font-mono">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const activeWristband = userStatus?.wristband;
  const targetWbId = activeWristband?.id || userId;
  // 来場者アプリと register(模擬店POS)は別オリジンのため、店頭スキャン用QRは
  // register(スタッフ)側の /checkin を指すよう VITE_STAFF_URL を優先する (2026-07-04 アプリ分離)
  const registerBase = (import.meta.env.VITE_STAFF_URL as string) || origin;
  const userCheckinUrl = registerBase ? `${registerBase}/checkin?wb=${targetWbId}` : targetWbId;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(
    userCheckinUrl
  )}`;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-4 space-y-4 sm:space-y-6 pb-24 font-mono">
      {eventData?.logoUrl && (
        <div className="border-thick border-border p-2 bg-background mb-4">
          <img
            src={eventData.logoUrl}
            alt={eventData.eventName}
            className="w-full h-auto max-h-32 object-contain mx-auto block"
          />
        </div>
      )}

      <button
        onClick={() => router.push("/menu")}
        className="text-xs uppercase tracking-widest underline hover:text-info flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        メニュー選択に戻る
      </button>

      <div className="border-b-thick border-border pb-4">
        <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
          [マイデジタルQR &amp; 注文履歴]
        </h1>
        <p className="text-xs uppercase tracking-widest text-gray-600 mt-1">
          店頭でこちらのQRまたはリストバンドをお見せください
        </p>
      </div>

      {/* リストバンド紛失・連携状態ステータスバー */}
      <div className="border-thick border-border bg-muted p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm">【リストバンド連携状態】:</span>
            {activeWristband ? (
              <span className="bg-success text-primary-foreground px-2 py-0.5 text-xs font-black uppercase">
                紐付け完了 ({activeWristband.id})
              </span>
            ) : (
              <span className="bg-primary text-primary-foreground px-2 py-0.5 text-xs font-black uppercase">
                未紐付け / スマホ運用中
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => setIsRegisterOpen(true)}
              className="h-9 border-thick border-border bg-background text-foreground text-xs font-bold uppercase rounded-none hover:bg-primary hover:text-primary-foreground"
            >
              <LinkIcon className="mr-1 h-3.5 w-3.5" />
              {activeWristband ? "再発行・付け替え" : "バンドを登録"}
            </Button>
            {activeWristband && (
              <Button
                onClick={() => setIsReportLostConfirmOpen(true)}
                disabled={reportLostMutation.isPending}
                className="h-9 border-thick border-border bg-error text-primary-foreground text-xs font-bold uppercase rounded-none hover:bg-primary"
              >
                <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                紛失報告 (ロック)
              </Button>
            )}
          </div>
        </div>

        {!activeWristband && (
          <div className="bg-background border-thick border-border p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-foreground shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">💡 スマホのままで大丈夫です！</span>
              <p className="text-gray-600 mt-0.5">
                リストバンドが無くなった場合や未紐付けでも、下記の「マイデジタルQR」を店頭でスタッフに見せればそのままお受取りいただけます。
              </p>
            </div>
          </div>
        )}
      </div>

      {/* リストバンド紐付けモーダル */}
      <Modal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        title="[リストバンド紐付け]"
        maxWidth="md"
      >
        <p className="text-xs text-gray-600">
          手元の物理リストバンドのQRコードをスキャンするか、IDを入力してください。
          {activeWristband && (
            <span className="block mt-1 font-bold text-error">
              ⚠️ 登録すると、現在のリストバンド ({activeWristband.id}) は自動的にロック（無効化）されます。
            </span>
          )}
        </p>
        <Input
          type="text"
          placeholder="リストバンドIDを入力 (例: wb_12345)"
          className="h-12 border-thick border-border text-base rounded-none"
          value={newWristbandId}
          onChange={(e) => setNewWristbandId(e.target.value)}
        />
        <Button
          onClick={() => {
            if (newWristbandId.trim()) {
              registerMutation.mutate(newWristbandId.trim());
            }
          }}
          disabled={registerMutation.isPending || !newWristbandId.trim()}
          className="w-full h-12 border-thick border-border bg-primary text-primary-foreground text-base font-bold uppercase rounded-none hover:bg-background hover:text-foreground"
        >
          紐付けを完了する
        </Button>
      </Modal>

      {/* リストバンド紛失報告 確認ダイアログ */}
      <ConfirmDialog
        isOpen={isReportLostConfirmOpen}
        title="[リストバンド紛失報告]"
        description="失くしたリストバンドを即時ロック・無効化しますか？この操作は取り消せません。"
        confirmLabel="ロックする"
        cancelLabel="キャンセル"
        destructive
        onConfirm={() => {
          if (activeWristband) {
            reportLostMutation.mutate(activeWristband.id);
          }
        }}
        onCancel={() => setIsReportLostConfirmOpen(false)}
      />

      {/* デジタルQRカード */}
      <Card className="border-heavy border-border bg-primary text-primary-foreground rounded-none p-4 sm:p-6 text-center shadow-none">
        <CardHeader className="p-0 mb-4">
          <div className="inline-block bg-background text-foreground px-3 py-1 text-xs font-black uppercase tracking-widest mx-auto">
            MEMBER DIGITAL QR
          </div>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          <div className="bg-background p-3 sm:p-4 inline-block border-thick border-background mx-auto">
            <img
              src={qrImageUrl}
              alt="My Digital QR"
              width={180}
              height={180}
              className="mx-auto block"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-gray-400 uppercase tracking-widest">
              USER ID (呼出しID: #{userStatus?.user.displayId || "---"})
            </p>
            <p className="text-base sm:text-xl font-bold tracking-wider break-all px-2">{userId}</p>
          </div>
        </CardContent>
      </Card>

      {/* 外部モッドの動的インジェクション (マイオーダー画面用) */}
      {modHooks.map((m) => {
        const { id, hook } = m;
        return (
          <div key={`${id}-body-bottom`} className="w-full">
            <ModSandbox
              modId={id}
              hookName="myOrderBodyBottom"
              html={typeof hook === "string" ? hook : undefined}
              jsUrl={typeof hook === "object" ? hook.js : undefined}
              cssUrl={typeof hook === "object" ? hook.css : undefined}
              data={directOrders}
            />
          </div>
        );
      })}

      {/* 事前オーダー履歴一覧 */}
      <div className="space-y-4">
        <h2 className="text-2xl font-black uppercase border-b-thick border-border pb-2">
          [事前オーダー状況]
        </h2>

        {preOrders && preOrders.length > 0 ? (
          <div className="space-y-4">
            {preOrders.map((po) => (
              <div
                key={po.id}
                className="border-thick border-border bg-background p-5 space-y-3"
              >
                <div className="flex justify-between items-start border-b-[2px] border-border pb-2">
                  <div className="flex items-center gap-2">
                    {po.status === "pending" ? (
                      <span className="bg-warning text-foreground border-thin border-border px-2 py-0.5 text-xs font-black uppercase flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> 店頭未受取
                      </span>
                    ) : (
                      <span className="bg-success text-primary-foreground px-2 py-0.5 text-xs font-black uppercase flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 受取完了
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {new Date(po.createdAt).toLocaleTimeString("ja-JP")}
                    </span>
                  </div>
                  <span className="text-xl font-black">
                    ¥{po.totalPrice.toLocaleString()}
                  </span>
                </div>

                <div className="bg-muted p-3 border-thick border-border">
                  <ul className="divide-y divide-border/10 text-sm">
                    {po.items.map((item) => (
                      <li key={item.id} className="py-1 flex justify-between">
                        <span className="font-bold">{item.menu?.name || "メニュー"}</span>
                        <span>x {item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-thick border-dashed border-border p-8 text-center text-muted-foreground">
            現在、未処理の事前オーダーはありません。
          </div>
        )}
      </div>
    </div>
  );
}

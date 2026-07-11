
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { preOrderApi, wristbandApi, circleApi, eventApi } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { ModSandbox } from "@/components/ModSandbox";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  QrCode,
} from "lucide-react";

export default function MyOrderPage() {
  const navigate = useNavigate();
  // 来場者は eventUser.id ベアラーのみ (旧 useAuth/useGuestUser シムは撤去済み)
  const { session, userId: visitorUserId, isLoaded } = useVisitor();
  const eventId = session?.eventId;

  // eventData はヘッダーのロゴ表示のみに使う装飾的な値。取得失敗時は
  // `eventData?.logoUrl` が undefined のままロゴ非表示になるだけで画面は成立するため、
  // isError/ErrorState は追加しない (判断: 2026-07-07)。
  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId!),
    enabled: !!eventId,
  });
  // 2026-07-11: リストバンドの登録/再発行/紛失報告はスマホ(来場者)側から行えないよう撤去。
  // 発行・再発行・紛失処理はすべて本部(イベント管理)側で行う方針にしたため、
  // 関連する登録モーダル/確認ダイアログ用の state も削除した。
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

  const userId = visitorUserId ?? "";

  // 事前オーダー取得
  const {
    data: preOrders,
    isLoading: preOrdersLoading,
    isError: preOrdersError,
    error: preOrdersErrorObj,
    refetch: refetchPreOrders,
  } = useQuery({
    queryKey: ["myPreOrders", userId],
    queryFn: () => preOrderApi.getByCode(userId),
    enabled: !!userId,
  });

  // ユーザー＆リストバンド状態取得
  const {
    data: userStatus,
    isLoading: statusLoading,
    isError: statusError,
    error: statusErrorObj,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ["userWristbandStatus", userId],
    queryFn: () => wristbandApi.lookup(userId),
    enabled: !!userId,
  });


  // 2026-07-11: リストバンドの登録/再発行/紛失報告ミューテーションを撤去。
  // これらの操作は本部(イベント管理 → リストバンド紛失のロック・再発行処理)側でのみ行う。

  if (!isLoaded || preOrdersLoading || statusLoading) {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-4 font-mono">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  // userStatus はマイQR・リストバンド状態など画面全体の前提になるため取得失敗時はページ全体を止める。
  // preOrders は下部の履歴セクションのみに影響するため、そちらは該当セクション内で個別に表示する。
  if (statusError) {
    return (
      <div className="max-w-3xl mx-auto p-4 font-mono">
        <ErrorState
          error={statusErrorObj}
          title="ユーザー情報の取得に失敗しました"
          onRetry={() => refetchStatus()}
        />
      </div>
    );
  }

  const activeWristband = userStatus?.wristband;
  const targetWbId = activeWristband?.id || userId;
  // 来場者アプリと register(模擬店POS)は別オリジンのため、店頭スキャン用QRは
  // register(スタッフ)側の /checkin を指すよう VITE_STAFF_URL を優先する (2026-07-04 アプリ分離)
  const registerBase = (import.meta.env.VITE_STAFF_URL as string) || origin;
  // 単一ドメイン化 (2026-07-07): 店頭スキャンは /circle/checkin へ移設
  const userCheckinUrl = registerBase ? `${registerBase}/circle/checkin?wb=${targetWbId}` : targetWbId;
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
        onClick={() => navigate("/menu")}
        className="text-xs uppercase tracking-widest underline hover:text-info flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        メニュー選択に戻る
      </button>

      <div className="border-b-thick border-border pb-4">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tight leading-tight">
          [マイデジタルQR &amp; 注文履歴]
        </h1>
        <p className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground mt-1">
          店頭でこちらのQRまたはリストバンドをお見せください
        </p>
      </div>

      {/* リストバンド未登録の案内。
          2026-07-11: 「連携状態」の常時表示と、スマホからの自己登録/紛失報告UIは撤去した。
          リストバンドの発行・紐付け・再発行・紛失処理はすべて本部(受付/イベント管理)で行う。
          物理リストバンドがまだ紐付いていない場合のみ、本部での登録を案内する。
          スマホ画面のQR(下のマイデジタルQR)はそのまま利用できる。 */}
      {!activeWristband && (
        <div className="border-thick border-border bg-muted p-4 flex items-start gap-3">
          <QrCode className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-sm">リストバンドが未登録です</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              リストバンドは受付・本部でお渡しします。受付で発行された来場登録QR（またはリストバンドのQR）を読み取ると登録できます。
              登録すると、なくしても本部で再発行できます。下の「マイデジタルQR」はそのままご利用いただけます。
            </p>
          </div>
        </div>
      )}

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
            <p className="text-xs text-primary-foreground/70 uppercase tracking-widest">
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
        <h2 className="text-xl sm:text-2xl font-black uppercase border-b-thick border-border pb-2">
          [事前オーダー状況]
        </h2>

        {preOrdersError ? (
          <ErrorState error={preOrdersErrorObj} onRetry={() => refetchPreOrders()} />
        ) : preOrders && preOrders.length > 0 ? (
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
                    <span className="text-xs text-muted-foreground">
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
          <EmptyState icon={Clock} message="現在、未処理の事前オーダーはありません" />
        )}
      </div>

      {/* 店頭注文 (代引) 履歴一覧。
          2026-07-11: 従来 directOrders は ModSandbox に渡すだけで画面に出ておらず、
          店頭でその場注文した履歴が来場者から見えなかった。localStorage に貯めている
          代引注文 (呼出番号つき) を注文履歴として可視化する。 */}
      {directOrders.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl sm:text-2xl font-black uppercase border-b-thick border-border pb-2">
            [店頭注文の状況]
          </h2>
          <div className="space-y-4">
            {directOrders
              .slice()
              .reverse()
              .map((o) => {
                const status = o.status as string | undefined;
                const badge =
                  status === "completed"
                    ? { cls: "bg-success text-primary-foreground", icon: CheckCircle2, label: "受取完了" }
                    : status === "preparing"
                      ? { cls: "bg-info text-primary-foreground", icon: Clock, label: "調理中" }
                      : { cls: "bg-warning text-foreground border-thin border-border", icon: Clock, label: "受付済み" };
                const Icon = badge.icon;
                return (
                  <div
                    key={o.orderId}
                    className="border-thick border-border bg-background p-5 space-y-3"
                  >
                    <div className="flex justify-between items-start border-b-[2px] border-border pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 text-xs font-black uppercase flex items-center gap-1 ${badge.cls}`}>
                          <Icon className="h-3.5 w-3.5" /> {badge.label}
                        </span>
                        {o.orderNumber != null && (
                          <span className="bg-foreground text-background px-2 py-0.5 text-xs font-black uppercase">
                            呼出 #{o.orderNumber}
                          </span>
                        )}
                        {o.createdAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(o.createdAt).toLocaleTimeString("ja-JP")}
                          </span>
                        )}
                      </div>
                      {o.totalPrice != null && (
                        <span className="text-xl font-black">
                          ¥{Number(o.totalPrice).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-bold flex items-center gap-2">
                      <span className="text-muted-foreground font-normal">店舗:</span>
                      {o.circleName || "サークル"}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

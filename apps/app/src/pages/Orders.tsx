import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { preOrderApi, circleApi } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { ModSandbox } from "@/components/ModSandbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, CheckCircle2, Receipt } from "lucide-react";

/**
 * 来場者の注文履歴 (2026-07-11 マイページから分離)。
 *
 * 従来 MyPage に同居していた「事前オーダー」「店頭注文(代引)」「モッド差し込み」を
 * このルート (/visitor/orders) に切り出し、MyPage はマイQR/身分表示に専念させる。
 * 来場者は eventUser.id ベアラーのみで参照する (認証会員ではない)。
 */
export default function OrdersPage() {
  const navigate = useNavigate();
  const { userId: visitorUserId, isLoaded } = useVisitor();
  const userId = visitorUserId ?? "";

  const [modHooks, setModHooks] = useState<{ id: string; hook: any }[]>([]);
  const [directOrders, setDirectOrders] = useState<any[]>([]);

  // 代引き注文のロードとポーリング (localStorage に貯めた店頭注文の状態を更新)
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

  // 店頭注文があるサークルの myOrderBodyBottom モッドフックを読み込む
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

  if (!isLoaded || preOrdersLoading) {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-4 font-mono">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const hasPreOrders = !!preOrders && preOrders.length > 0;
  const hasDirectOrders = directOrders.length > 0;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-4 space-y-4 sm:space-y-6 pb-24 font-mono">
      <button
        onClick={() => navigate("/visitor/mypage")}
        className="text-xs uppercase tracking-widest underline hover:text-info flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        マイQRに戻る
      </button>

      <div className="border-b-thick border-border pb-4">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tight leading-tight flex items-center gap-2">
          <Receipt className="h-6 w-6 shrink-0" />
          [注文履歴]
        </h1>
        <p className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground mt-1">
          事前オーダーと店頭注文の状況を確認できます
        </p>
      </div>

      {/* どちらも無いときは1つの空状態にまとめる */}
      {!hasPreOrders && !hasDirectOrders && !preOrdersError ? (
        <EmptyState icon={Receipt} message="まだ注文履歴はありません" />
      ) : null}

      {/* 事前オーダー履歴一覧 */}
      {(hasPreOrders || preOrdersError) && (
        <div className="space-y-4">
          <h2 className="text-lg sm:text-2xl font-black uppercase border-b-thick border-border pb-2">
            [事前オーダー状況]
          </h2>

          {preOrdersError ? (
            <ErrorState error={preOrdersErrorObj} onRetry={() => refetchPreOrders()} />
          ) : (
            <div className="space-y-4">
              {preOrders!.map((po) => (
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
          )}
        </div>
      )}

      {/* 店頭注文 (代引) 履歴一覧 */}
      {hasDirectOrders && (
        <div className="space-y-4">
          <h2 className="text-lg sm:text-2xl font-black uppercase border-b-thick border-border pb-2">
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
    </div>
  );
}

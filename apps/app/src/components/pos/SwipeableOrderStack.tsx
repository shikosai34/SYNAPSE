import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, CheckCircle, Clock, Users, XCircle } from "lucide-react";
import { displayOrderNumber } from "@/lib/order-number";
import { useSessionState } from "@/hooks/useSessionState";

export interface SwipeableOrder {
  id: string;
  orderNumber: string;
  createdAt: string | Date | null;
  status: string;
  receivedAt?: string | Date | null;
  source?: "pos" | "mobile";
  paymentStatus?: "paid" | "unpaid" | "refunded";
  paymentMethod?: string | null;
  refund?: {
    amount: number;
    originalPaymentMethod: string | null;
    refundedBy: string | null;
    refundedAt: string | Date;
  } | null;
  totalPrice?: number;
  peopleCount?: number;
  items: Array<{
    id: string;
    menuName: string;
    quantity: number;
    menuPrice?: number;
    toppings?: Array<{
      id: string;
      toppingName: string;
      price: number;
      category?: string;
      sortOrder?: number;
    }>;
  }>;
}

interface SwipeableOrderStackProps {
  orders: SwipeableOrder[];
  paymentMethods: string[];
  paymentMethodsReady: boolean;
  scrollStateKey: string;
  openAtLatest?: boolean;
  onStart: (id: string) => Promise<unknown>;
  onComplete: (id: string) => Promise<unknown>;
  onMarkReceived: (id: string) => Promise<unknown>;
  onCancelRequest: (order: SwipeableOrder) => void;
  onSettleRequest: (order: SwipeableOrder, paymentMethod: string) => void;
  cancelAnimationOrderId?: string | null;
  isUpdating?: boolean;
}

const EXIT_ANIMATION_MS = 300;

function orderTime(date: string | Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  const config: Record<string, { label: string; variant: "default" | "warning" | "active" | "error" }> = {
    pending: { label: "未着手", variant: "default" },
    preparing: { label: "調理中", variant: "warning" },
    ready: { label: "受け取り待ち", variant: "active" },
    completed: { label: "完成", variant: "active" },
    cancelled: { label: "キャンセル", variant: "error" },
  };
  return config[status] ?? { label: status, variant: "default" as const };
}

function orderAction(status: string): { label: string; icon: typeof Clock; kind: "start" | "complete" } | null {
  if (status === "pending") return { label: "調理開始", icon: Clock, kind: "start" };
  if (status === "preparing") return { label: "完成", icon: CheckCircle, kind: "complete" };
  return null;
}

function groupedToppings(toppings: NonNullable<SwipeableOrder["items"][number]["toppings"]>) {
  const groups = new Map<string, typeof toppings>();
  for (const topping of toppings) {
    const category = topping.category?.trim() || "未分類";
    groups.set(category, [...(groups.get(category) ?? []), topping]);
  }
  // 2026-10-16: 管理画面で調整したトッピング順をカテゴリの出現順にも反映する。
  return [...groups.entries()]
    .map(([category, options]) => ({
      category,
      firstSortOrder: Math.min(...options.map((option) => option.sortOrder ?? 0)),
      options: [...options].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.toppingName.localeCompare(b.toppingName, "ja")),
    }))
    .sort((a, b) => a.firstSortOrder - b.firstSortOrder || a.category.localeCompare(b.category, "ja"))
    .map(({ category, options }) => [category, options] as const);
}

function KitchenOrderCard({
  order,
  paymentMethods,
  paymentMethodsReady,
  isUpdating,
  onStart,
  onComplete,
  onMarkReceived,
  onCancelRequest,
  onSettleRequest,
  cancelAnimationOrderId,
}: {
  order: SwipeableOrder;
  paymentMethods: string[];
  paymentMethodsReady: boolean;
  isUpdating: boolean;
  onStart: () => Promise<unknown>;
  onComplete: () => Promise<unknown>;
  onMarkReceived: () => Promise<unknown>;
  onCancelRequest: () => void;
  onSettleRequest: (paymentMethod: string) => void;
  cancelAnimationOrderId?: string | null;
}) {
  const actionTimer = useRef<number | null>(null);
  const [exitDirection, setExitDirection] = useState<"up" | "down" | null>(null);
  const [elapsedClock, setElapsedClock] = useState(() => Date.now());
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(order.paymentMethod ?? "");
  const orderPaymentMethod = order.paymentMethod && paymentMethods.includes(order.paymentMethod) ? order.paymentMethod : "";
  const selectedMethod = orderPaymentMethod || (paymentMethods.includes(selectedPaymentMethod) ? selectedPaymentMethod : "") || (paymentMethods.length === 1 ? paymentMethods[0]! : "");
  const action = orderAction(order.status);
  const isAwaitingPickup = (order.status === "ready" || order.status === "completed") && !order.receivedAt;
  const badge = order.receivedAt
    ? { label: "受け渡し済み", variant: "active" as const }
    : order.status === "completed"
      ? { label: "受け取り待ち", variant: "active" as const }
      : statusBadge(order.status);
  // 2026-10-22: APIと同じく受け取り待ちでも取消を選べるようにし、会計済みなら返金確認を通す。
  const canCancel = order.status === "pending" || order.status === "preparing" || order.status === "ready";
  const tracksElapsedTime = order.status === "pending" || order.status === "preparing";
  // 2026-10-25: 厨房作業への注意をそらさないよう、未着手・調理中の経過秒数を10秒ごとにだけ更新する。
  useEffect(() => {
    if (!tracksElapsedTime) return;
    const timer = window.setInterval(() => setElapsedClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [tracksElapsedTime]);
  const createdAtMs = order.createdAt ? new Date(order.createdAt).getTime() : Number.NaN;
  const elapsedSeconds = tracksElapsedTime && Number.isFinite(createdAtMs)
    ? Math.floor(Math.max(0, elapsedClock - createdAtMs) / 10_000) * 10
    : null;

  const performAction = async () => {
    try {
      if (action?.kind === "start") await onStart();
      else if (action?.kind === "complete") await onComplete();
    } catch {
      // 2026-10-17: 失敗通知は親のMutationが表示し、カードは操作可能な状態へ戻す。
    } finally {
      setExitDirection(null);
    }
  };

  useEffect(() => {
    if (cancelAnimationOrderId === order.id) setExitDirection("down");
    else setExitDirection((direction) => direction === "down" ? null : direction);
  }, [cancelAnimationOrderId, order.id]);

  useEffect(() => {
    if (selectedPaymentMethod && !paymentMethods.includes(selectedPaymentMethod)) setSelectedPaymentMethod("");
    else if (!selectedPaymentMethod && paymentMethods.length === 1) setSelectedPaymentMethod(paymentMethods[0]!);
  }, [paymentMethods, selectedPaymentMethod]);

  useEffect(() => () => {
    if (actionTimer.current !== null) window.clearTimeout(actionTimer.current);
  }, []);

  // 2026-10-25: 完了とキャンセルは誤操作を避けるため、カード上の明示ボタンだけで受け付ける。
  return (
    <Card
      className={`relative flex h-full flex-col border-thick border-border bg-background transition-[transform,opacity,background-color] duration-300 ease-in-out motion-reduce:transition-none snap-start ${exitDirection === "up" ? "-translate-y-8 bg-success/30 opacity-0" : exitDirection === "down" ? "translate-y-8 bg-destructive/30 opacity-0" : ""}`}
      data-order-id={order.id}
      role="group"
      aria-label={`注文 ${displayOrderNumber(order.orderNumber)}、${badge.label}`}
    >
      <CardHeader className="border-b-thin border-border p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="font-headline text-2xl uppercase leading-none sm:text-3xl">#{displayOrderNumber(order.orderNumber)}</CardTitle>
              <CardDescription className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
                <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{orderTime(order.createdAt)}</span>
                {order.peopleCount != null && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{order.peopleCount}名</span>}
                {/* 2026-10-17: 厨房では注文受付元をカード上で即時判別できるようにする。 */}
                <span className="inline-flex rounded-none border-thin border-border bg-background px-1.5 py-0 text-[10px] font-semibold uppercase tracking-[1px]">
                  {order.source === "mobile" ? "モバイル注文" : "レジ注文"}
                </span>
                <span>{order.items.length}品目</span>
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {elapsedSeconds !== null && (
                <span className="font-mono text-xs font-bold tabular-nums text-muted-foreground sm:text-sm" aria-label={`注文受付から${elapsedSeconds}秒`}>
                  {elapsedSeconds}秒
                </span>
              )}
              <Badge variant={badge.variant} className="shrink-0">{badge.label}</Badge>
            </div>
          </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 p-3 sm:p-4">
        {order.items.map((item) => (
          <section key={item.id} className="border-b-thin border-border pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-start gap-3">
              {/* 2026-10-16: 視覚用の「×N」と読み上げ用の数量表現を分け、注文数の誤認を防ぐ。 */}
              <span className="flex h-12 min-w-14 shrink-0 items-center justify-center border-thick border-primary bg-primary px-2 font-headline text-xl leading-none text-primary-foreground" aria-hidden="true">
                ×{item.quantity}
              </span>
              <span className="sr-only">数量 {item.quantity} 個</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="break-words text-base font-black leading-snug sm:text-lg">{item.menuName}</h3>
                  {item.menuPrice != null && <span className="shrink-0 font-mono text-xs text-muted-foreground">¥{(item.menuPrice * item.quantity).toLocaleString()}</span>}
                </div>
                {item.toppings && item.toppings.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {groupedToppings(item.toppings).map(([category, toppings]) => (
                      <div key={category}>
                        <p className="mb-1 font-mono text-xs font-black uppercase tracking-wider text-muted-foreground">{category}</p>
                        <ul className="space-y-1 border-l-thick border-border pl-2">
                          {toppings.map((topping) => (
                            <li key={topping.id} className="flex items-start justify-between gap-2 text-xs font-bold">
                              <span className="break-words">{topping.toppingName}</span>
                              <span className="shrink-0 font-mono text-xs text-muted-foreground">各{item.quantity}個分</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
        <div className="flex items-center justify-between border-t-thick border-border pt-3 font-mono">
          <span className="text-xs font-bold uppercase">合計</span>
          <span className="font-headline text-xl tabular-nums">¥{(order.totalPrice ?? 0).toLocaleString()}</span>
        </div>
        {order.paymentStatus === "refunded" && order.refund && (
          <div role="status" className="space-y-1 border-thick border-warning bg-warning/10 p-3 text-xs">
            <p className="font-black">返金済み · ¥{order.refund.amount.toLocaleString()}</p>
            <p>返金日時: {new Date(order.refund.refundedAt).toLocaleString("ja-JP")}</p>
            {order.refund.originalPaymentMethod && <p>元の決済方法: {order.refund.originalPaymentMethod}</p>}
            {order.refund.refundedBy && <p>返金記録者: {order.refund.refundedBy}</p>}
          </div>
        )}
        {order.paymentStatus === "unpaid" && (
          <div role="status" className="border-thick border-warning bg-warning/10 p-3 text-xs font-black">
            未決済 · ¥{(order.totalPrice ?? 0).toLocaleString()}
          </div>
        )}
      </CardContent>

      <CardFooter className="grid grid-cols-1 gap-2 border-t-thin border-border p-3 sm:grid-cols-2 sm:p-4">
        {isAwaitingPickup ? (
          <Button
            onClick={() => void onMarkReceived()}
            disabled={isUpdating}
            aria-label={`注文${displayOrderNumber(order.orderNumber)}を受け渡し済みにする`}
            className="h-12 w-full border-thick border-border bg-success font-mono font-black uppercase text-white hover:bg-success/90 sm:col-span-2"
          >
            <CheckCircle className="mr-2 h-4 w-4" />受け渡し済み
          </Button>
        ) : action ? (
          <Button
            onClick={() => {
              setExitDirection("up");
              actionTimer.current = window.setTimeout(() => void performAction(), EXIT_ANIMATION_MS);
            }}
            disabled={isUpdating || exitDirection !== null}
            aria-label={`注文${displayOrderNumber(order.orderNumber)}を${action.label}`}
            className="h-12 w-full border-thick border-border font-mono font-black uppercase"
          >
            <action.icon className="mr-2 h-4 w-4" />{action.label}
          </Button>
        ) : (
          <Button disabled variant="outline" className="h-12 w-full border-thick border-border font-mono font-bold uppercase sm:col-span-2">
            {order.receivedAt ? <><CheckCircle className="mr-2 h-4 w-4" />受け渡し済み</> : order.status === "completed" ? <><CheckCircle className="mr-2 h-4 w-4" />受け取り待ち</> : order.status === "cancelled" ? <><XCircle className="mr-2 h-4 w-4" />キャンセル済み</> : badge.label}
          </Button>
        )}
        {canCancel && (
          <Button
            variant="outline"
            onClick={onCancelRequest}
            disabled={isUpdating || exitDirection !== null}
            aria-label={`注文${displayOrderNumber(order.orderNumber)}をキャンセル`}
            className="h-12 w-full border-thick border-destructive font-mono font-bold text-destructive hover:bg-destructive hover:text-primary-foreground"
          >
            <XCircle className="mr-2 h-4 w-4" />キャンセル
          </Button>
        )}
        {order.source === "mobile" && order.paymentStatus === "unpaid" && order.status !== "cancelled" && (
          <div className="sm:col-span-2">
            {!paymentMethodsReady ? (
              <p className="mb-2 font-mono text-xs font-bold text-muted-foreground">受取方法を確認中です。</p>
            ) : paymentMethods.length > 1 ? (
              <label className="mb-2 block font-mono text-xs font-bold">
                受取方法
                <select
                  value={selectedMethod}
                  onChange={(event) => setSelectedPaymentMethod(event.target.value)}
                  disabled={isUpdating}
                  className="mt-1 h-11 w-full border-thick border-border bg-background px-3 text-sm"
                >
                  <option value="">受取方法を選択</option>
                  {paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </label>
            ) : selectedMethod ? (
              <p className="mb-2 font-mono text-xs font-bold">受取方法: {selectedMethod}</p>
            ) : (
              <p role="alert" className="mb-2 border-thick border-warning bg-warning/10 p-2 text-xs font-bold">受取方法を読み込めません。レジで記録してください。</p>
            )}
            <Button
              variant="outline"
              onClick={() => onSettleRequest(selectedMethod)}
              disabled={isUpdating || !paymentMethodsReady || !selectedMethod}
              aria-label={`注文${displayOrderNumber(order.orderNumber)}の料金を受け取ったと記録する`}
              className="h-12 w-full border-thick border-success font-mono font-bold text-success hover:bg-success hover:text-white"
            >
              料金を受け取った
            </Button>
          </div>
        )}
      </CardFooter>

    </Card>
  );
}

export function SwipeableOrderStack({
  orders,
  paymentMethods,
  paymentMethodsReady,
  scrollStateKey,
  openAtLatest = false,
  onStart,
  onComplete,
  onMarkReceived,
  onCancelRequest,
  onSettleRequest,
  cancelAnimationOrderId,
  isUpdating = false,
}: SwipeableOrderStackProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimer = useRef<number | null>(null);
  const hasProcessedOrders = useRef(false);
  const previousOrderIds = useRef("");
  const previousOpenAtLatest = useRef(false);
  const [savedScrollLeft, setSavedScrollLeft] = useSessionState<number | null>(scrollStateKey, null);
  const savedScrollLeftRef = useRef(savedScrollLeft);
  savedScrollLeftRef.current = savedScrollLeft;
  const ordered = useMemo(() => [...orders].sort((a, b) => {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return at - bt || a.orderNumber.localeCompare(b.orderNumber, "ja", { numeric: true });
  }), [orders]);
  const orderIds = ordered.map((order) => order.id).join(",");
  const currentOrder = openAtLatest
    ? undefined
    : ordered.find((order) => order.status === "pending" || order.status === "preparing");

  // 2026-10-21: 厨房を離れて戻った時は横並び注文の見ていた位置を先に復元する。
  useLayoutEffect(() => {
    const position = savedScrollLeftRef.current;
    if (position === null) return;
    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = position;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollStateKey]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const saveScroll = () => {
      if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current);
      scrollSaveTimer.current = window.setTimeout(() => {
        setSavedScrollLeft(element.scrollLeft);
        scrollSaveTimer.current = null;
      }, 120);
    };
    element.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", saveScroll);
      if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current);
      // 画面切替直前にも同期保存し、debounce の待ち時間で位置が失われないようにする。
      try { window.sessionStorage.setItem(scrollStateKey, JSON.stringify(element.scrollLeft)); } catch { /* 保存不可でも通常操作を続ける */ }
      scrollSaveTimer.current = null;
    };
  }, [scrollStateKey, setSavedScrollLeft]);

  // 2026-10-25: 作業中の状態は最古の注文を見せ、その他の履歴は最新側から確認できるようにする。
  useEffect(() => {
    if (
      previousOrderIds.current === orderIds &&
      previousOpenAtLatest.current === openAtLatest
    ) return;
    const firstOrderRender = !hasProcessedOrders.current;
    previousOrderIds.current = orderIds;
    previousOpenAtLatest.current = openAtLatest;
    hasProcessedOrders.current = true;
    // 保存位置がある初回表示では、下の自動フォーカス移動を止める。
    if (firstOrderRender && savedScrollLeft !== null) return;
    const frame = window.requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      if (openAtLatest || !currentOrder) {
        element.scrollLeft = element.scrollWidth;
        return;
      }
      const focusedOrder = currentOrder && element.querySelector<HTMLElement>(`[data-order-id="${CSS.escape(currentOrder.id)}"]`);
      if (!focusedOrder) {
        element.scrollLeft = element.scrollWidth;
        return;
      }
      const orderRect = focusedOrder.getBoundingClientRect();
      const listRect = element.getBoundingClientRect();
      element.scrollTo({
        left: element.scrollLeft + orderRect.left - listRect.left - (element.clientWidth - orderRect.width) / 2,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentOrder?.id, openAtLatest, orderIds, savedScrollLeft]);

  return (
    <section className="space-y-3" aria-label="厨房の注文一覧">
      <div className="flex flex-col gap-3 border-b-thick border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-xs font-black uppercase tracking-wider">{ordered.length}件の注文</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ordered.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => scrollRef.current?.scrollBy({ left: -360, behavior: "smooth" })} className="border-thick border-border font-mono" aria-label="古い注文へ">
                <ArrowLeft className="mr-1 h-4 w-4" />古い注文
              </Button>
              <Button variant="outline" size="sm" onClick={() => scrollRef.current?.scrollBy({ left: 360, behavior: "smooth" })} className="border-thick border-border font-mono" aria-label="新しい注文へ">
                新しい注文<ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
      <div
        ref={scrollRef}
        className={ordered.length > 0 ? "flex snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overscroll-x-contain pb-3 [scrollbar-width:thin]" : "flex items-stretch gap-3"}
      >
        {ordered.length === 0 ? (
          <Card className="w-full shrink-0 border-thick border-dashed border-border">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <CheckCircle className="mb-4 h-12 w-12 text-muted-foreground/40" />
              <p className="font-headline text-xl uppercase text-muted-foreground">注文はありません</p>
              <p className="mt-2 text-center font-mono text-xs text-muted-foreground">この状態の注文が入るとここに表示されます。</p>
            </CardContent>
          </Card>
        ) : ordered.map((order) => (
          <div
            key={order.id}
            data-order-id={order.id}
            className="w-[min(88vw,26rem)] shrink-0 snap-start"
          >
            <KitchenOrderCard
              order={order}
              paymentMethods={paymentMethods}
              paymentMethodsReady={paymentMethodsReady}
              isUpdating={isUpdating}
              onStart={() => onStart(order.id)}
              onComplete={() => onComplete(order.id)}
              onMarkReceived={() => onMarkReceived(order.id)}
              onCancelRequest={() => onCancelRequest(order)}
              onSettleRequest={(paymentMethod) => onSettleRequest(order, paymentMethod)}
              cancelAnimationOrderId={cancelAnimationOrderId}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

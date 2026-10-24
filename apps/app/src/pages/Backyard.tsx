
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard, useAuth } from "@/hooks/useCircleAuth";
import { circleApi, eventApi, orderApi, parseCircleSettings, parseEventPaymentMethods, toppingApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { toast } from "sonner";
import { ChevronDown, Monitor } from "lucide-react";
import { SwipeableOrderStack, type SwipeableOrder } from "@/components/pos/SwipeableOrderStack";
import { useSessionState } from "@/hooks/useSessionState";
import { queryCachePolicy } from "@/lib/query-cache-policy";
import { undoableAction } from "@/lib/toast-undo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function BackyardPageContent() {
  // 2026-07-16: circleId を useState+useEffect(mount時一度きり) で固定していると、
  // 同一パス上でスペース切り替え後も古いサークルの注文一覧のまま表示され続ける。
  // useAuth() (authChange 購読で常に最新値) に統一する。
  const { circleId: authCircleId } = useAuth();
  const circleId = authCircleId ?? "";
  const orderNumberDisplayWindow = useRef<Window | null>(null);
  // 2026-10-25: 厨房は未着手から表示し、旧「対応中」保存値も未着手へ読み替える。
  const [selectedStatus, setSelectedStatus] = useSessionState<string>(`fesflow:backyard:${circleId || "unselected"}:status`, "pending");
  // 2026-10-25: 以前の「その他」選択は一覧全体へ読み替え、隠れていた状態を個別選択できるようにする。
  const activeStatus = ["pending", "preparing", "pickup", "all", "received", "cancelled"].includes(selectedStatus)
    ? selectedStatus
    : selectedStatus === "other" ? "all" : "pending";
  const [showUnpaidOnly, setShowUnpaidOnly] = useSessionState<boolean>(`fesflow:backyard:${circleId || "unselected"}:unpaid-only`, false);
  // 注文キャンセルの確認ダイアログ用
  const [pendingCancel, setPendingCancel] = useState<Pick<SwipeableOrder, "id" | "orderNumber" | "totalPrice" | "status" | "paymentStatus" | "paymentMethod"> | null>(
    null
  );
  const [cancelAnimationOrderId, setCancelAnimationOrderId] = useState<string | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<{ id: string; orderNumber: string; totalPrice?: number; paymentMethod: string } | null>(null);
  const [pendingUndoActions, setPendingUndoActions] = useState(0);
  const queryClient = useQueryClient();

  const {
    data: orders,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["orders", circleId],
    // 2026-10-25: 「その他」と未決済の絞り込みを状態に関係なく組み合わせられるよう全件を取得する。
    queryFn: () => orderApi.list(circleId),
    enabled: !!circleId,
    // 2026-10-25: 取り消し猶予中にポーリングで楽観表示を戻さないよう、確定後に再開する。
    refetchInterval: pendingUndoActions > 0 ? false : 5000,
    ...queryCachePolicy.live,
  });

  const { data: toppings } = useQuery({
    queryKey: ["toppings", circleId, false],
    queryFn: () => toppingApi.list(circleId),
    enabled: !!circleId,
    ...queryCachePolicy.catalog,
  });

  const { data: circle } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
  });
  const { data: event } = useQuery({
    queryKey: ["event", circle?.eventId],
    queryFn: () => eventApi.get(circle!.eventId),
    enabled: !!circle?.eventId,
  });
  // 2026-10-25: 厨房の未決済記録もレジと同じ、イベント・サークル双方が許可する方法だけを表示する。
  const eventPaymentMethods = parseEventPaymentMethods(event?.paymentMethods);
  const circlePaymentMethods = parseCircleSettings(circle?.settings).acceptedPayments;
  const acceptedPaymentMethods = circlePaymentMethods.length > 0
    ? circlePaymentMethods.filter((method) => eventPaymentMethods.includes(method))
    : eventPaymentMethods;
  const paymentMethods = acceptedPaymentMethods.length > 0 ? acceptedPaymentMethods : eventPaymentMethods;
  const paymentMethodsReady = !!circle && !!event;

  const updateStatus = useMutation({
    mutationFn: async (input: {
      id: string;
      status: "pending" | "preparing" | "ready" | "completed" | "cancelled";
      refundConfirmed?: boolean;
      silent?: boolean;
    }) => {
      return await orderApi.updateStatus(input.id, input.status, { refundConfirmed: input.refundConfirmed });
    },
    onSuccess: (_result, input) => {
      if (!input.silent) toast.success(input.refundConfirmed ? "全額返金を記録し、注文を取り消しました" : "注文ステータスを更新しました");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "更新に失敗しました");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const completeOrder = useMutation({
    mutationFn: async (input: { id: string; silent?: boolean }) => {
      return await orderApi.complete(input.id);
    },
    onSuccess: (_result, input) => {
      if (!input.silent) toast.success("注文を完了しました!");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "完了処理に失敗しました");
    },
  });

  const markReceived = useMutation({
    mutationFn: (input: { id: string; silent?: boolean }) => orderApi.markReceived(input.id),
    onSuccess: (_result, input) => {
      if (!input.silent) toast.success("受け渡し済みにしました");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["projector-orders"] });
      queryClient.invalidateQueries({ queryKey: ["myOrders"] });
    },
    onError: (error: any) => toast.error(error.message || "受け渡し状態を更新できませんでした"),
  });

  const settleOrder = useMutation({
    mutationFn: (input: { id: string; paymentMethod: string }) => orderApi.settleMobile(input.id, input.paymentMethod),
    onSuccess: () => {
      toast.success("料金を受け取ったことを記録しました");
      setPendingSettlement(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "受け取りの記録に失敗しました");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const runUndoableStatusChange = (input: {
    id: string;
    orderNumber: string;
    message: string;
    optimistic: Partial<SwipeableOrder>;
    previous: Partial<SwipeableOrder>;
    commit: () => Promise<unknown>;
  }) => {
    const patchOrder = (patch: Partial<SwipeableOrder>) => {
      queryClient.setQueryData<SwipeableOrder[]>(["orders", circleId], (current) =>
        current?.map((order) => order.id === input.id ? { ...order, ...patch } : order),
      );
    };
    undoableAction({
      message: `${input.message}（5秒以内なら元に戻せます）`,
      duration: 5000,
      optimistic: () => {
        setPendingUndoActions((count) => count + 1);
        patchOrder(input.optimistic);
      },
      rollback: () => patchOrder(input.previous),
      commit: async () => {
        await input.commit();
      },
      onSettled: () => setPendingUndoActions((count) => Math.max(0, count - 1)),
      errorMessage: `注文 #${input.orderNumber} の状態を更新できませんでした`,
    });
  };

  const handleStartPreparing = (orderId: string) => {
    const order = (orders ?? []).find((candidate) => candidate.id === orderId);
    if (!order) return Promise.resolve();
    runUndoableStatusChange({
      id: order.id,
      orderNumber: order.orderNumber,
      message: `注文 #${order.orderNumber} を調理中にしました`,
      optimistic: { status: "preparing" },
      previous: { status: order.status },
      commit: () => updateStatus.mutateAsync({ id: order.id, status: "preparing", silent: true }),
    });
    return Promise.resolve();
  };

  const openOrderNumberDisplay = () => {
    if (orderNumberDisplayWindow.current && !orderNumberDisplayWindow.current.closed) {
      orderNumberDisplayWindow.current.focus();
      return;
    }
    // 2026-10-21: 認証対象のサークルIDはsessionStorageにあるため、新窓へ複製してからopenerを切る。
    const popup = window.open("/circle/backyard/display", `fesflow-order-number-display-${Date.now()}`);
    if (!popup) {
      toast.error("番号表示画面を開けませんでした。ポップアップを許可してください。");
      return;
    }
    popup.opener = null;
    orderNumberDisplayWindow.current = popup;
  };

  const handleComplete = (orderId: string) => {
    const order = (orders ?? []).find((candidate) => candidate.id === orderId);
    if (!order) return Promise.resolve();
    runUndoableStatusChange({
      id: order.id,
      orderNumber: order.orderNumber,
      message: `注文 #${order.orderNumber} を完成にしました`,
      optimistic: { status: "completed" },
      previous: { status: order.status },
      commit: () => completeOrder.mutateAsync({ id: order.id, silent: true }),
    });
    return Promise.resolve();
  };

  const handleMarkReceived = (orderId: string) => {
    const order = (orders ?? []).find((candidate) => candidate.id === orderId);
    if (!order) return Promise.resolve();
    runUndoableStatusChange({
      id: order.id,
      orderNumber: order.orderNumber,
      message: `注文 #${order.orderNumber} を受け渡し済みにしました`,
      optimistic: { receivedAt: new Date().toISOString() },
      previous: { receivedAt: order.receivedAt ?? null },
      commit: () => markReceived.mutateAsync({ id: order.id, silent: true }),
    });
    return Promise.resolve();
  };

  const handleCancel = () => {
    if (!pendingCancel) return;
    const orderId = pendingCancel.id;
    const refundConfirmed = pendingCancel.paymentStatus === "paid";
    setCancelAnimationOrderId(orderId);
    setPendingCancel(null);
    window.setTimeout(() => {
      if (refundConfirmed) {
        updateStatus.mutate(
          { id: orderId, status: "cancelled", refundConfirmed: true },
          { onSettled: () => setCancelAnimationOrderId(null) },
        );
      } else {
        runUndoableStatusChange({
          id: orderId,
          orderNumber: pendingCancel.orderNumber,
          message: `注文 #${pendingCancel.orderNumber} をキャンセルしました`,
          optimistic: { status: "cancelled" },
          previous: { status: pendingCancel.status },
          commit: () => updateStatus.mutateAsync({ id: orderId, status: "cancelled", silent: true }),
        });
        setCancelAnimationOrderId(null);
      }
    }, 300);
  };

  const toppingDetails = new Map((toppings ?? []).map((topping) => [topping.id, topping]));
  const kitchenOrders = (orders ?? []).map((order) => ({
    ...order,
    items: order.items.map((item) => ({
      ...item,
      toppings: item.toppings?.map((topping) => ({
        ...topping,
        category: toppingDetails.get(topping.id)?.category || "未分類",
        sortOrder: toppingDetails.get(topping.id)?.sortOrder ?? 0,
      })),
    })),
  }));
  const visibleOrders = kitchenOrders.filter((order) => {
    const awaitingPickup = (order.status === "ready" || order.status === "completed") && !order.receivedAt;
    const matchesStatus = activeStatus === "pending"
      ? order.status === "pending"
      : activeStatus === "preparing"
        ? order.status === "preparing"
        : activeStatus === "pickup"
          ? awaitingPickup
          : activeStatus === "received"
            ? !!order.receivedAt
            : activeStatus === "cancelled"
              ? order.status === "cancelled"
              : true;
    const matchesPayment = !showUnpaidOnly || (order.paymentStatus === "unpaid" && order.status !== "cancelled");
    return matchesStatus && matchesPayment;
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 space-y-4">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  if (isError && !orders) {
    return (
      <div className="container mx-auto p-4">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 p-3 sm:space-y-6 sm:p-4">
      {/* 2026-10-25: 狭い画面でも番号表示と更新を見出しと同じ行に保ち、厨房の操作位置を揃える。 */}
      <div className="flex flex-row items-center justify-between gap-2 border-b-thick border-border pb-3">
        <h1 className="whitespace-nowrap text-lg font-headline uppercase tracking-tight sm:text-3xl">厨房管理</h1>
        <div className="flex shrink-0 gap-1 sm:gap-2">
          <Button
            onClick={openOrderNumberDisplay}
            variant="outline"
            className="h-10 border-thick border-border rounded-none px-2 font-mono text-xs uppercase sm:px-4 sm:text-sm"
          >
            <Monitor className="mr-1 h-4 w-4 sm:mr-2" />
            番号表示
          </Button>
          <Button onClick={() => refetch()} variant="outline" className="h-10 border-thick border-border rounded-none px-2 font-mono text-xs uppercase sm:px-4 sm:text-sm">
            更新
          </Button>
        </div>
      </div>

      {isError && orders && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-thick border-warning bg-warning/10 p-3 text-xs font-bold">
          <span>通信に失敗しました。表示中の注文は前回取得した内容です。</span>
          <Button onClick={() => refetch()} variant="outline" className="min-h-10 border-thick border-border">再接続して更新</Button>
        </div>
      )}

      {/* ステータスフィルター */}
      <div className="flex gap-2 flex-wrap" role="group" aria-label="注文状態">
        <Button
          variant={activeStatus === "pending" ? "default" : "outline"}
          aria-pressed={activeStatus === "pending"}
          onClick={() => setSelectedStatus("pending")}
          className="border-thick border-border rounded-none font-mono uppercase text-xs sm:text-sm"
        >
          未着手
        </Button>
        <Button
          variant={activeStatus === "preparing" ? "default" : "outline"}
          aria-pressed={activeStatus === "preparing"}
          onClick={() => setSelectedStatus("preparing")}
          className="border-thick border-border rounded-none font-mono uppercase text-xs sm:text-sm"
        >
          調理中
        </Button>
        <Button
          variant={activeStatus === "pickup" ? "default" : "outline"}
          aria-pressed={activeStatus === "pickup"}
          onClick={() => setSelectedStatus("pickup")}
          className="border-thick border-border rounded-none font-mono uppercase text-xs sm:text-sm"
        >
          受け取り待ち
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={["all", "received", "cancelled"].includes(activeStatus) ? "default" : "outline"}
              aria-label={`その他の注文フィルター: ${activeStatus === "all" ? "すべて" : activeStatus === "received" ? "受け渡し済み" : activeStatus === "cancelled" ? "キャンセル" : "選択"}`}
              className="border-thick border-border rounded-none font-mono uppercase text-xs sm:text-sm"
            >
              {activeStatus === "all" ? "その他: すべて" : activeStatus === "received" ? "その他: 受け渡し済み" : activeStatus === "cancelled" ? "その他: キャンセル" : "その他"}
              <ChevronDown className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" aria-label="その他の注文フィルター">
            {/* 2026-10-25: 主な状態を表示中は「すべて」を選択済みと誤認させない。 */}
            <DropdownMenuRadioGroup value={["all", "received", "cancelled"].includes(activeStatus) ? activeStatus : ""} onValueChange={setSelectedStatus}>
              <DropdownMenuRadioItem value="all">すべての注文</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="received">受け渡し済み</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="cancelled">キャンセル</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 注文一覧 */}
      <SwipeableOrderStack
        orders={visibleOrders}
        showUnpaidOnly={showUnpaidOnly}
        onShowUnpaidOnlyChange={setShowUnpaidOnly}
        scrollStateKey={`fesflow:backyard:${circleId || "unselected"}:horizontal-scroll`}
        openAtLatest={activeStatus === "all"}
        onStart={handleStartPreparing}
        onComplete={handleComplete}
        onMarkReceived={handleMarkReceived}
        onSettleRequest={(order, paymentMethod) => setPendingSettlement({
          id: order.id,
          orderNumber: order.orderNumber,
          totalPrice: order.totalPrice,
          paymentMethod,
        })}
        paymentMethods={paymentMethods}
        paymentMethodsReady={paymentMethodsReady}
        onCancelRequest={(order) => setPendingCancel({
          id: order.id,
          orderNumber: order.orderNumber,
          totalPrice: order.totalPrice,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
        })}
        cancelAnimationOrderId={cancelAnimationOrderId}
        isUpdating={pendingUndoActions > 0 || updateStatus.isPending || completeOrder.isPending || markReceived.isPending || settleOrder.isPending}
      />

      <ConfirmDialog
        isOpen={!!pendingSettlement}
        isPending={settleOrder.isPending}
        destructive={false}
        title="料金の受け取りを記録"
        description={`注文 #${pendingSettlement?.orderNumber ?? ""} の料金 ¥${(pendingSettlement?.totalPrice ?? 0).toLocaleString()} を「${pendingSettlement?.paymentMethod ?? ""}」で受け取ったことを記録します。実際に受け取った後に確定してください。`}
        confirmLabel="受け取りを記録"
        cancelLabel="戻る"
        onConfirm={() => {
          if (!pendingSettlement) return;
          void settleOrder.mutateAsync({ id: pendingSettlement.id, paymentMethod: pendingSettlement.paymentMethod });
        }}
        onCancel={() => setPendingSettlement(null)}
      />

      <ConfirmDialog
        isOpen={!!pendingCancel}
        isPending={updateStatus.isPending}
        title={pendingCancel?.paymentStatus === "paid" ? "[返金を記録してキャンセル]" : "[注文のキャンセル]"}
        description={pendingCancel?.paymentStatus === "paid"
          ? `注文 #${pendingCancel.orderNumber} の全額 ¥${(pendingCancel.totalPrice ?? 0).toLocaleString()} を返金記録に残して取り消します。FesFlowは送金しません。実際に返金を済ませてから確定してください。元の決済方法: ${pendingCancel.paymentMethod ?? "未記録"}。`
          : `注文 #${pendingCancel?.orderNumber ?? ""} をキャンセルしますか？確定後5秒以内なら元に戻せます。`}
        confirmLabel={pendingCancel?.paymentStatus === "paid" ? "全額返金を記録して取り消す" : "注文を取り消す"}
        cancelLabel="戻る"
        onConfirm={handleCancel}
        onCancel={() => setPendingCancel(null)}
      />
    </div>
  );
}

export default function BackyardPage() {
  return (
    <CircleAuthGuard>
      <BackyardPageContent />
    </CircleAuthGuard>
  );
}

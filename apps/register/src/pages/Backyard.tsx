
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { orderApi } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, Clock, Users } from "lucide-react";

function BackyardPageContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>(
    "pending"
  );
  const queryClient = useQueryClient();

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
  }, []);

  const {
    data: orders,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["orders", circleId, selectedStatus],
    queryFn: () => orderApi.list(circleId, selectedStatus),
    enabled: !!circleId,
    refetchInterval: 5000, // 5秒ごとに自動更新
  });

  const updateStatus = useMutation({
    mutationFn: async (input: {
      id: string;
      status: "pending" | "preparing" | "ready" | "completed" | "cancelled";
    }) => {
      return await orderApi.updateStatus(input.id, input.status);
    },
    onSuccess: () => {
      toast.success("注文ステータスを更新しました");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "更新に失敗しました");
    },
  });

  const completeOrder = useMutation({
    mutationFn: async (input: { id: string }) => {
      return await orderApi.complete(input.id);
    },
    onSuccess: () => {
      toast.success("注文を完了しました!");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "完了処理に失敗しました");
    },
  });

  const handleStartPreparing = (orderId: string) => {
    updateStatus.mutate({ id: orderId, status: "preparing" });
  };

  const handleComplete = (orderId: string) => {
    completeOrder.mutate({ id: orderId });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: "未着手", variant: "default" as const },
      preparing: { label: "調理中", variant: "warning" as const },
      ready: { label: "受渡可", variant: "active" as const },
      completed: { label: "完成", variant: "active" as const },
      cancelled: { label: "キャンセル", variant: "error" as const },
    };
    const config = statusConfig[status as keyof typeof statusConfig] || {
      label: status,
      variant: "default" as const,
    };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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

  return (
    <div className="container mx-auto p-3 sm:p-4 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b-[3px] border-border pb-3">
        <h1 className="text-2xl sm:text-3xl font-headline uppercase tracking-tight">厨房管理</h1>
        <Button onClick={() => refetch()} variant="outline" className="w-full sm:w-auto border-[3px] border-border rounded-none font-mono uppercase">
          更新
        </Button>
      </div>

      {/* ステータスフィルター */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant={selectedStatus === "pending" ? "default" : "outline"}
          onClick={() => setSelectedStatus("pending")}
          className="border-[3px] border-border rounded-none font-mono uppercase text-xs sm:text-sm"
        >
          未着手
        </Button>
        <Button
          variant={selectedStatus === "preparing" ? "default" : "outline"}
          onClick={() => setSelectedStatus("preparing")}
          className="border-[3px] border-border rounded-none font-mono uppercase text-xs sm:text-sm"
        >
          調理中
        </Button>
        <Button
          variant={selectedStatus === "completed" ? "default" : "outline"}
          onClick={() => setSelectedStatus("completed")}
          className="border-[3px] border-border rounded-none font-mono uppercase text-xs sm:text-sm"
        >
          完成
        </Button>
        <Button
          variant={selectedStatus === undefined ? "default" : "outline"}
          onClick={() => setSelectedStatus(undefined)}
          className="border-[3px] border-border rounded-none font-mono uppercase text-xs sm:text-sm"
        >
          すべて
        </Button>
      </div>

      {/* 注文一覧 */}
      <div className="grid gap-3 sm:gap-4">
        {orders && orders.length > 0 ? (
          orders.map((order) => (
            <Card key={order.id} className="border-[3px] border-border rounded-none">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2">
                  <div>
                    <CardTitle className="text-xl sm:text-2xl font-headline uppercase">
                      #{order.orderNumber}
                    </CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-2 sm:gap-4 mt-1">
                      <span className="flex items-center font-mono text-xs">
                        <Clock className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                        {formatDate(order.createdAt)}
                      </span>
                      <span className="flex items-center font-mono text-xs">
                        <Users className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                        {order.items.length}品
                      </span>
                    </CardDescription>
                  </div>
                  {getStatusBadge(order.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 注文アイテム */}
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="border-[2px] border-border p-2 sm:p-3 space-y-1">
                      <div className="flex justify-between gap-2">
                        <span className="font-bold text-sm sm:text-base">
                          {item.menuName} x{item.quantity}
                        </span>
                        <span className="font-mono text-sm shrink-0">
                          ¥{((item.menuPrice ?? 0) * item.quantity).toLocaleString()}
                        </span>
                      </div>
                      {item.toppings && item.toppings.length > 0 && (
                        <div className="pl-3 space-y-0.5">
                          {item.toppings.map((topping) => (
                            <div key={topping.id} className="flex justify-between text-xs font-mono text-muted-foreground">
                              <span>+ {topping.toppingName}</span>
                              <span>¥{(topping.price * item.quantity).toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {/* 合計 */}
                <div className="border-t-[3px] border-border pt-3 flex justify-between font-headline text-xl sm:text-2xl">
                  <span>合計</span>
                  <span>¥{(order.totalPrice ?? 0).toLocaleString()}</span>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2 flex-wrap pt-0 px-4 pb-4">
                {order.status === "pending" && (
                  <Button
                    className="flex-1 min-w-[120px] h-12 border-[3px] border-border rounded-none font-mono uppercase font-bold"
                    onClick={() => handleStartPreparing(order.id)}
                    disabled={updateStatus.isPending}
                  >
                    <Clock className="mr-2 h-4 w-4" />調理開始
                  </Button>
                )}
                {order.status === "preparing" && (
                  <Button
                    className="flex-1 min-w-[120px] h-12 border-[3px] border-border rounded-none font-mono uppercase font-bold"
                    onClick={() => handleComplete(order.id)}
                    disabled={completeOrder.isPending}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />完成
                  </Button>
                )}
                {order.status === "completed" && (
                  <Button className="flex-1 min-w-[120px] h-12 border-[3px] border-border rounded-none font-mono uppercase" disabled variant="outline">
                    <CheckCircle className="mr-2 h-4 w-4" />完了済み
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-muted-foreground text-lg">
                該当する注文がありません
              </p>
            </CardContent>
          </Card>
        )}
      </div>
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

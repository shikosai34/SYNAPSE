
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { orderApi } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function SalesManagementContent() {
  const [circleId, setCircleId] = useState<string>("");

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
  }, []);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["orders", circleId],
    queryFn: () => orderApi.list(circleId),
    enabled: !!circleId,
  });

  const totalSales =
    orders?.reduce((sum, order) => sum + (order.totalPrice || 0), 0) || 0;
  const completedOrders =
    orders?.filter((order) => order.status === "completed") || [];
  const completedSales = completedOrders.reduce(
    (sum, order) => sum + (order.totalPrice || 0),
    0
  );

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 space-y-4">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">売上管理</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>総注文数</CardTitle>
            <CardDescription>すべての注文</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{orders?.length || 0}件</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>完了注文数</CardTitle>
            <CardDescription>完了した注文</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{completedOrders.length}件</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>完了売上</CardTitle>
            <CardDescription>完了した注文の合計</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              ¥{completedSales.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>注文履歴</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {orders?.map((order) => (
              <div
                key={order.id}
                className="flex justify-between items-center p-3 border rounded-lg"
              >
                <div>
                  <p className="font-semibold">{order.orderNumber}</p>
                  <p className="text-sm text-muted-foreground">
                    {order.createdAt
                      ? new Date(order.createdAt).toLocaleString("ja-JP")
                      : "-"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">
                    ¥{(order.totalPrice ?? 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {order.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SalesManagementPage() {
  return (
    <CircleAuthGuard>
      <SalesManagementContent />
    </CircleAuthGuard>
  );
}

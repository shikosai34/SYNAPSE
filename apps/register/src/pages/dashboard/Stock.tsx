
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { menuApi } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, Package } from "lucide-react";
import Image from "@/components/image";

function StockManagementContent() {
  const [circleId, setCircleId] = useState<string>("");
  const queryClient = useQueryClient();

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
  }, []);

  const {
    data: menus,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });

  const updateStock = useMutation({
    mutationFn: async (input: { id: string; stock: number | null }) => {
      return await menuApi.updateStock(input.id, input.stock);
    },
    onSuccess: () => {
      toast.success("在庫を更新しました");
      queryClient.invalidateQueries({ queryKey: ["menus"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "更新に失敗しました");
    },
  });

  const handleUpdateStock = (menuId: string, newStock: number) => {
    updateStock.mutate({ id: menuId, stock: newStock });
  };

  const lowStockItems =
    menus?.filter((menu) => (menu.stockQuantity ?? 0) < 10) || [];

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">在庫管理</h1>

      {lowStockItems.length > 0 && (
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle className="flex items-center text-yellow-600">
              <AlertTriangle className="mr-2 h-5 w-5" />
              低在庫アラート
            </CardTitle>
            <CardDescription>在庫が10個以下の商品があります</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockItems.map((menu) => (
                <div
                  key={menu.id}
                  className="flex justify-between items-center p-2 bg-yellow-50 dark:bg-yellow-950 rounded"
                >
                  <span className="font-semibold">{menu.name}</span>
                  <span className="text-yellow-600">
                    残り{menu.stockQuantity}個
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Package className="mr-2 h-5 w-5" />
            在庫一覧
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {menus?.map((menu) => (
              <div
                key={menu.id}
                className="flex items-center gap-4 p-4 border rounded-lg"
              >
                <div className="relative h-16 w-16 rounded overflow-hidden flex-shrink-0">
                  {menu.imagePath ? (
                    <Image
                      src={menu.imagePath}
                      alt={menu.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <span className="text-xs text-muted-foreground">
                        No Image
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-grow">
                  <p className="font-semibold">{menu.name}</p>
                  <p className="text-sm text-muted-foreground">
                    ¥{menu.price.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-24"
                    defaultValue={menu.stockQuantity ?? 0}
                    onBlur={(e) => {
                      const newValue = Number(e.target.value);
                      if (newValue !== menu.stockQuantity) {
                        handleUpdateStock(menu.id, newValue);
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground">個</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function StockManagementPage() {
  return (
    <CircleAuthGuard>
      <StockManagementContent />
    </CircleAuthGuard>
  );
}

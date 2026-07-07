import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { menuApi } from "@/lib/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { toast } from "sonner";
import { AlertTriangle, Package } from "lucide-react";

function StockManagementContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  const queryClient = useQueryClient();

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
    const authStored = localStorage.getItem("circleAuth");
    if (authStored) {
      try {
        const authInfo = JSON.parse(authStored);
        if (authInfo.circleName) {
          setCircleName(authInfo.circleName);
        }
      } catch (_) {}
    }
  }, []);

  const {
    data: menus,
    isLoading,
    isError,
    error,
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
      <DashboardLayout title={circleName} subtitle="在庫管理" type="circle">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-64" />
        </div>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout title={circleName} subtitle="在庫管理" type="circle">
        <ErrorState error={error} onRetry={() => refetch()} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={circleName} subtitle="在庫管理" type="circle">
      <div className="space-y-6">
        {lowStockItems.length > 0 && (
          <Card className="border-yellow-500 rounded-none shadow-none">
            <CardHeader className="pb-3 border-b-thin border-yellow-200">
              <CardTitle className="flex items-center text-yellow-600 text-sm font-bold uppercase">
                <AlertTriangle className="mr-2 h-4 w-4" />
                低在庫アラート
              </CardTitle>
              <CardDescription className="text-xs">在庫が10個以下の商品があります</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-2">
                {lowStockItems.map((menu) => (
                  <div
                    key={menu.id}
                    className="flex justify-between items-center p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 text-xs font-mono rounded-none"
                  >
                    <span className="font-bold">{menu.name}</span>
                    <span className="text-yellow-600 font-bold">
                      残り{menu.stockQuantity}個
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className=" rounded-none shadow-none">
          <CardHeader className="pb-3 border-b-thick border-border">
            <CardTitle className="flex items-center text-sm font-bold uppercase">
              <Package className="mr-2 h-4 w-4" />
              在庫一覧
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {menus?.map((menu) => (
                <div
                  key={menu.id}
                  className="flex items-center gap-4 p-3 border-thick border-border rounded-none text-xs font-mono"
                >
                  <div className="relative h-12 w-12 rounded-none overflow-hidden flex-shrink-0 border-thick border-border">
                    {menu.imagePath ? (
                      <img
                        src={menu.imagePath}
                        alt={menu.name}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted">
                        <span className="text-[8px] text-muted-foreground">
                          No Image
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex-grow">
                    <p className="font-bold text-foreground">{menu.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      ¥{menu.price.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="w-20 border-thick border-border rounded-none h-8 text-xs bg-background focus-visible:ring-0 text-center"
                      defaultValue={menu.stockQuantity ?? 0}
                      // 2026-07-07 (Phase6 UX堅牢化): 保存中に連続で blur すると重複リクエストに
                      // なりうるため、更新中は入力を disabled にする (行単位の pending 追跡はせず
                      // mutation 全体の isPending で握る簡易対応)。
                      disabled={updateStock.isPending}
                      onBlur={(e) => {
                        const newValue = Number(e.target.value);
                        if (newValue !== menu.stockQuantity) {
                          handleUpdateStock(menu.id, newValue);
                        }
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground uppercase font-bold">個</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

export default function StockManagementPage() {
  return (
    <CircleAuthGuard>
      <StockManagementContent />
    </CircleAuthGuard>
  );
}

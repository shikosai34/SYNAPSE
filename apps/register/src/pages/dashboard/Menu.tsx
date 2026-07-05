import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { menuApi, toppingApi } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Settings, UtensilsCrossed } from "lucide-react";
import Image from "@/components/image";

// モーダルインポート
import { MenuFormModal } from "@/components/menu/MenuFormModal";
import { ToppingFormModal } from "@/components/menu/ToppingFormModal";
import { ToppingMappingModal } from "@/components/menu/ToppingMappingModal";

function MenuManagementContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [circleName, setCircleName] = useState<string>("サークルダッシュボード");
  
  // モーダル開閉用ステート
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedMenu, setSelectedMenu] = useState<any | null>(null);

  const [isToppingOpen, setIsToppingOpen] = useState(false);
  const [selectedTopping, setSelectedTopping] = useState<any | null>(null);

  const [isMappingOpen, setIsMappingOpen] = useState(false);

  // 削除確認ダイアログ用ステート (メニュー / トッピング共通で対象を保持)
  const [menuToDelete, setMenuToDelete] = useState<any | null>(null);
  const [toppingToDelete, setToppingToDelete] = useState<any | null>(null);

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

  const { data: menus, isLoading: menusLoading } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });

  const { data: toppings, isLoading: toppingsLoading } = useQuery({
    queryKey: ["toppings", circleId],
    queryFn: () => toppingApi.list(circleId),
    enabled: !!circleId,
  });

  // メニュー削除
  const deleteMenu = useMutation({
    mutationFn: (id: string) => menuApi.delete(id),
    onSuccess: () => {
      toast.success("メニューを削除しました");
      queryClient.invalidateQueries({ queryKey: ["menus", circleId] });
      setMenuToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "削除に失敗しました");
    },
  });

  // トッピング削除
  const deleteTopping = useMutation({
    mutationFn: (id: string) => toppingApi.delete(id),
    onSuccess: () => {
      toast.success("トッピングを削除しました");
      queryClient.invalidateQueries({ queryKey: ["toppings", circleId] });
      queryClient.invalidateQueries({ queryKey: ["menus", circleId] }); // メニューのトッピング一覧も更新
      setToppingToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "削除に失敗しました");
    },
  });

  const handleOpenMenuAdd = () => {
    setSelectedMenu(null);
    setIsMenuOpen(true);
  };

  const handleOpenMenuEdit = (menu: any) => {
    setSelectedMenu(menu);
    setIsMenuOpen(true);
  };

  const handleOpenToppingAdd = () => {
    setSelectedTopping(null);
    setIsToppingOpen(true);
  };

  const handleOpenToppingEdit = (topping: any) => {
    setSelectedTopping(topping);
    setIsToppingOpen(true);
  };

  if (menusLoading || toppingsLoading) {
    return (
      <DashboardLayout title={circleName} subtitle="メニュー・トッピング管理" type="circle">
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={circleName} subtitle="メニュー・トッピング管理" type="circle">
      <div className="space-y-8 font-mono text-foreground">
        
        {/* メニューセクション */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b-thick border-border pb-3 gap-2 sm:gap-0">
            <h2 className="text-sm font-bold uppercase tracking-wider">[メニュー管理]</h2>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                onClick={() => setIsMappingOpen(true)}
                variant="outline"
                className="flex-1 sm:flex-none rounded-none border-thick border-border bg-background hover:bg-muted h-8 text-[11px] font-bold uppercase px-3 flex items-center gap-1"
              >
                <Settings className="h-3.5 w-3.5" />
                トッピング対応設定
              </Button>
              <Button
                onClick={handleOpenMenuAdd}
                className="flex-1 sm:flex-none rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold uppercase px-3 flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                メニューを追加
              </Button>
            </div>
          </div>

          {/* メニュー一覧 */}
          {!menus || menus.length === 0 ? (
            <EmptyState
              icon={UtensilsCrossed}
              message="メニューがまだありません"
              actionLabel="メニューを追加"
              onAction={handleOpenMenuAdd}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {menus.map((menu) => (
                <Card key={menu.id} className="rounded-none bg-background shadow-none p-0 overflow-hidden">
                  <div className="relative h-40 w-full overflow-hidden border-b-thick border-border">
                    {menu.imagePath ? (
                      <Image
                        src={menu.imagePath}
                        alt={menu.name}
                        fill
                        className="object-cover absolute inset-0 h-full w-full"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted/40">
                        <span className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">No Image</span>
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <CardTitle className="text-sm font-bold truncate uppercase">{menu.name}</CardTitle>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {menu.id}</p>
                    </div>

                    <div className="flex justify-between items-baseline">
                      <span className="text-lg font-black text-primary">
                        ¥{menu.price.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        在庫: {menu.stockQuantity ?? 0}個
                      </span>
                    </div>

                    {menu.description && (
                      <CardDescription className="text-xs line-clamp-2 min-h-[2.5rem] leading-[1.6]">
                        {menu.description}
                      </CardDescription>
                    )}

                    {menu.toppings && menu.toppings.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">紐付けトッピング:</p>
                        <div className="flex flex-wrap gap-1">
                          {menu.toppings.map((t) => (
                            <span key={t.id} className="text-[9px] bg-muted px-1.5 py-0.5 border-thin border-border font-bold">
                              {t.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2 border-t-thin border-border">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenMenuEdit(menu)}
                        className="flex-1 rounded-none border-thick border-border h-8 text-[10px] font-bold uppercase"
                      >
                        <Edit className="mr-1 h-3 w-3" />
                        編集
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setMenuToDelete(menu)}
                        disabled={deleteMenu.isPending}
                        className="flex-1 rounded-none border-thick border-destructive h-8 text-[10px] font-bold uppercase"
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        削除
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* トッピングセクション */}
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b-thick border-border pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider">[トッピング管理]</h2>
            <Button
              onClick={handleOpenToppingAdd}
              className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold uppercase px-3 flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              トッピングを追加
            </Button>
          </div>

          {/* トッピング一覧 */}
          {!toppings || toppings.length === 0 ? (
            <EmptyState
              icon={UtensilsCrossed}
              message="トッピングがまだありません"
              actionLabel="トッピングを追加"
              onAction={handleOpenToppingAdd}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {toppings.map((topping) => (
                <Card key={topping.id} className="rounded-none bg-background shadow-none p-4 space-y-3">
                  <div>
                    <CardTitle className="text-xs font-bold truncate uppercase">{topping.name}</CardTitle>
                    <p className="text-[9px] text-muted-foreground font-mono mt-0.5">ID: {topping.id}</p>
                  </div>

                  <p className="text-base font-black text-primary">
                    +¥{topping.price.toLocaleString()}
                  </p>

                  {topping.description && (
                    <CardDescription className="text-xs line-clamp-2 min-h-[2.5rem] leading-[1.6]">
                      {topping.description}
                    </CardDescription>
                  )}

                  <div className="flex gap-2 pt-2 border-t-thin border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenToppingEdit(topping)}
                      className="flex-1 rounded-none border-thick border-border h-7 text-[10px] font-bold uppercase"
                    >
                      <Edit className="mr-1 h-3 w-3" />
                      編集
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setToppingToDelete(topping)}
                      disabled={deleteTopping.isPending}
                      className="flex-1 rounded-none border-thick border-destructive h-7 text-[10px] font-bold uppercase"
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      削除
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* 各種モーダルダイアログ */}
      <MenuFormModal
        circleId={circleId}
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        menu={selectedMenu}
      />

      <ToppingFormModal
        circleId={circleId}
        isOpen={isToppingOpen}
        onClose={() => setIsToppingOpen(false)}
        topping={selectedTopping}
      />

      <ToppingMappingModal
        circleId={circleId}
        isOpen={isMappingOpen}
        onClose={() => setIsMappingOpen(false)}
      />

      {/* メニュー削除確認ダイアログ */}
      <ConfirmDialog
        isOpen={!!menuToDelete}
        title="[確認: メニューの削除]"
        description={`メニュー「${menuToDelete?.name ?? ""}」を削除しますか？この操作は取り消せません。`}
        confirmLabel="削除する"
        onConfirm={() => menuToDelete && deleteMenu.mutate(menuToDelete.id)}
        onCancel={() => setMenuToDelete(null)}
      />

      {/* トッピング削除確認ダイアログ */}
      <ConfirmDialog
        isOpen={!!toppingToDelete}
        title="[確認: トッピングの削除]"
        description={`トッピング「${toppingToDelete?.name ?? ""}」を削除しますか？この操作は取り消せません。`}
        confirmLabel="削除する"
        onConfirm={() => toppingToDelete && deleteTopping.mutate(toppingToDelete.id)}
        onCancel={() => setToppingToDelete(null)}
      />
    </DashboardLayout>
  );
}

export default function MenuManagementPage() {
  return (
    <CircleAuthGuard>
      <MenuManagementContent />
    </CircleAuthGuard>
  );
}

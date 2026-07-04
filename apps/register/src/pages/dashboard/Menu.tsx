
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { menuApi, toppingApi } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageUpload } from "@/components/image-upload";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Save } from "lucide-react";
import Image from "@/components/image";

function MenuManagementContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [isAddingMenu, setIsAddingMenu] = useState(false);
  const [isAddingTopping, setIsAddingTopping] = useState(false);
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [editingToppingId, setEditingToppingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // メニューフォーム
  const [menuForm, setMenuForm] = useState({
    name: "",
    price: 0,
    imagePath: "",
    description: "",
    additionalInfo: "",
    stockQuantity: 0,
    toppingIds: [] as string[],
  });

  // トッピングフォーム
  const [toppingForm, setToppingForm] = useState({
    name: "",
    price: 0,
    description: "",
  });

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) {
      setCircleId(storedCircleId);
    }
  }, []);

  const {
    data: menus,
    isLoading: menusLoading,
    refetch: refetchMenus,
  } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });

  const {
    data: toppings,
    isLoading: toppingsLoading,
    refetch: refetchToppings,
  } = useQuery({
    queryKey: ["toppings", circleId],
    queryFn: () => toppingApi.list(circleId),
    enabled: !!circleId,
  });

  const createMenu = useMutation({
    mutationFn: async (input: {
      circleId: string;
      name: string;
      price: number;
      description?: string;
      imageUrl?: string;
      stock?: number;
      toppingIds?: string[];
    }) => {
      return await menuApi.create(input);
    },
    onSuccess: () => {
      toast.success("メニューを追加しました");
      resetMenuForm();
      queryClient.invalidateQueries({ queryKey: ["menus"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "追加に失敗しました");
    },
  });

  const updateMenu = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      price?: number;
      description?: string;
      imageUrl?: string;
      stock?: number | null;
      toppingIds?: string[];
    }) => {
      const { id, ...data } = input;
      return await menuApi.update(id, data);
    },
    onSuccess: () => {
      toast.success("メニューを更新しました");
      resetMenuForm();
      queryClient.invalidateQueries({ queryKey: ["menus"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "更新に失敗しました");
    },
  });

  const deleteMenu = useMutation({
    mutationFn: async (input: { id: string }) => {
      return await menuApi.delete(input.id);
    },
    onSuccess: () => {
      toast.success("メニューを削除しました");
      queryClient.invalidateQueries({ queryKey: ["menus"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "削除に失敗しました");
    },
  });

  const createTopping = useMutation({
    mutationFn: async (input: {
      circleId: string;
      name: string;
      price: number;
    }) => {
      return await toppingApi.create(input);
    },
    onSuccess: () => {
      toast.success("トッピングを追加しました");
      resetToppingForm();
      queryClient.invalidateQueries({ queryKey: ["toppings"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "追加に失敗しました");
    },
  });

  const updateTopping = useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      price?: number;
    }) => {
      const { id, ...data } = input;
      return await toppingApi.update(id, data);
    },
    onSuccess: () => {
      toast.success("トッピングを更新しました");
      resetToppingForm();
      queryClient.invalidateQueries({ queryKey: ["toppings"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "更新に失敗しました");
    },
  });

  const deleteTopping = useMutation({
    mutationFn: async (input: { id: string }) => {
      return await toppingApi.delete(input.id);
    },
    onSuccess: () => {
      toast.success("トッピングを削除しました");
      queryClient.invalidateQueries({ queryKey: ["toppings"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "削除に失敗しました");
    },
  });

  const resetMenuForm = () => {
    setMenuForm({
      name: "",
      price: 0,
      imagePath: "",
      description: "",
      additionalInfo: "",
      stockQuantity: 0,
      toppingIds: [],
    });
    setIsAddingMenu(false);
    setEditingMenuId(null);
  };

  const resetToppingForm = () => {
    setToppingForm({
      name: "",
      price: 0,
      description: "",
    });
    setIsAddingTopping(false);
    setEditingToppingId(null);
  };

  const handleSaveMenu = () => {
    if (editingMenuId) {
      updateMenu.mutate({ id: editingMenuId, ...menuForm });
    } else {
      createMenu.mutate({ circleId, ...menuForm });
    }
  };

  const handleSaveTopping = () => {
    if (editingToppingId) {
      updateTopping.mutate({ id: editingToppingId, ...toppingForm });
    } else {
      createTopping.mutate({ circleId, ...toppingForm });
    }
  };

  const handleEditMenu = (menu: any) => {
    setMenuForm({
      name: menu.name,
      price: menu.price,
      imagePath: menu.imagePath,
      description: menu.description || "",
      additionalInfo: menu.additionalInfo || "",
      stockQuantity: menu.stockQuantity || 0,
      toppingIds: menu.menuToppings?.map((mt: any) => mt.toppingId) || [],
    });
    setEditingMenuId(menu.id);
    setIsAddingMenu(true);
  };

  const handleEditTopping = (topping: any) => {
    setToppingForm({
      name: topping.name,
      price: topping.price,
      description: topping.description || "",
    });
    setEditingToppingId(topping.id);
    setIsAddingTopping(true);
  };

  if (menusLoading || toppingsLoading) {
    return (
      <div className="container mx-auto p-4 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">メニュー・トッピング管理</h1>

      {/* メニューセクション */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">メニュー</h2>
          <Button onClick={() => setIsAddingMenu(true)}>
            <Plus className="mr-2 h-4 w-4" />
            メニューを追加
          </Button>
        </div>

        {/* メニュー追加/編集フォーム */}
        {isAddingMenu && (
          <Card>
            <CardHeader>
              <CardTitle>
                {editingMenuId ? "メニューを編集" : "新しいメニュー"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="menuName">メニュー名</Label>
                  <Input
                    id="menuName"
                    value={menuForm.name}
                    onChange={(e) =>
                      setMenuForm({ ...menuForm, name: e.target.value })
                    }
                    placeholder="例: ハンバーガー"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="menuPrice">価格</Label>
                  <Input
                    id="menuPrice"
                    type="number"
                    value={menuForm.price}
                    onChange={(e) =>
                      setMenuForm({
                        ...menuForm,
                        price: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <ImageUpload
                  label="メニュー画像"
                  value={menuForm.imagePath}
                  onChange={(path) =>
                    setMenuForm({ ...menuForm, imagePath: path })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="menuDescription">説明</Label>
                <Input
                  id="menuDescription"
                  value={menuForm.description}
                  onChange={(e) =>
                    setMenuForm({ ...menuForm, description: e.target.value })
                  }
                  placeholder="商品の説明"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="stockQuantity">在庫数</Label>
                <Input
                  id="stockQuantity"
                  type="number"
                  value={menuForm.stockQuantity}
                  onChange={(e) =>
                    setMenuForm({
                      ...menuForm,
                      stockQuantity: Number(e.target.value),
                    })
                  }
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveMenu}>
                  <Save className="mr-2 h-4 w-4" />
                  保存
                </Button>
                <Button variant="outline" onClick={resetMenuForm}>
                  キャンセル
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* メニュー一覧 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {menus?.map((menu) => (
            <Card key={menu.id}>
              <CardHeader>
                <div className="relative h-32 w-full rounded-t-lg overflow-hidden">
                  {menu.imagePath ? (
                    <Image
                      src={menu.imagePath}
                      alt={menu.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <span className="text-muted-foreground">No Image</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <CardTitle>{menu.name}</CardTitle>
                <p className="text-xl font-bold text-primary">
                  ¥{menu.price.toLocaleString()}
                </p>
                {menu.description && (
                  <CardDescription>{menu.description}</CardDescription>
                )}
                <p className="text-sm text-muted-foreground">
                  在庫: {menu.stockQuantity}個
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditMenu(menu)}
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    編集
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMenu.mutate({ id: menu.id })}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    削除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* トッピングセクション */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold">トッピング</h2>
          <Button onClick={() => setIsAddingTopping(true)}>
            <Plus className="mr-2 h-4 w-4" />
            トッピングを追加
          </Button>
        </div>

        {/* トッピング追加/編集フォーム */}
        {isAddingTopping && (
          <Card>
            <CardHeader>
              <CardTitle>
                {editingToppingId ? "トッピングを編集" : "新しいトッピング"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="toppingName">トッピング名</Label>
                  <Input
                    id="toppingName"
                    value={toppingForm.name}
                    onChange={(e) =>
                      setToppingForm({ ...toppingForm, name: e.target.value })
                    }
                    placeholder="例: チーズ"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="toppingPrice">価格</Label>
                  <Input
                    id="toppingPrice"
                    type="number"
                    value={toppingForm.price}
                    onChange={(e) =>
                      setToppingForm({
                        ...toppingForm,
                        price: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="toppingDescription">説明</Label>
                <Input
                  id="toppingDescription"
                  value={toppingForm.description}
                  onChange={(e) =>
                    setToppingForm({
                      ...toppingForm,
                      description: e.target.value,
                    })
                  }
                  placeholder="トッピングの説明"
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveTopping}>
                  <Save className="mr-2 h-4 w-4" />
                  保存
                </Button>
                <Button variant="outline" onClick={resetToppingForm}>
                  キャンセル
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* トッピング一覧 */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {toppings?.map((topping) => (
            <Card key={topping.id}>
              <CardContent className="pt-6 space-y-2">
                <CardTitle className="text-lg">{topping.name}</CardTitle>
                <p className="text-lg font-bold text-primary">
                  +¥{topping.price.toLocaleString()}
                </p>
                {topping.description && (
                  <CardDescription>{topping.description}</CardDescription>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditTopping(topping)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteTopping.mutate({ id: topping.id })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MenuManagementPage() {
  return (
    <CircleAuthGuard>
      <MenuManagementContent />
    </CircleAuthGuard>
  );
}

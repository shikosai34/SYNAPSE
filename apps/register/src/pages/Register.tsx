
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { menuApi, toppingApi, orderApi, circleApi, wristbandApi } from "@/lib/api";
import { extractIdFromCode } from "@/lib/utils";
import { ModSandbox } from "@/components/ModSandbox";
import { QrScannerModal } from "@/components/pos/qr-scanner-modal";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Minus, Plus, ShoppingCart, Trash2, QrCode, X } from "lucide-react";

interface CartItem {
  menuId: string;
  menuName: string;
  menuPrice: number;
  quantity: number;
  toppings: {
    toppingId: string;
    toppingName: string;
    toppingPrice: number;
  }[];
}

function RegisterPageContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [peopleCount, setPeopleCount] = useState(1);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isCustomerQrModalOpen, setIsCustomerQrModalOpen] = useState(false);
  const [isCartPanelOpen, setIsCartPanelOpen] = useState(false);
  const [scannedCode, setScannedCode] = useState("");
  const [activeCustomer, setActiveCustomer] = useState<{ userId: string; wristbandId: string | null } | null>(null);

  useEffect(() => {
    const storedCircleId = localStorage.getItem("circleId");
    if (storedCircleId) setCircleId(storedCircleId);
  }, []);

  const { data: circle } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
  });

  const { data: menus, isLoading: menusLoading } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });

  const { data: toppings } = useQuery({
    queryKey: ["toppings", circleId],
    queryFn: () => toppingApi.list(circleId),
    enabled: !!circleId,
  });

  const lookupCustomer = useMutation({
    mutationFn: async (code: string) => {
      const parsedCode = extractIdFromCode(code);
      return await wristbandApi.lookup(parsedCode);
    },
    onSuccess: (data) => {
      if (data.user) {
        setActiveCustomer({
          userId: data.user.id,
          wristbandId: data.wristband?.id || null,
        });
        toast.success(`顧客を特定しました: ${data.wristband?.id || data.user.id}`);
        setScannedCode("");
      } else {
        toast.error("ユーザーが見つかりませんでした");
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "照会に失敗しました");
    },
  });

  const createOrder = useMutation({
    mutationFn: async (input: {
      circleId: string;
      userId: string;
      peopleCount: number;
      items: { menuId: string; quantity: number; toppingIds?: string[] }[];
    }) => orderApi.create(input),
    onSuccess: (data) => {
      toast.success(`注文完了！注文番号: ${data.orderNumber}`);
      setCart([]);
      setPeopleCount(1);
      setActiveCustomer(null); // 会計完了後に顧客情報をクリア
      setIsCartPanelOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "注文に失敗しました");
    },
  });

  const isPreOrderEnabled = () => {
    if (!circle?.mods) return false;
    try {
      const parsed = JSON.parse(circle.mods);
      return parsed.installed?.["circle-pre-order-cod"]?.enabled ?? false;
    } catch { return false; }
  };

  const getActiveMods = () => {
    if (!circle?.mods) return [];
    try {
      const parsed = JSON.parse(circle.mods);
      return Object.values(parsed.installed || {}).filter((m: any) => m.enabled);
    } catch { return []; }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).FesOrderRegister = { circleId, circle, menus, toppings };
    }
  }, [circleId, circle, menus, toppings]);

  const addToCart = (menuId: string, menuName: string, menuPrice: number) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.menuId === menuId);
      if (existing) return prev.map((i) => i.menuId === menuId ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { menuId, menuName, menuPrice, quantity: 1, toppings: [] }];
    });
  };

  const removeFromCart = (menuId: string) => setCart((prev) => prev.filter((i) => i.menuId !== menuId));

  const updateQuantity = (menuId: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) => i.menuId === menuId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
        .filter((i) => i.quantity > 0)
    );
  };

  const addToppingToItem = (menuId: string, toppingId: string, toppingName: string, toppingPrice: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.menuId !== menuId) return item;
        const has = item.toppings.some((t) => t.toppingId === toppingId);
        return {
          ...item,
          toppings: has
            ? item.toppings.filter((t) => t.toppingId !== toppingId)
            : [...item.toppings, { toppingId, toppingName, toppingPrice }],
        };
      })
    );
  };

  const getTotalPrice = () =>
    cart.reduce((total, item) => {
      const base = item.menuPrice * item.quantity;
      const tops = item.toppings.reduce((s, t) => s + t.toppingPrice, 0) * item.quantity;
      return total + base + tops;
    }, 0);

  const getTotalCount = () => cart.reduce((s, i) => s + i.quantity, 0);

  const handleSubmitOrder = async () => {
    if (cart.length === 0) { toast.error("カートが空です"); return; }
    if (!activeCustomer) { toast.error("顧客が特定されていません。リストバンド/QRをスキャンしてください"); return; }
    await createOrder.mutateAsync({
      circleId,
      userId: activeCustomer.userId,
      peopleCount,
      items: cart.map((i) => ({ menuId: i.menuId, quantity: i.quantity, toppingIds: i.toppings.map((t) => t.toppingId) })),
    });
  };

  const clearCart = () => { setCart([]); toast.info("カートをクリア"); };

  if (menusLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-64" />)}
        </div>
      </div>
    );
  }

  const preOrderActive = isPreOrderEnabled();

  return (
    <div className="relative">
      <QrScannerModal circleId={circleId} isOpen={isQrModalOpen} onClose={() => setIsQrModalOpen(false)} />
      <QrScannerModal
        circleId={circleId}
        isOpen={isCustomerQrModalOpen}
        onClose={() => setIsCustomerQrModalOpen(false)}
        mode="customer"
        onCustomerScanned={(userId, wristbandId) => setActiveCustomer({ userId, wristbandId })}
      />

      {/* ===== メニュー一覧 ===== */}
      <div className="p-3 sm:p-4 pb-32">
        {/* ヘッダーバー */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-primary p-3 sm:p-4 text-primary-foreground border-thick border-border mb-4">
          <h1 className="font-mono text-lg sm:text-2xl font-black uppercase tracking-wider">
            [レジ - 注文入力]
          </h1>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="accent"
              onClick={() => setIsCustomerQrModalOpen(true)}
              className="h-10 sm:h-12 text-xs sm:text-sm uppercase tracking-wider"
            >
              <QrCode className="mr-1 sm:mr-2 h-4 w-4 sm:h-5 sm:w-5" />
              [顧客スキャン(カメラ)]
            </Button>
            {preOrderActive && (
              <Button
                variant="outline"
                onClick={() => setIsQrModalOpen(true)}
                className="h-10 sm:h-12 text-xs sm:text-sm uppercase tracking-wider bg-background text-foreground"
              >
                <QrCode className="mr-1 sm:mr-2 h-4 w-4 sm:h-5 sm:w-5" />
                [QR受取 (事前注文)]
              </Button>
            )}
            {getActiveMods().map((mod: any) => {
              const hook = mod.manifest?.hooks?.registerAction;
              if (!hook) return null;
              return (
                <div key={`${mod.manifest.id}-register-action`}>
                  <ModSandbox
                    modId={mod.manifest.id}
                    hookName="registerAction"
                    html={typeof hook === "string" ? hook : undefined}
                    jsUrl={typeof hook === "object" ? hook.js : undefined}
                    cssUrl={typeof hook === "object" ? hook.css : undefined}
                    data={{ circleId, circle, menus, toppings, cart }}
                    onAction={(actionType, payload) => {
                      if (actionType === "ADD_TO_CART") addToCart(payload.menuId, payload.menuName, payload.menuPrice);
                      else if (actionType === "CLEAR_CART") clearCart();
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== 顧客特定スキャンパネル (2026-07-04 リストバンド/QR必須化) ===== */}
        <Card className="mb-4 bg-muted/40 rounded-none">
          <CardContent className="p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono">
            <div className="space-y-1">
              <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider">
                [顧客特定スキャン]
              </h3>
              {activeCustomer ? (
                <div className="flex items-center gap-2 text-success font-black text-xs sm:text-sm">
                  <span className="w-2.5 h-2.5 bg-success rounded-full animate-pulse" />
                  スキャン完了: ゲストID [{activeCustomer.userId}]
                  {activeCustomer.wristbandId && ` (リストバンド: ${activeCustomer.wristbandId})`}
                </div>
              ) : (
                <p className="text-destructive font-black text-xs sm:text-sm animate-pulse">
                  【警告: 顧客未スキャン】 注文を確定するには、お客様のリストバンドまたはスマホQRコードのスキャンが必要です。
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Input
                type="text"
                placeholder="QR / リストバンドIDを入力..."
                className="h-10 border-thick border-border font-mono text-xs rounded-none bg-background focus-visible:ring-0 flex-1 md:w-60"
                value={scannedCode}
                onChange={(e) => setScannedCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (scannedCode.trim()) lookupCustomer.mutate(scannedCode.trim());
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={lookupCustomer.isPending || !scannedCode.trim()}
                onClick={() => lookupCustomer.mutate(scannedCode.trim())}
                className="h-10 border-thick border-border font-mono text-xs rounded-none bg-background hover:bg-primary hover:text-primary-foreground shrink-0"
              >
                特定
              </Button>
              {activeCustomer && (
                <Button
                  variant="destructive"
                  onClick={() => {
                    setActiveCustomer(null);
                    toast.info("顧客情報をクリアしました");
                  }}
                  className="h-10 border-thick border-border font-mono text-xs rounded-none shrink-0"
                >
                  クリア
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* メニューグリッド */}
        <div className="grid gap-3 sm:gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3">
          {menus?.map((menu) => (
            <Card key={menu.id} className={menu.soldOut ? "opacity-60" : ""}>
              <CardHeader className="p-0">
                <div className="relative h-32 sm:h-40 w-full overflow-hidden border-b-thick border-border">
                  {menu.imagePath ? (
                    <img src={menu.imagePath} alt={menu.name} className="object-cover absolute inset-0 h-full w-full" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <span className="font-mono text-[11px] sm:text-[14px] uppercase tracking-[1px]">No Image</span>
                    </div>
                  )}
                  {menu.soldOut && (
                    <div className="absolute inset-0 bg-foreground/85 flex items-center justify-center">
                      <span className="text-background text-[18px] sm:text-[24px] font-headline uppercase tracking-[2px]">売り切れ</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-2 sm:p-4 space-y-2">
                <CardTitle className="text-sm sm:text-lg leading-tight">{menu.name}</CardTitle>
                <p className="text-lg sm:text-xl font-headline">¥{menu.price.toLocaleString()}</p>
                {menu.stockQuantity != null && menu.stockQuantity > 0 && (
                  <p className="text-xs font-mono text-muted-foreground">在庫: {menu.stockQuantity}個</p>
                )}
                <Button
                  className="w-full h-10 sm:h-11 border-thick border-border bg-primary text-primary-foreground font-mono text-xs sm:text-sm font-bold uppercase rounded-none hover:bg-background hover:text-foreground transition-all"
                  onClick={() => addToCart(menu.id, menu.name, menu.price)}
                  disabled={menu.soldOut}
                >
                  <ShoppingCart className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                  追加
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 外部モッドインジェクション */}
        {getActiveMods().map((mod: any) => {
          const hook = mod.manifest?.hooks?.registerBodyBottom;
          if (!hook) return null;
          return (
            <div key={`${mod.manifest.id}-register-body-bottom`} className="w-full mt-4">
              <ModSandbox
                modId={mod.manifest.id}
                hookName="registerBodyBottom"
                html={typeof hook === "string" ? hook : undefined}
                jsUrl={typeof hook === "object" ? hook.js : undefined}
                cssUrl={typeof hook === "object" ? hook.css : undefined}
                data={{ circleId, circle, menus, toppings, cart }}
                onAction={(actionType, payload) => {
                  if (actionType === "ADD_TO_CART") addToCart(payload.menuId, payload.menuName, payload.menuPrice);
                  else if (actionType === "CLEAR_CART") clearCart();
                }}
              />
            </div>
          );
        })}
      </div>

      {/* ===== モバイル固定カートフッターバー ===== */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-primary text-primary-foreground border-t-heavy border-border">
          <button
            onClick={() => setIsCartPanelOpen(true)}
            className="w-full flex items-center justify-between px-4 py-3 sm:py-4 font-mono"
          >
            <div className="flex items-center gap-3">
              <span className="bg-background text-foreground px-2 py-0.5 text-xs font-black uppercase">
                {getTotalCount()}点
              </span>
              <span className="text-xl sm:text-2xl font-black">
                ¥{getTotalPrice().toLocaleString()}
              </span>
            </div>
            <span className="flex items-center gap-2 border-thick border-primary-foreground px-4 py-2 font-black uppercase text-sm tracking-wider hover:bg-primary-foreground hover:text-primary transition-all">
              <ShoppingCart className="h-4 w-4" />
              カートを見る
            </span>
          </button>
        </div>
      )}

      {/* ===== カートパネル（スライドアップ） ===== */}
      {isCartPanelOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* オーバーレイ */}
          <div
            className="absolute inset-0 bg-foreground/60"
            onClick={() => setIsCartPanelOpen(false)}
          />
          {/* パネル本体 */}
          <div className="relative w-full sm:max-w-lg bg-background border-t-heavy sm:border-heavy border-border max-h-[90vh] flex flex-col font-mono">
            {/* パネルヘッダー */}
            <div className="flex items-center justify-between px-4 py-3 border-b-thick border-border bg-primary text-primary-foreground">
              <h2 className="font-black text-lg uppercase">[カート確認]</h2>
              <button
                onClick={() => setIsCartPanelOpen(false)}
                className="w-10 h-10 border-thin border-primary-foreground flex items-center justify-center hover:bg-primary-foreground hover:text-primary transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* カートアイテム一覧 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.map((item) => (
                <div key={item.menuId} className="border-thick border-border p-3 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{item.menuName}</p>
                      <p className="text-xs text-muted-foreground">¥{item.menuPrice.toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.menuId)}
                      className="w-8 h-8 border-thin border-border flex items-center justify-center hover:bg-error hover:text-white shrink-0 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {/* トッピング */}
                  {toppings && toppings.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-bold uppercase tracking-wider">トッピング:</p>
                      {toppings.map((topping) => (
                        <label key={topping.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={item.toppings.some((t) => t.toppingId === topping.id)}
                            onChange={() => addToppingToItem(item.menuId, topping.id, topping.name, topping.price)}
                            disabled={topping.soldOut}
                            className="w-4 h-4"
                          />
                          <span>{topping.name} (+¥{topping.price})</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* 数量 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center border-thin border-border">
                      <button
                        onClick={() => updateQuantity(item.menuId, -1)}
                        className="w-10 h-10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all border-r-thin border-border"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-10 text-center font-black text-lg">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.menuId, 1)}
                        className="w-10 h-10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all border-l-thin border-border"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="font-bold">
                      ¥{((item.menuPrice + item.toppings.reduce((s, t) => s + t.toppingPrice, 0)) * item.quantity).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* パネルフッター */}
            <div className="p-4 border-t-thick border-border space-y-3 bg-background">
              {/* 人数 */}
              <div className="flex items-center gap-3">
                <Label htmlFor="peopleCount" className="font-mono text-xs uppercase tracking-wider whitespace-nowrap">来店人数</Label>
                <Input
                  id="peopleCount"
                  type="number"
                  min="1"
                  className="h-10 text-center font-bold border-thick border-border rounded-none"
                  value={peopleCount}
                  onChange={(e) => setPeopleCount(Number(e.target.value))}
                />
              </div>
              {/* 合計 */}
              <div className="flex justify-between items-center border-thick border-border px-4 py-3 bg-muted">
                <span className="font-mono text-sm uppercase tracking-wider">合計金額</span>
                <span className="font-headline text-2xl sm:text-3xl font-black">¥{getTotalPrice().toLocaleString()}</span>
              </div>
              {/* 顧客情報サマリー */}
              {activeCustomer && (
                <div className="border-thick border-border bg-muted/20 p-2 text-xs font-mono">
                  選択中の顧客: [{activeCustomer.userId}]
                  {activeCustomer.wristbandId && ` (リストバンド: ${activeCustomer.wristbandId})`}
                </div>
              )}
              {/* 注文確定ブロック理由の明示 (UX-IMPROVEMENTS A-3: ボタンが無効な理由をその場で伝える) */}
              {(!activeCustomer || cart.length === 0) && (
                <div className="border-thick border-destructive bg-destructive/10 p-2 space-y-1 font-mono text-[10px] uppercase tracking-wider text-destructive">
                  {!activeCustomer && (
                    <p>[顧客未スキャン — リストバンド/QRをスキャンしてください]</p>
                  )}
                  {cart.length === 0 && (
                    <p>[カートが空です — 商品を選択してください]</p>
                  )}
                </div>
              )}
              {/* ボタン群 */}
              <Button
                className="w-full h-14 border-thick border-border bg-primary text-primary-foreground font-mono text-base font-black uppercase rounded-none hover:bg-background hover:text-foreground transition-all"
                onClick={handleSubmitOrder}
                disabled={cart.length === 0 || createOrder.isPending || !activeCustomer}
              >
                {createOrder.isPending ? "注文中..." : "注文を確定する"}
              </Button>
              <Button
                variant="outline"
                className="w-full border-thick border-border rounded-none font-mono uppercase"
                onClick={clearCart}
              >
                カートをクリア
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <CircleAuthGuard>
      <RegisterPageContent />
    </CircleAuthGuard>
  );
}

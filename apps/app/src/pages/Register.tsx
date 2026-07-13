
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CircleAuthGuard } from "@/hooks/useCircleAuth";
import { menuApi, toppingApi, orderApi, circleApi, eventApi, wristbandApi, parseCircleSettings, parseEventPaymentMethods, type MenuWithToppings, type Topping } from "@/lib/api";
import { extractIdFromCode, cn } from "@/lib/utils";
import { undoableAction } from "@/lib/toast-undo";
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
import { ErrorState } from "@/components/ui/ErrorState";
import { toast } from "sonner";
import { Minus, Plus, ShoppingCart, Trash2, QrCode, X, ScanLine } from "lucide-react";

// カートは「行 (line)」単位。同じメニューでもトッピング構成が違えば別行として持てるように
// menuId ではなく lineId をキーにする (トッピングあり/なしを同時注文したい要件のため)。
interface CartTopping {
  toppingId: string;
  toppingName: string;
  toppingPrice: number;
}
interface CartLine {
  lineId: string;
  menuId: string;
  menuName: string;
  menuPrice: number;
  quantity: number;
  toppings: CartTopping[];
}

// メニュー + トッピング構成の同一性キー。トッピング順序に依存しないよう sort する。
const lineKey = (menuId: string, toppingIds: string[]) =>
  `${menuId}::${[...toppingIds].sort().join(",")}`;

const lineSubtotal = (line: CartLine) =>
  (line.menuPrice + line.toppings.reduce((s, t) => s + t.toppingPrice, 0)) * line.quantity;

// メニューカード。カート追加前にこのカード上でトッピングを選べるようにするための
// ローカル選択状態を持つ。追加後は既定トッピングへリセットして次の注文に備える。
function MenuCard({
  menu,
  onAdd,
}: {
  menu: MenuWithToppings;
  onAdd: (menu: MenuWithToppings, toppings: CartTopping[]) => void;
}) {
  // 既定トッピング: menu.defaultToppingIds のうち、このメニューに紐づく売切れでないもの。
  const defaultIds = () => {
    let ids: string[] = [];
    try {
      ids = menu.defaultToppingIds ? JSON.parse(menu.defaultToppingIds) : [];
    } catch {
      ids = [];
    }
    return new Set(
      menu.toppings.filter((t) => ids.includes(t.id) && !t.soldOut).map((t) => t.id)
    );
  };

  const [selected, setSelected] = useState<Set<string>>(defaultIds);

  // メニュー(既定トッピング)が変わったら選択状態を作り直す
  useEffect(() => {
    setSelected(defaultIds());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.id, menu.defaultToppingIds]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const availableToppings = menu.toppings ?? [];
  const selectedExtra = availableToppings
    .filter((t) => selected.has(t.id))
    .reduce((s, t) => s + t.price, 0);

  const handleAdd = () => {
    const chosen: CartTopping[] = availableToppings
      .filter((t) => selected.has(t.id))
      .map((t) => ({ toppingId: t.id, toppingName: t.name, toppingPrice: t.price }));
    onAdd(menu, chosen);
    setSelected(defaultIds()); // 次の1品のために既定へ戻す
  };

  return (
    <Card className={menu.soldOut ? "opacity-60" : ""}>
      <CardHeader className="p-0">
        <div className="relative h-28 sm:h-36 w-full overflow-hidden border-b-thick border-border">
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
      <CardContent className="p-2 sm:p-3 space-y-2">
        <CardTitle className="text-sm sm:text-lg leading-tight">{menu.name}</CardTitle>
        <p className="text-lg sm:text-xl font-headline">¥{menu.price.toLocaleString()}</p>
        {menu.stockQuantity != null && menu.stockQuantity > 0 && (
          <p className="text-xs font-mono text-muted-foreground">在庫: {menu.stockQuantity}個</p>
        )}

        {/* カート追加前のトッピング選択 (このメニューに紐づくトッピングのみ) */}
        {availableToppings.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
              トッピング (追加前に選択)
            </p>
            <div className="flex flex-wrap gap-1">
              {availableToppings.map((t) => {
                const on = selected.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={t.soldOut || menu.soldOut}
                    onClick={() => toggle(t.id)}
                    className={cn(
                      "flex items-center gap-1 border-thin px-1.5 py-0.5 text-[10px] sm:text-xs font-bold rounded-none transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted"
                    )}
                  >
                    {t.imagePath && (
                      <img src={t.imagePath} alt="" className="h-4 w-4 object-cover border-thin border-current shrink-0" />
                    )}
                    <span className="truncate max-w-[80px]">{t.name}</span>
                    <span className={on ? "opacity-80" : "text-muted-foreground"}>
                      {t.price >= 0 ? `+¥${t.price}` : `-¥${Math.abs(t.price)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Button
          className="w-full h-10 sm:h-11 border-thick border-border bg-primary text-primary-foreground font-mono text-xs sm:text-sm font-bold uppercase rounded-none hover:bg-background hover:text-foreground transition-all"
          onClick={handleAdd}
          disabled={menu.soldOut}
        >
          <ShoppingCart className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
          追加{selectedExtra !== 0 && ` (¥${(menu.price + selectedExtra).toLocaleString()})`}
        </Button>
      </CardContent>
    </Card>
  );
}

// カート本体。デスクトップのサイドバーとモバイルのスライドアップの両方で使い回す。
function CartBody({
  cart,
  menuMap,
  peopleCount,
  activeCustomer,
  submitting,
  onToggleTopping,
  onUpdateQuantity,
  onRemoveLine,
  onSetPeople,
  onSubmit,
  onClear,
  total,
  paymentMethods,
  paymentMethod,
  onSetPayment,
}: {
  cart: CartLine[];
  menuMap: Map<string, MenuWithToppings>;
  peopleCount: number;
  activeCustomer: { userId: string; wristbandId: string | null } | null;
  submitting: boolean;
  onToggleTopping: (lineId: string, topping: Topping) => void;
  onUpdateQuantity: (lineId: string, delta: number) => void;
  onRemoveLine: (lineId: string) => void;
  onSetPeople: (n: number) => void;
  onSubmit: () => void;
  onClear: () => void;
  total: number;
  // 支払い方法 (2026-07-12)。要素が2つ以上のときだけ選択UIを出す。
  paymentMethods: string[];
  paymentMethod: string;
  onSetPayment: (m: string) => void;
}) {
  // 支払い方法が2つ以上あるのに未選択なら確定を止める。
  const needsPayment = paymentMethods.length > 1 && !paymentMethod;
  return (
    <div className="flex flex-col h-full font-mono">
      {/* アイテム一覧 */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        {cart.length === 0 ? (
          <div className="border-thick border-dashed border-border p-8 text-center text-muted-foreground text-xs uppercase tracking-wider">
            カートは空です
          </div>
        ) : (
          cart.map((line) => {
            const allowed = menuMap.get(line.menuId)?.toppings ?? [];
            return (
              <div key={line.lineId} className="border-thick border-border p-3 space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{line.menuName}</p>
                    <p className="text-xs text-muted-foreground">¥{line.menuPrice.toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => onRemoveLine(line.lineId)}
                    className="w-8 h-8 border-thin border-border flex items-center justify-center hover:bg-error hover:text-white shrink-0 transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* トッピング調整 (カート内でも変更可。タップでトグル) */}
                {allowed.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wider">トッピング:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allowed.map((topping) => {
                        const on = line.toppings.some((t) => t.toppingId === topping.id);
                        return (
                          <button
                            key={topping.id}
                            type="button"
                            disabled={topping.soldOut}
                            onClick={() => onToggleTopping(line.lineId, topping)}
                            className={cn(
                              "flex items-center gap-1.5 border-thick rounded-none px-2 py-1 text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background hover:bg-muted"
                            )}
                          >
                            {topping.imagePath && (
                              <img src={topping.imagePath} alt="" className="h-5 w-5 object-cover border-thin border-current shrink-0" />
                            )}
                            <span>{topping.name}</span>
                            <span className={on ? "opacity-80" : "text-muted-foreground"}>
                              {topping.price >= 0 ? `+¥${topping.price}` : `-¥${Math.abs(topping.price)}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 数量 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center border-thin border-border">
                    <button
                      onClick={() => onUpdateQuantity(line.lineId, -1)}
                      className="w-10 h-10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all border-r-thin border-border"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-10 text-center font-black text-lg">{line.quantity}</span>
                    <button
                      onClick={() => onUpdateQuantity(line.lineId, 1)}
                      className="w-10 h-10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all border-l-thin border-border"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="font-bold">¥{lineSubtotal(line).toLocaleString()}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* フッター (合計・人数・確定) */}
      <div className="p-3 sm:p-4 border-t-thick border-border space-y-3 bg-background">
        <div className="flex items-center gap-3">
          <Label htmlFor="peopleCount" className="font-mono text-xs uppercase tracking-wider whitespace-nowrap">来店人数</Label>
          <Input
            id="peopleCount"
            type="number"
            min="1"
            className="h-10 text-center font-bold border-thick border-border rounded-none"
            value={peopleCount}
            onChange={(e) => onSetPeople(Number(e.target.value))}
          />
        </div>
        <div className="flex justify-between items-center border-thick border-border px-4 py-3 bg-muted">
          <span className="font-mono text-sm uppercase tracking-wider">合計金額</span>
          <span className="font-headline text-2xl sm:text-3xl font-black">¥{total.toLocaleString()}</span>
        </div>

        {/* 支払い方法の選択 (対応が2つ以上のサークルのみ表示。1つなら自動採用) */}
        {paymentMethods.length > 1 && (
          <div className="space-y-1.5">
            <p className="font-mono text-xs uppercase tracking-wider">支払い方法</p>
            <div className="grid grid-cols-2 gap-1.5">
              {paymentMethods.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSetPayment(m)}
                  className={cn(
                    "border-thick rounded-none px-2 py-2.5 text-sm font-bold transition-all",
                    paymentMethod === m
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
        {activeCustomer && (
          <div className="border-thick border-border bg-muted/20 p-2 text-xs font-mono">
            選択中の顧客: [{activeCustomer.userId}]
            {activeCustomer.wristbandId && ` (リストバンド: ${activeCustomer.wristbandId})`}
          </div>
        )}
        {(!activeCustomer || cart.length === 0) && (
          <div className="border-thick border-destructive bg-destructive/10 p-2 space-y-1 font-mono text-[10px] uppercase tracking-wider text-destructive">
            {!activeCustomer && <p>[顧客未スキャン — リストバンド/QRをスキャンしてください]</p>}
            {cart.length === 0 && <p>[カートが空です — 商品を選択してください]</p>}
          </div>
        )}
        <Button
          className="w-full h-14 border-thick border-border bg-primary text-primary-foreground font-mono text-base font-black uppercase rounded-none hover:bg-background hover:text-foreground transition-all"
          onClick={onSubmit}
          disabled={cart.length === 0 || submitting || !activeCustomer || needsPayment}
        >
          {submitting ? "注文中..." : needsPayment ? "支払い方法を選択" : "注文を確定する"}
        </Button>
        {cart.length > 0 && (
          <Button
            variant="outline"
            className="w-full border-thick border-border rounded-none font-mono uppercase"
            onClick={onClear}
          >
            カートをクリア
          </Button>
        )}
      </div>
    </div>
  );
}

function RegisterPageContent() {
  const [circleId, setCircleId] = useState<string>("");
  const [cart, setCart] = useState<CartLine[]>([]);
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

  // 支払い方法 (2026-07-12): サークルの対応方法 ∩ イベントの方法。
  // サークルが未指定ならイベントの全方法。1つだけならレジで選択させず自動採用する。
  const { data: registerEvent } = useQuery({
    queryKey: ["event", circle?.eventId],
    queryFn: () => eventApi.get(circle!.eventId),
    enabled: !!circle?.eventId,
  });
  const effectivePayments = (() => {
    const eventMethods = parseEventPaymentMethods(registerEvent?.paymentMethods);
    const accepted = parseCircleSettings(circle?.settings).acceptedPayments;
    const list = accepted.length > 0 ? accepted.filter((p) => eventMethods.includes(p)) : eventMethods;
    return list.length > 0 ? list : eventMethods;
  })();
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  // 対応が1つだけなら自動採用。選択肢が変わって現在値が無効になったらリセット。
  useEffect(() => {
    if (effectivePayments.length === 1) setPaymentMethod(effectivePayments[0]!);
    else if (paymentMethod && !effectivePayments.includes(paymentMethod)) setPaymentMethod("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePayments.join("|")]);

  const {
    data: menus,
    isLoading: menusLoading,
    isError: menusError,
    error: menusErrorObj,
    refetch: refetchMenus,
  } = useQuery({
    queryKey: ["menus", circleId],
    queryFn: () => menuApi.list(circleId),
    enabled: !!circleId,
  });

  const { data: toppings } = useQuery({
    queryKey: ["toppings", circleId],
    queryFn: () => toppingApi.list(circleId),
    enabled: !!circleId,
  });

  // カート内トッピング編集用に menuId → メニュー(許可トッピング付き)を引けるようにする
  const menuMap = new Map((menus ?? []).map((m) => [m.id, m]));

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
      paymentMethod?: string;
    }) => orderApi.create(input),
    onSuccess: (data) => {
      toast.success(`注文完了！注文番号: ${data.orderNumber}`);
      setCart([]);
      setPeopleCount(1);
      setActiveCustomer(null); // 会計完了後に顧客情報をクリア
      setIsCartPanelOpen(false);
      // 支払い方法は次の会計で選び直す (単一方法は effect で再セットされる)
      setPaymentMethod("");
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

  // カードで選んだトッピング付きで1行追加。トッピング構成まで同一なら数量+1、違えば別行。
  const addLine = (menu: MenuWithToppings, chosen: CartTopping[]) => {
    setCart((prev) => {
      const key = lineKey(menu.id, chosen.map((t) => t.toppingId));
      const existing = prev.find((l) => lineKey(l.menuId, l.toppings.map((t) => t.toppingId)) === key);
      if (existing) {
        return prev.map((l) => (l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          menuId: menu.id,
          menuName: menu.name,
          menuPrice: menu.price,
          quantity: 1,
          toppings: chosen,
        },
      ];
    });
  };

  const removeLine = (lineId: string) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));

  const updateQuantity = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const toggleTopping = (lineId: string, topping: Topping) => {
    setCart((prev) =>
      prev.map((line) => {
        if (line.lineId !== lineId) return line;
        const has = line.toppings.some((t) => t.toppingId === topping.id);
        return {
          ...line,
          toppings: has
            ? line.toppings.filter((t) => t.toppingId !== topping.id)
            : [...line.toppings, { toppingId: topping.id, toppingName: topping.name, toppingPrice: topping.price }],
        };
      })
    );
  };

  const getTotalPrice = () => cart.reduce((total, line) => total + lineSubtotal(line), 0);
  const getTotalCount = () => cart.reduce((s, l) => s + l.quantity, 0);

  const handleSubmitOrder = async () => {
    if (cart.length === 0) { toast.error("カートが空です"); return; }
    if (!activeCustomer) { toast.error("顧客が特定されていません。リストバンド/QRをスキャンしてください"); return; }
    if (effectivePayments.length > 1 && !paymentMethod) { toast.error("支払い方法を選択してください"); return; }
    await createOrder.mutateAsync({
      circleId,
      userId: activeCustomer.userId,
      peopleCount,
      items: cart.map((l) => ({ menuId: l.menuId, quantity: l.quantity, toppingIds: l.toppings.map((t) => t.toppingId) })),
      // 1つだけの場合は空でもサーバが補完するが、選択済みなら明示的に送る。
      paymentMethod: paymentMethod || undefined,
    });
  };

  const clearCart = () => {
    const prev = cart;
    undoableAction({
      message: "カートをクリアしました",
      optimistic: () => setCart([]),
      commit: () => {}, // クライアントのみ (サーバ反映なし)
      rollback: () => setCart(prev),
    });
  };

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

  if (menusError) {
    return (
      <div className="p-4">
        <ErrorState error={menusErrorObj} onRetry={() => refetchMenus()} />
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

      {/* 横幅に余裕がある画面 (xl+) はカートを右サイドバー固定、狭い画面は下部バー+スライドアップ */}
      <div className="xl:flex xl:items-start xl:gap-4">
        {/* ===== メニュー一覧 (メインカラム) ===== */}
        <div className="flex-1 min-w-0 p-3 sm:p-4 pb-32 xl:pb-4">
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
                        if (actionType === "ADD_TO_CART") {
                          const m = menuMap.get(payload.menuId);
                          if (m) addLine(m, []);
                        } else if (actionType === "CLEAR_CART") clearCart();
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== 顧客未スキャン時: 画面中央に大きなカメラQRボタン ===== */}
          {!activeCustomer ? (
            <div className="mb-4 border-thick border-border bg-muted/40 p-6 sm:p-10 flex flex-col items-center justify-center gap-4 text-center font-mono">
              <p className="text-destructive font-black text-xs sm:text-sm uppercase tracking-wider animate-pulse">
                【顧客未スキャン】注文の確定にはリストバンド / スマホQRのスキャンが必要です
              </p>
              <button
                onClick={() => setIsCustomerQrModalOpen(true)}
                className="flex flex-col items-center gap-3 border-heavy border-border bg-primary text-primary-foreground px-8 py-6 sm:px-12 sm:py-8 hover:bg-background hover:text-foreground transition-all"
              >
                <ScanLine className="h-12 w-12 sm:h-16 sm:w-16" />
                <span className="font-black uppercase tracking-widest text-base sm:text-xl">QRをスキャン</span>
              </button>
              {/* 手入力フォールバック */}
              <div className="flex items-center gap-2 w-full max-w-md">
                <Input
                  type="text"
                  placeholder="または QR / リストバンドIDを入力..."
                  className="h-10 border-thick border-border font-mono text-xs rounded-none bg-background focus-visible:ring-0 flex-1"
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
              </div>
            </div>
          ) : (
            // スキャン済みは小さなステータスバーに畳む
            <Card className="mb-4 bg-muted/40 rounded-none">
              <CardContent className="p-3 flex items-center justify-between gap-4 font-mono">
                <div className="flex items-center gap-2 text-success font-black text-xs sm:text-sm">
                  <span className="w-2.5 h-2.5 bg-success rounded-full animate-pulse" />
                  スキャン完了: ゲストID [{activeCustomer.userId}]
                  {activeCustomer.wristbandId && ` (リストバンド: ${activeCustomer.wristbandId})`}
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setActiveCustomer(null)}
                  className="h-9 border-thick border-border font-mono text-xs rounded-none shrink-0"
                >
                  クリア
                </Button>
              </CardContent>
            </Card>
          )}

          {/* メニューグリッド */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
            {menus?.map((menu) => (
              <MenuCard key={menu.id} menu={menu} onAdd={addLine} />
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
                    if (actionType === "ADD_TO_CART") {
                      const m = menuMap.get(payload.menuId);
                      if (m) addLine(m, []);
                    } else if (actionType === "CLEAR_CART") clearCart();
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* ===== デスクトップ用: 右サイドバーの常設カート (xl+) ===== */}
        <aside className="hidden xl:flex xl:flex-col xl:sticky xl:top-4 xl:w-[380px] xl:shrink-0 xl:max-h-[calc(100vh-2rem)] border-heavy border-border bg-background">
          <div className="flex items-center justify-between px-4 py-3 border-b-thick border-border bg-primary text-primary-foreground">
            <h2 className="font-black text-lg uppercase font-mono">[カート]</h2>
            <span className="bg-background text-foreground px-2 py-0.5 text-xs font-black uppercase font-mono">
              {getTotalCount()}点
            </span>
          </div>
          <CartBody
            cart={cart}
            menuMap={menuMap}
            peopleCount={peopleCount}
            activeCustomer={activeCustomer}
            submitting={createOrder.isPending}
            onToggleTopping={toggleTopping}
            onUpdateQuantity={updateQuantity}
            onRemoveLine={removeLine}
            onSetPeople={setPeopleCount}
            onSubmit={handleSubmitOrder}
            onClear={clearCart}
            total={getTotalPrice()}
            paymentMethods={effectivePayments}
            paymentMethod={paymentMethod}
            onSetPayment={setPaymentMethod}
          />
        </aside>
      </div>

      {/* ===== モバイル/タブレット: 固定カートフッターバー (xl 未満のみ) ===== */}
      {cart.length > 0 && (
        <div className="xl:hidden fixed bottom-0 left-0 right-0 z-40 bg-primary text-primary-foreground border-t-heavy border-border">
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

      {/* ===== モバイル/タブレット: カートパネル（スライドアップ, xl 未満のみ） ===== */}
      {isCartPanelOpen && (
        <div className="xl:hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/60" onClick={() => setIsCartPanelOpen(false)} />
          <div className="relative w-full sm:max-w-lg bg-background border-t-heavy sm:border-heavy border-border max-h-[90vh] flex flex-col font-mono">
            <div className="flex items-center justify-between px-4 py-3 border-b-thick border-border bg-primary text-primary-foreground">
              <h2 className="font-black text-lg uppercase">[カート確認]</h2>
              <button
                onClick={() => setIsCartPanelOpen(false)}
                className="w-10 h-10 border-thin border-primary-foreground flex items-center justify-center hover:bg-primary-foreground hover:text-primary transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <CartBody
              cart={cart}
              menuMap={menuMap}
              peopleCount={peopleCount}
              activeCustomer={activeCustomer}
              submitting={createOrder.isPending}
              onToggleTopping={toggleTopping}
              onUpdateQuantity={updateQuantity}
              onRemoveLine={removeLine}
              onSetPeople={setPeopleCount}
              onSubmit={handleSubmitOrder}
              onClear={clearCart}
              total={getTotalPrice()}
              paymentMethods={effectivePayments}
              paymentMethod={paymentMethod}
              onSetPayment={setPaymentMethod}
            />
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

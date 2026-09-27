
import { useEffect, useState, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ModSandbox } from "@/components/ModSandbox";
import { useQuery, useMutation } from "@tanstack/react-query";
import { eventApi, circleApi, menuApi, preOrderApi, orderApi, type MenuWithToppings, type Topping } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { getCouponsForCircle, removeCouponForCircle, type StoredCoupon } from "@/lib/coupon-storage";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/Modal";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { toast } from "sonner";
import { EventTheme } from "@/components/EventTheme";
import { ShoppingCart, Plus, Minus, CheckCircle, UtensilsCrossed, Ticket, X } from "lucide-react";
import { resolveAssetUrl } from "@/lib/asset-url";

// 2026-07-13: 来場者モバイルオーダーもトッピング対応にするため、レジ (Register.tsx) と同じく
// カートを「行 (line)」単位で持つ。同じメニューでもトッピング構成が違えば別行になる。
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

// メニューカード。トッピング選択と、このメニュー/トッピングに関係するクーポンを
// カード内に直接(モーダルなしで)順番に表示する (2026-09-16)。
// モーダル案は「操作が一段挟まって見えにくい」というフィードバックで撤回し、
// 代わりにボタン/選択肢そのものを大きく・強調を強くして見やすさを確保する方針にした。
function VisitorMenuCard({
  menu,
  relevantCoupons,
  enabledCouponSlugs,
  onToggleCoupon,
  onAdd,
}: {
  menu: MenuWithToppings;
  relevantCoupons: StoredCoupon[];
  enabledCouponSlugs: Set<string>;
  onToggleCoupon: (slug: string) => void;
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
      (menu.toppings ?? []).filter((t) => ids.includes(t.id) && !t.soldOut).map((t) => t.id)
    );
  };

  const [selected, setSelected] = useState<Set<string>>(defaultIds);

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

  // 「使う」がONのfree_toppingクーポンについて、選択中のトッピングのうち無料になる分を
  // 特定する (2026-09-16)。「使うを押したのにトッピングが無料に見えない」という
  // フィードバック対応: トグルするだけでなく、対象トッピングのボタン自体に「無料」と
  // 表示して反映を目に見えるようにする。freeUnits の上限も考慮する (このカード内での近似計算。
  // 最終的な確定額はカート全体の状態から computeCouponDiscount 相当のロジックで算出される)。
  const freeToppingIds = new Set<string>();
  for (const c of relevantCoupons) {
    if (c.kind !== "free_topping" || !enabledCouponSlugs.has(c.slug)) continue;
    const matchingSelected = availableToppings.filter((t) => selected.has(t.id) && c.toppingIds.includes(t.id));
    const freeCount = c.freeUnits ?? matchingSelected.length;
    matchingSelected.slice(0, freeCount).forEach((t) => freeToppingIds.add(t.id));
  }

  const selectedExtra = availableToppings
    .filter((t) => selected.has(t.id))
    .reduce((s, t) => s + (freeToppingIds.has(t.id) ? 0 : t.price), 0);

  const handleAdd = () => {
    const chosen: CartTopping[] = availableToppings
      .filter((t) => selected.has(t.id))
      .map((t) => ({ toppingId: t.id, toppingName: t.name, toppingPrice: t.price }));
    onAdd(menu, chosen);
    setSelected(defaultIds()); // 次の1品のために既定へ戻す
  };

  return (
    <Card className={menu.soldOut ? "opacity-60" : ""}>
      <CardHeader>
        <div className="relative h-48 w-full overflow-hidden border-b-thick border-border">
          {menu.imagePath ? (
            <img
              src={resolveAssetUrl(menu.imagePath)}
              alt={menu.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <span className="font-mono text-[14px] uppercase tracking-[1px]">No Image</span>
            </div>
          )}
          {menu.soldOut && (
            <div className="absolute inset-0 bg-foreground/85 flex items-center justify-center">
              <span className="text-background text-[24px] font-headline uppercase tracking-[2px]">
                売り切れ
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-sp-3">
        <div>
          <CardTitle className="mb-sp-1">{menu.name}</CardTitle>
          <p className="text-[26px] font-headline leading-none">
            ¥{(menu.price + selectedExtra).toLocaleString()}
          </p>
          {menu.description && (
            <CardDescription className="mt-sp-1">{menu.description}</CardDescription>
          )}
        </div>

        {/* トッピング選択: ボタンを大きく・太枠にして選択状態がひと目で分かるようにする */}
        {availableToppings.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-mono font-black uppercase tracking-wider text-foreground">
              トッピングを選ぶ
            </p>
            <div className="flex flex-wrap gap-2">
              {availableToppings.map((t) => {
                const on = selected.has(t.id);
                const isFree = on && freeToppingIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={t.soldOut || menu.soldOut}
                    onClick={() => toggle(t.id)}
                    className={cn(
                      "flex items-center gap-1.5 border-thick px-3 py-2 text-sm font-bold rounded-none transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                      isFree
                        ? "border-success bg-success text-white"
                        : on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-muted"
                    )}
                  >
                    {t.imagePath && (
                      <img src={resolveAssetUrl(t.imagePath)} alt="" className="h-5 w-5 object-cover border-thin border-current shrink-0" />
                    )}
                    <span className="truncate max-w-[110px]">{t.name}</span>
                    {isFree ? (
                      <span className="flex items-center gap-1">
                        <span className="line-through opacity-70">¥{t.price}</span>
                        <span>無料</span>
                      </span>
                    ) : (
                      <span className={on ? "opacity-90" : "text-muted-foreground"}>
                        {t.price >= 0 ? `+¥${t.price}` : `-¥${Math.abs(t.price)}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* この商品/選んだトッピングに関係するクーポン (2026-09-16)。トッピング選択のすぐ下に
            置くことで「どのトッピングを選んだら使えるか」が分かるようにする。 */}
        {relevantCoupons.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-mono font-black uppercase tracking-wider text-foreground">
              使えるクーポン
            </p>
            {relevantCoupons.map((c) => {
              const enabled = enabledCouponSlugs.has(c.slug);
              const toppingMatches = c.kind === "free_topping" && c.toppingIds.some((id) => selected.has(id));
              return (
                <div
                  key={c.slug}
                  className={cn(
                    "flex items-center justify-between gap-3 border-thick p-2.5 transition-colors",
                    enabled ? "border-primary bg-primary/10" : "border-border bg-background"
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-black">
                      <Ticket className="h-4 w-4 shrink-0" />
                      {c.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {c.kind === "free_topping"
                        ? toppingMatches
                          ? "選択中のトッピングが無料になります"
                          : "対象トッピングを選ぶと無料になります"
                        : `¥${c.discountAmount?.toLocaleString()}引き`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleCoupon(c.slug)}
                    className={cn(
                      "border-thick px-4 py-2 text-sm font-black uppercase shrink-0 transition-all",
                      enabled
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted"
                    )}
                  >
                    {enabled ? "使う中" : "使う"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <CardFooter className="border-t-thick border-border pt-4">
        <Button
          onClick={handleAdd}
          disabled={menu.soldOut}
          className="w-full h-14 border-thick border-border bg-primary font-mono text-lg font-black uppercase text-primary-foreground rounded-none hover:bg-background hover:text-foreground transition-colors"
        >
          <ShoppingCart className="mr-2 h-5 w-5" />
          カートに追加
        </Button>
      </CardFooter>
    </Card>
  );
}

function MenuPageContent() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const circleIdParam = searchParams.get("circleId");
  // 未入場 (リストバンド未発行) は空文字。閲覧は許可し注文送信側でゲートする
  const { userId: visitorUserId, session } = useVisitor();
  const userId = visitorUserId ?? "";

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(
    circleIdParam
  );
  const [cart, setCart] = useState<CartLine[]>([]);
  // クーポン適用 (2026-09-16, issue #50)。/visitor/coupon/:slug で合言葉検証済みのものは
  // localStorage (coupon-storage.ts) に複数枚まとめて保存されているので、このサークルの分を
  // 一覧で読み込む (以前は1枚しか保存/表示できず「クーポンが1つしか出ない」不具合になっていた)。
  // 検証済みでも自動では適用せず、客が「クーポン」欄で明示的に選んだものだけ (enabledCouponSlugs) 使う。
  const [appliedCoupons, setAppliedCoupons] = useState<StoredCoupon[]>([]);
  const [enabledCouponSlugs, setEnabledCouponSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setAppliedCoupons(selectedCircleId ? getCouponsForCircle(selectedCircleId) : []);
    setEnabledCouponSlugs(new Set());
  }, [selectedCircleId]);

  const toggleCoupon = (slug: string) =>
    setEnabledCouponSlugs((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });



  // イベント一覧取得
  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ["events"],
    queryFn: () => eventApi.list(),
  });

  // 選択したイベントのサークル一覧取得
  const { data: circles, isLoading: circlesLoading } = useQuery({
    queryKey: ["circles", selectedEventId],
    queryFn: () => circleApi.list(selectedEventId!),
    enabled: !!selectedEventId,
  });

  // 選択したサークルの情報取得
  const {
    data: circleData,
    isLoading: circleLoading,
    isError: circleError,
    error: circleErrorObj,
    refetch: refetchCircle,
  } = useQuery({
    queryKey: ["circle", selectedCircleId],
    queryFn: () => circleApi.get(selectedCircleId!),
    enabled: !!selectedCircleId,
  });

  // 選択したサークルのメニュー取得
  const {
    data: menus,
    isLoading: menusLoading,
    isError: menusError,
    error: menusErrorObj,
    refetch: refetchMenus,
  } = useQuery({
    queryKey: ["menus", selectedCircleId],
    queryFn: () => menuApi.list(selectedCircleId!),
    // 登録済み来場者は、サークルの所属イベント確認後に自分のイベントのメニューだけ取得する。
    enabled: !!selectedCircleId && (!session?.userId || !session.eventId || circleData?.eventId === session.eventId),
  });

  // サークルが属するイベントのテーマ (配色/ロゴ) を取得して画面に反映
  const { data: circleEvent } = useQuery({
    queryKey: ["event", circleData?.eventId],
    queryFn: () => eventApi.get(circleData!.eventId),
    enabled: !!circleData?.eventId,
  });

  useEffect(() => {
    if (circleIdParam) {
      setSelectedCircleId(circleIdParam);
    }
  }, [circleIdParam]);

  // 事前オーダー作成ミューテーション
  const preOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCircleId || cart.length === 0) return;
      if (!userId) throw new Error("注文にはリストバンドの発行(入場)が必要です");
      return await preOrderApi.create({
        userId,
        circleId: selectedCircleId,
        items: cart.map((line) => ({
          menuId: line.menuId,
          quantity: line.quantity,
          toppingIds: line.toppings.map((t) => t.toppingId),
        })),
        // applicableCoupons (客が明示的に「使う」を選んでおり、かつ対象商品がカートにあるものだけ) を
        // 送る。verify 済みというだけで自動送信すると「自動で適用しないで」に反する。
        coupons: applicableCoupons.map((c) => ({ slug: c.slug, passphrase: c.passphrase })),
      });
    },
    onSuccess: () => {
      toast.success("事前オーダーを送信しました！店頭でマイQRを提示してください。");
      setCart([]);
      // クーポンは1人1回までなので、実際に使った (applicableCoupons に含まれる) 分だけ端末側の
      // キャッシュを消す。使わなかったクーポンはまだ枠が残っているので、次の注文のために残しておく。
      if (selectedCircleId && applicableCoupons.length > 0) {
        for (const c of applicableCoupons) {
          removeCouponForCircle(selectedCircleId, c.slug);
        }
        setAppliedCoupons((prev) => prev.filter((c) => !applicableCoupons.some((a) => a.slug === c.slug)));
        setEnabledCouponSlugs(new Set());
      }
      // 送信直後は注文履歴に遷移し、事前オーダーの状態を確認できるようにする (2026-07-11 履歴を /orders に分離)
      navigate("/visitor/orders");
    },
    onError: (error: any) => {
      toast.error(error.message || "事前オーダーの送信に失敗しました");
    },
  });

  // 代引オーダー（本注文）作成ミューテーション
  const codOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCircleId || cart.length === 0) return;
      if (!userId) throw new Error("注文にはリストバンドの発行(入場)が必要です");
      return await orderApi.create({
        circleId: selectedCircleId,
        userId, // 2026-07-04: リストバンド/QR必須化対応
        peopleCount: 1,
        items: cart.map((line) => ({
          menuId: line.menuId,
          quantity: line.quantity,
          toppingIds: line.toppings.map((t) => t.toppingId),
        })),
      });
    },
    onSuccess: (orderData) => {
      if (!orderData) return;
      try {
        const stored = localStorage.getItem("fesorder_direct_orders");
        const directOrders = stored ? JSON.parse(stored) : [];
        directOrders.push({
          orderId: orderData.id,
          orderNumber: orderData.orderNumber,
          circleId: selectedCircleId,
          circleName: circleData?.name || "サークル",
          totalPrice: getTotalPrice(),
          createdAt: new Date().toISOString()
        });
        localStorage.setItem("fesorder_direct_orders", JSON.stringify(directOrders));
      } catch (e) {}

      toast.success(`注文を受け付けました！呼出番号: ${orderData.orderNumber}`);
      setCart([]);
      // 注文直後は注文履歴に遷移し、店頭注文の状態(呼出番号・受取状況)を確認できるようにする (2026-07-11)
      navigate("/visitor/orders");
    },
    onError: (error: any) => {
      toast.error(error.message || "注文の送信に失敗しました");
    },
  });

  const [isCartOpen, setIsCartOpen] = useState(false);



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

  // このメニューに関係するクーポン (2026-09-16)。menu_discount はこのメニューが対象のもの、
  // free_topping はこのメニューに紐づくトッピングのどれかが対象のもの。
  const relevantCouponsForMenu = (menu: MenuWithToppings) =>
    appliedCoupons.filter((c) =>
      c.kind === "menu_discount"
        ? c.menuIds.includes(menu.id)
        : (menu.toppings ?? []).some((t) => c.toppingIds.includes(t.id))
    );

  const updateLineQuantity = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  // カート内でのトッピング変更 (タップでトグル)。lineKey が変わるので別構成の既存行があれば統合する。
  const toggleLineTopping = (lineId: string, topping: Topping) => {
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

  // ── 外部モッド互換 (menuId ベース) ────────────────────────────────
  // 既存モッドは addToCart(menuId,...) / updateQuantity(menuId, delta) を呼ぶため、
  // トッピング無し行に対して従来通り menuId 単位で操作するラッパーを維持する。
  const addToCart = (menuId: string, menuName: string, menuPrice: number) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.menuId === menuId && l.toppings.length === 0);
      if (existing) {
        return prev.map((l) => (l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        { lineId: crypto.randomUUID(), menuId, menuName, menuPrice, quantity: 1, toppings: [] },
      ];
    });
  };

  const updateQuantity = (menuId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.menuId === menuId && l.toppings.length === 0
            ? { ...l, quantity: Math.max(0, l.quantity + delta) }
            : l
        )
        .filter((l) => l.quantity > 0)
    );
  };

  const getTotalCount = () => cart.reduce((sum, l) => sum + l.quantity, 0);
  const getTotalPrice = () => cart.reduce((sum, l) => sum + lineSubtotal(l), 0);

  // カート内トッピング編集用に menuId → メニュー(許可トッピング付き)を引けるようにする
  const menuMap = new Map((menus ?? []).map((m) => [m.id, m]));

  // 有効な外部モッドの一覧取得
  const getActiveMods = () => {
    if (!circleData || !circleData.mods) return [];
    try {
      const parsed = JSON.parse(circleData.mods);
      return Object.values(parsed.installed || {}).filter((m: any) => m.enabled);
    } catch (e) {
      return [];
    }
  };

  const isPreOrderEnabled = () => {
    if (!circleData || !circleData.mods) return false;
    try {
      const parsed = JSON.parse(circleData.mods);
      const preOrderMod = parsed.installed?.["circle-pre-order-cod"];
      return preOrderMod?.enabled ?? false;
    } catch (e) {
      return false;
    }
  };

  // クーポン適用は事前オーダー(preOrderApi)経由のみ対応 (issue #50 スコープ外: COD直販/レジ)。
  // COD (代引き) モッドが有効なサークルでは orderApi.create に割引を渡す経路が無いため、
  // 誤って「割引されると見せて実際は反映されない」ことがないよう表示自体を出さない。
  // 2026-09-16 フィードバック対応: (1) kind に応じて menu_discount (対象メニューの小計から
  // 定額引き) / free_topping (対象トッピングを freeUnits 個まで無料) を計算する。
  // サーバ側 (utils/coupon.ts computeCouponDiscount) と同じロジック。(2) 検証済みでも
  // 自動では適用せず、enabledCouponSlugs (「クーポン」欄でのユーザーの明示選択) に
  // 含まれるものだけ有効にする。(3) 複数枚を検証済みの場合は全部リストに出し、
  // 選んだ分だけ同時に適用できる (以前は1枚しか保存/表示できなかった不具合の修正)。
  const potentialDiscountFor = (c: StoredCoupon): number => {
    if (c.kind === "free_topping") {
      const unitPrices: number[] = [];
      for (const line of cart) {
        for (const t of line.toppings) {
          if (c.toppingIds.includes(t.toppingId)) {
            for (let i = 0; i < line.quantity; i++) unitPrices.push(t.toppingPrice);
          }
        }
      }
      unitPrices.sort((a, b) => b - a);
      const freeCount = c.freeUnits ?? unitPrices.length;
      return unitPrices.slice(0, Math.max(0, freeCount)).reduce((sum, p) => sum + p, 0);
    }
    const eligibleSubtotal = cart
      .filter((l) => c.menuIds.includes(l.menuId))
      .reduce((sum, l) => sum + lineSubtotal(l), 0);
    return Math.min(c.discountAmount ?? 0, eligibleSubtotal);
  };
  // 実際に効くクーポン = 明示的にONにしていて、かつ対象商品がカートにある (割引>0) もの。
  const applicableCoupons = isPreOrderEnabled()
    ? []
    : appliedCoupons.filter((c) => enabledCouponSlugs.has(c.slug) && potentialDiscountFor(c) > 0);
  const couponDiscount = applicableCoupons.reduce((sum, c) => sum + potentialDiscountFor(c), 0);
  const getDiscountedTotal = () => Math.max(0, getTotalPrice() - couponDiscount);

  // 外部モッド用グローバルAPIの公開
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).FesOrder = {
        circleId: selectedCircleId,
        circleData,
        cart,
        addToCart,
        updateQuantity,
        clearCart: () => setCart([]),
      };
      // 拡張機能がcart変化を確実に検知できるようイベントを発火
      window.dispatchEvent(new CustomEvent("fesorder:update", {
        detail: (window as any).FesOrder
      }));
    }
  }, [selectedCircleId, circleData, cart]);

  // 出店未選択のときの案内画面。
  // 2026-07-11: 従来は "ACCESS DENIED // 注文不可" という強い表現で、初見の来場者には
  // 拒否されたように見えて不親切だった。メニュー閲覧自体は自由なので、
  // 「出店一覧から選ぶ」か「店頭QRをスキャンする」という前向きな導線に変える。
  if (!circleIdParam && !selectedCircleId) {
    return (
      <div className="max-w-xl mx-auto p-sp-3 sm:p-sp-4 text-center font-mono my-12">
        <div className="border-heavy border-border p-sp-5 space-y-sp-4 bg-background">
          <div className="inline-flex items-center justify-center h-14 w-14 border-thick border-border bg-primary text-primary-foreground mx-auto">
            <UtensilsCrossed className="h-7 w-7" />
          </div>
          <h1 className="text-[22px] sm:text-[30px] font-headline uppercase tracking-tight leading-[1.15] text-foreground">
            見たい出店を<br />選んでください
          </h1>
          <p className="text-[13px] sm:text-[14px] leading-[1.6] text-muted-foreground">
            出店一覧からお店を選ぶと、メニューを見て事前注文ができます。
            店頭に掲示されたQRコードをスマートフォンで読み取っても、その店のメニューが直接開きます。
          </p>
          <div className="border-t-[3px] border-border pt-sp-4 flex flex-col gap-sp-2">
            <Button
              onClick={() => navigate("/visitor/events")}
              className="w-full h-12 border-thick border-border bg-primary text-primary-foreground font-mono font-bold uppercase hover:bg-background hover:text-foreground"
            >
              出店一覧を見る
            </Button>
            <Button
              onClick={() => navigate("/visitor/mypage")}
              className="w-full h-12 border-thick border-border bg-background text-foreground font-mono font-bold hover:bg-accent hover:text-accent-foreground"
            >
              マイページ (マイQR)
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 店頭QRなどの明示URLでも、入場済み来場者の閲覧/注文対象を自分のイベントに限定する。
  // 未入場者の公開メニュー下見は維持し、イベント所属確認前にメニュー本体を取得しない (2026-09-27)。
  if (session?.userId && session.eventId && circleData?.eventId && circleData.eventId !== session.eventId) {
    return (
      <div className="max-w-xl mx-auto p-6 space-y-4 font-mono" role="alert">
        <h1 className="text-xl font-bold">別のイベントの出店です</h1>
        <p>入場中のイベントにある出店へ戻ってください。</p>
        <Button onClick={() => navigate(`/visitor/events/${session.eventId}`)}>入場中のイベントへ戻る</Button>
      </div>
    );
  }

  // メニュー表示画面
  if (circleLoading || menusLoading) {
    return (
      <div className="max-w-6xl mx-auto p-sp-4 space-y-sp-3">
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-sp-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      </div>
    );
  }

  // サークル情報 or メニュー取得失敗: どちらも欠けると画面が成立しないため
  // 一つの ErrorState にまとめて表示し、両方をまとめて再試行する
  if (circleError || menusError) {
    return (
      <div className="max-w-6xl mx-auto p-sp-4">
        <ErrorState
          error={circleErrorObj || menusErrorObj}
          title="メニュー情報の取得に失敗しました"
          onRetry={() => {
            refetchCircle();
            refetchMenus();
          }}
        />
      </div>
    );
  }

  // イベント終了後は注文を受け付けず「ご来場ありがとうございました」の御礼画面にする (2026-07-15)。
  // 来場者の主目的(注文)が終わっているため、メニュー閲覧の代わりに御礼と注文履歴への導線を出す。
  if (circleEvent && (circleEvent.lifecycleStatus === "ended" || circleEvent.lifecycleStatus === "archived")) {
    return (
      <EventTheme theme={circleEvent} className="bg-background text-foreground">
        <div className="max-w-xl mx-auto p-sp-3 sm:p-sp-4 text-center font-mono my-12">
          <div className="border-heavy border-border p-sp-5 space-y-sp-4 bg-background">
            {circleEvent.logoUrl ? (
              <img src={resolveAssetUrl(circleEvent.logoUrl)} alt={circleEvent.eventName} className="max-h-24 mx-auto block border-thick border-border" />
            ) : (
              <div className="inline-flex items-center justify-center h-14 w-14 border-thick border-border bg-primary text-primary-foreground mx-auto">
                <UtensilsCrossed className="h-7 w-7" />
              </div>
            )}
            <h1 className="text-[22px] sm:text-[30px] font-headline uppercase tracking-tight leading-[1.15] text-foreground">
              ご来場<br />ありがとうございました
            </h1>
            <p className="text-[13px] sm:text-[14px] leading-[1.6] text-muted-foreground">
              {circleEvent.eventName} は終了しました。ご利用いただきありがとうございました。
              新しいご注文の受付は終了しています。
            </p>
            <div className="border-t-[3px] border-border pt-sp-4 flex flex-col gap-sp-2">
              <Button
                onClick={() => navigate("/visitor/orders")}
                className="w-full h-12 border-thick border-border bg-primary text-primary-foreground font-mono font-bold uppercase hover:bg-background hover:text-foreground"
              >
                注文履歴を見る
              </Button>
              <Button
                onClick={() => navigate("/visitor/mypage")}
                className="w-full h-12 border-thick border-border bg-background text-foreground font-mono font-bold hover:bg-accent hover:text-accent-foreground"
              >
                マイページ
              </Button>
            </div>
          </div>
        </div>
      </EventTheme>
    );
  }

  return (
    <EventTheme theme={circleEvent} className="bg-background text-foreground">
    {/* 2026-09-27: スマートフォンでは固定カートバーがカード末尾の「カートに追加」を
        隠すため、バーの最大高さぶんスクロール余白を確保する。 */}
    <div className="max-w-6xl mx-auto p-sp-3 sm:p-sp-4 space-y-sp-4 sm:space-y-sp-5 pb-56 sm:pb-36">
      {/* 戻るボタン */}
      <button
        onClick={() => {
          if (circleIdParam) {
            // 横断閲覧 (イベントメニュー) から来た場合はイベントの出店一覧へ戻す
            navigate("/visitor/events");
            return;
          }
          setSelectedCircleId(null);
        }}
        className="font-mono text-[12px] sm:text-[13px] uppercase tracking-[1px] underline hover:text-info"
      >
        ← 出店一覧に戻る
      </button>

      {/* サークル情報ヘッダー */}
      {circleData && (
        <div
          className="relative min-h-[200px] border-heavy border-border bg-primary text-primary-foreground p-sp-5 flex flex-col justify-center items-center text-center"
          style={
            circleData.backgroundImagePath
              ? {
                  backgroundImage: `url(${JSON.stringify(resolveAssetUrl(circleData.backgroundImagePath))})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          <div className="bg-primary/80 border-thick border-primary-foreground p-sp-3 sm:p-sp-4 max-w-2xl w-full">
            {circleData.iconImagePath && (
              <img
                src={resolveAssetUrl(circleData.iconImagePath)}
                alt={circleData.name}
                width={64}
                height={64}
                className="mx-auto border-thick border-white mb-sp-3"
              />
            )}
            <h1 className="text-[28px] sm:text-[40px] md:text-[48px] font-headline uppercase tracking-tight mb-sp-1 leading-[1.0]">
              {circleData.name}
            </h1>
            {circleData.description && (
              <p className="text-[13px] sm:text-[15px] font-mono leading-[1.5]">
                {circleData.description}
              </p>
            )}
          </div>
        </div>
      )}

      {/* メニュー一覧。常設のクーポンセクションは置かず、各カードの中でトッピング選択の
          すぐ下に関係するクーポンを出す (2026-09-16、モーダル案は撤回してカード内に戻した)。 */}
      <div>
        <h2 className="text-[24px] sm:text-[32px] font-headline uppercase tracking-tight mb-sp-3 leading-[1.1]">
          メニューを選択して事前注文
        </h2>
        {menus && menus.length > 0 ? (
          <div className="grid gap-sp-3 sm:grid-cols-2 lg:grid-cols-3">
            {menus.map((menu) => (
              <VisitorMenuCard
                key={menu.id}
                menu={menu}
                relevantCoupons={isPreOrderEnabled() ? [] : relevantCouponsForMenu(menu)}
                enabledCouponSlugs={enabledCouponSlugs}
                onToggleCoupon={toggleCoupon}
                onAdd={addLine}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={ShoppingCart} message="メニューがまだ登録されていません" />
        )}
      </div>

      {/* 標準カートバー */}
      {cart.length > 0 && (
        <div id="standard-cart-bar" className="fixed bottom-0 left-0 right-0 z-40 bg-primary text-primary-foreground border-t-heavy border-border p-3 sm:p-4">
          <div className="max-w-4xl mx-auto flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-background text-foreground px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-widest">
                  {getTotalCount()}点
                </span>
                {applicableCoupons.length > 0 ? (
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-mono text-xs line-through text-primary-foreground/60">
                      ¥{getTotalPrice().toLocaleString()}
                    </span>
                    <span className="font-mono text-xl sm:text-2xl font-black">
                      ¥{getDiscountedTotal().toLocaleString()}
                    </span>
                  </span>
                ) : (
                  <span className="font-mono text-xl sm:text-2xl font-black">
                    ¥{getTotalPrice().toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-[10px] sm:text-xs text-primary-foreground/80 font-mono hidden sm:block">
                事前に注文を予約し、レジでスムーズに会計できます。
              </p>
            </div>
            {applicableCoupons.length > 0 && (
              <div className="flex items-center gap-1.5 bg-background text-foreground px-2 py-1 text-[11px] font-bold w-fit flex-wrap">
                <Ticket className="h-3.5 w-3.5 shrink-0" />
                {applicableCoupons.map((c) => `「${c.title}」`).join(" + ")} 適用中 (¥{couponDiscount.toLocaleString()}引き)
              </div>
            )}
            <Button
              onClick={() => setIsCartOpen(true)}
              className="w-full h-14 border-thick border-border bg-background px-4 sm:px-8 font-mono text-base sm:text-lg font-black uppercase text-foreground rounded-none hover:bg-primary hover:text-primary-foreground transition-all shadow-none active:translate-y-1"
            >
              <ShoppingCart className="mr-2 h-5 w-5 sm:h-6 sm:w-6" />
              注文を確認する
            </Button>
          </div>
        </div>
      )}

      {/* 標準カート確認モーダル */}
      <Modal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        title="[カートの中身を確認]"
        maxWidth="lg"
      >
        <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
          {cart.map((line) => {
            const allowed = menuMap.get(line.menuId)?.toppings ?? [];
            return (
              <div key={line.lineId} className="border-b border-border/10 pb-3 space-y-2">
                <div className="flex justify-between items-start gap-4">
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-sm text-foreground truncate">{line.menuName}</p>
                    <p className="text-xs text-muted-foreground">単価: ¥{line.menuPrice.toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      onClick={() => updateLineQuantity(line.lineId, -1)}
                      className="h-8 w-8 border-thick border-border bg-background text-foreground rounded-none hover:bg-primary hover:text-primary-foreground p-0"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="font-bold text-sm w-6 text-center">{line.quantity}</span>
                    <Button
                      type="button"
                      onClick={() => updateLineQuantity(line.lineId, 1)}
                      className="h-8 w-8 border-thick border-border bg-background text-foreground rounded-none hover:bg-primary hover:text-primary-foreground p-0"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* トッピング調整 (カート内でもタップでトグル。このメニューに紐づくトッピングのみ) */}
                {allowed.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {allowed.map((topping) => {
                      const on = line.toppings.some((t) => t.toppingId === topping.id);
                      return (
                        <button
                          key={topping.id}
                          type="button"
                          disabled={topping.soldOut}
                          onClick={() => toggleLineTopping(line.lineId, topping)}
                          className={cn(
                            "flex items-center gap-1 border-thin px-1.5 py-0.5 text-[11px] font-bold rounded-none transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background hover:bg-muted"
                          )}
                        >
                          <span className="truncate max-w-[90px]">{topping.name}</span>
                          <span className={on ? "opacity-80" : "text-muted-foreground"}>
                            {topping.price >= 0 ? `+¥${topping.price}` : `-¥${Math.abs(topping.price)}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex justify-end">
                  <p className="text-xs font-bold text-foreground">小計: ¥{lineSubtotal(line).toLocaleString()}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t-thick border-border pt-3 space-y-2">
          {applicableCoupons.map((c) => (
            <div key={c.slug} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-bold">
                <Ticket className="h-3.5 w-3.5 shrink-0" />
                「{c.title}」
              </span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-success">-¥{potentialDiscountFor(c).toLocaleString()}</span>
                <button
                  type="button"
                  onClick={() => toggleCoupon(c.slug)}
                  aria-label="クーポンの適用をやめる"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ))}
          <div className="flex justify-between font-black text-lg text-foreground">
            <span>合計金額:</span>
            <span>¥{getDiscountedTotal().toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-normal">
            {isPreOrderEnabled()
              ? "※「注文を送信する」を押すと注文が送信されます。番号が呼ばれたら受取口にてお支払いください。"
              : "※「注文を送信する」を押すと事前注文が送信されます。レジにてマイQRコード、または連携したリストバンドを提示してお支払いください。"}
          </p>
        </div>

        {/* 未入場 (リストバンド未発行) は注文不可。閲覧は自由だが「使う」には発行が必要。 */}
        {!userId && (
          <div className="border-thick border-border bg-muted/30 p-3 space-y-1">
            <p className="text-xs font-black uppercase tracking-wide text-foreground">
              注文にはリストバンドが必要です
            </p>
            <p className="text-[11px] text-muted-foreground leading-normal">
              お持ちのリストバンドの QR コードを読み取って入場するか、受付でリストバンドの発行を受けてください。メニューの閲覧は発行なしでもご利用いただけます。
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={() => {
              if (!userId) {
                toast.error("注文にはリストバンドが必要です。QR を読み取って入場してください。");
                return;
              }
              setIsCartOpen(false);
              if (isPreOrderEnabled()) {
                codOrderMutation.mutate();
              } else {
                preOrderMutation.mutate();
              }
            }}
            disabled={!userId || preOrderMutation.isPending || codOrderMutation.isPending}
            className="w-full h-12 border-thick border-border bg-primary text-primary-foreground text-base font-black uppercase rounded-none hover:bg-background hover:text-foreground transition-all disabled:opacity-50"
          >
            {preOrderMutation.isPending || codOrderMutation.isPending
              ? "送信中..."
              : !userId
                ? "入場が必要です"
                : "注文を送信する"}
          </Button>
        </div>
      </Modal>

      {/* 外部モッドの動的ヘッダーインジェクション */}
      {getActiveMods().map((mod: any) => {
        const hook = mod.manifest?.hooks?.menuHeader;
        if (!hook) return null;

        return (
          <div key={`${mod.manifest.id}-header`} className="w-full">
            <ModSandbox
              modId={mod.manifest.id}
              hookName="menuHeader"
              html={typeof hook === "string" ? hook : undefined}
              jsUrl={typeof hook === "object" ? hook.js : undefined}
              cssUrl={typeof hook === "object" ? hook.css : undefined}
              data={{
                circleId: selectedCircleId,
                circleData,
                cart,
                userId, // guest_user_idを引き渡し
              }}
              onAction={(actionType, payload) => {
                if (actionType === "ADD_TO_CART") {
                  addToCart(payload.menuId, payload.menuName, payload.menuPrice);
                } else if (actionType === "UPDATE_QUANTITY") {
                  updateQuantity(payload.menuId, payload.delta);
                } else if (actionType === "CLEAR_CART") {
                  setCart([]);
                } else if (actionType === "SAVE_DIRECT_ORDER") {
                  try {
                    const stored = localStorage.getItem("fesorder_direct_orders");
                    const directOrders = stored ? JSON.parse(stored) : [];
                    directOrders.push(payload);
                    localStorage.setItem("fesorder_direct_orders", JSON.stringify(directOrders));
                  } catch (e) {
                    console.error("Failed to save direct order:", e);
                  }
                } else if (actionType === "NAVIGATE" && typeof payload === "string") {
                  navigate(payload);
                }
              }}
            />
          </div>
        );
      })}

      {/* 外部モッドの動的ボディ末尾インジェクション */}
      {getActiveMods().map((mod: any) => {
        const hook = mod.manifest?.hooks?.menuBodyBottom;
        if (!hook) return null;

        return (
          <div key={`${mod.manifest.id}-body-bottom`} className="fixed bottom-0 left-0 right-0 z-40">
            <ModSandbox
              modId={mod.manifest.id}
              hookName="menuBodyBottom"
              html={typeof hook === "string" ? hook : undefined}
              jsUrl={typeof hook === "object" ? hook.js : undefined}
              cssUrl={typeof hook === "object" ? hook.css : undefined}
              data={{
                circleId: selectedCircleId,
                circleData,
                cart,
                userId, // guest_user_idを引き渡し
              }}
              onAction={(actionType, payload) => {
                if (actionType === "ADD_TO_CART") {
                  addToCart(payload.menuId, payload.menuName, payload.menuPrice);
                } else if (actionType === "UPDATE_QUANTITY") {
                  updateQuantity(payload.menuId, payload.delta);
                } else if (actionType === "CLEAR_CART") {
                  setCart([]);
                } else if (actionType === "SAVE_DIRECT_ORDER") {
                  try {
                    const stored = localStorage.getItem("fesorder_direct_orders");
                    const directOrders = stored ? JSON.parse(stored) : [];
                    directOrders.push(payload);
                    localStorage.setItem("fesorder_direct_orders", JSON.stringify(directOrders));
                  } catch (e) {
                    console.error("Failed to save direct order:", e);
                  }
                } else if (actionType === "NAVIGATE" && typeof payload === "string") {
                  navigate(payload);
                }
              }}
            />
          </div>
        );
      })}
    </div>
    </EventTheme>
  );
}

export default function MenuPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-6xl mx-auto p-sp-4 font-mono text-[14px] uppercase tracking-[1px]">
          読み込み中...
        </div>
      }
    >
      <MenuPageContent />
    </Suspense>
  );
}

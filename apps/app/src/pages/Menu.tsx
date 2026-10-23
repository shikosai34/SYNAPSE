
import { useEffect, useRef, useState, Suspense } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ModSandbox } from "@/components/ModSandbox";
import { useQuery, useMutation } from "@tanstack/react-query";
import { eventApi, circleApi, menuApi, preOrderApi, orderApi, wristbandApi, reviewApi, bundleDiscountApi, parseCircleSettings, type CreatePreOrderInput, type MenuWithToppings, type Topping, type PublicStoreReviewList } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { useSessionState } from "@/hooks/useSessionState";
import { getCouponsForCircle, type StoredCoupon } from "@/lib/coupon-storage";
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
import { ApiError } from "@/lib/api-error";
import { ShoppingCart, Plus, Minus, CheckCircle, UtensilsCrossed, Ticket, X, QrCode, Star, MessageSquareText } from "lucide-react";
import { resolveAssetUrl } from "@/lib/asset-url";
import { isEventEnded } from "@/lib/event-lifecycle";
import { QRCodeSVG } from "qrcode.react";
// 2026-10-03: 画面をまたぐカート規則と再送制御を機能モジュールに集約する。
import { addCartLine, updateCartQuantity, toggleCartTopping, lineSubtotal, cartTotal, cartBundleDiscount, cartCount, type CartLine, type CartTopping } from "@/features/orders/cart";
import { useOrderSubmission } from "@/features/orders/use-order-submission";
import { submitMobileOrder } from "@/features/orders/mobile-order-outbox";
import { getPreOrderSaveRetryAfterMs, getPreOrderSaveRetryDelay, isRetryablePreOrderSaveError, shouldRetryPreOrderSave } from "@/features/orders/pre-order-save";
import type { CreateOrderInput } from "@fesflow/config/order-contract";
import { ToppingSelection, parseToppingCategoryMaximums, parseToppingCategoryMinimums } from "@/components/menu/ToppingSelection";
import { MenuCategoryFilter, menuCategoryKey } from "@/components/menu/MenuCategoryFilter";
import { findVisitorRouteItem } from "@/lib/visitor-route";
import { parseJapaneseAllergens } from "@fesflow/config/allergens";
import { getCartAllergyWarnings, OrderAllergyWarning } from "@/features/orders/allergy-check";

// 2026-07-13: 来場者モバイルオーダーもトッピング対応にするため、レジ (Register.tsx) と同じく
// カートを「行 (line)」単位で持つ。同じメニューでもトッピング構成が違えば別行になる。
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
  orderingDisabled,
  orderingDisabledLabel,
}: {
  menu: MenuWithToppings;
  relevantCoupons: StoredCoupon[];
  enabledCouponSlugs: Set<string>;
  onToggleCoupon: (slug: string) => void;
  onAdd: (menu: MenuWithToppings, toppings: CartTopping[]) => void;
  orderingDisabled: boolean;
  orderingDisabledLabel: string;
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
  // 2026-10-07 Issue #111: トッピング未設定なら選択工程が存在しないため、追加を止めない。
  const [selectionReady, setSelectionReady] = useState(!menu.toppingWizardEnabled || (menu.toppings ?? []).length === 0);
  const toppingMinimums = parseToppingCategoryMinimums(menu.toppingCategoryMinimums);
  const toppingMaximums = parseToppingCategoryMaximums(menu.toppingCategoryMaximums);

  useEffect(() => {
    setSelected(defaultIds());
    setSelectionReady(!menu.toppingWizardEnabled || (menu.toppings ?? []).length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.id, menu.defaultToppingIds, menu.toppingWizardEnabled]);

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
    if (orderingDisabled || !selectionReady) return;
    const chosen: CartTopping[] = availableToppings
      .filter((t) => selected.has(t.id))
      .map((t) => ({ toppingId: t.id, toppingName: t.name, toppingPrice: t.price }));
    onAdd(menu, chosen);
    setSelected(defaultIds()); // 次の1品のために既定へ戻す
  };

  return (
    <Card className="w-full max-w-lg justify-self-center">
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
          {/* 2026-10-21: 売切を販売停止の状態色で示し、商品画像上でも見落としにくくする。 */}
          {menu.soldOut && (
            <div className="absolute inset-0 bg-error/85 flex items-center justify-center">
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
            <p className="text-xs font-mono font-black uppercase tracking-wider text-foreground">トッピングを選ぶ</p>
            <ToppingSelection
              menuId={menu.id}
              toppings={availableToppings}
              selected={selected}
              freeIds={freeToppingIds}
              onToggle={toggle}
              wizardEnabled={menu.toppingWizardEnabled}
              disabled={menu.soldOut || orderingDisabled}
              minimums={toppingMinimums}
              maximums={toppingMaximums}
              onReadyChange={setSelectionReady}
            />
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
                        : c.kind === "cart_percentage"
                          ? `カート全体から${c.discountPercent}%引き`
                          : `¥${c.discountAmount?.toLocaleString()}引き`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleCoupon(c.slug)}
                    disabled={orderingDisabled}
                    className={cn(
                      "border-thick px-4 py-2 text-sm font-black uppercase shrink-0 transition-all disabled:cursor-not-allowed disabled:opacity-50",
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
          disabled={orderingDisabled || menu.soldOut || !selectionReady}
          className="w-full h-14 border-thick border-border bg-primary font-mono text-lg font-black uppercase text-primary-foreground rounded-none hover:bg-background hover:text-foreground transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        >
          <ShoppingCart className="mr-2 h-5 w-5" />
          {orderingDisabled ? orderingDisabledLabel : "カートに追加"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function MenuPageContent() {
  const { eventName: eventNameParam, circleName: circleNameParam, circleId: routeCircleId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const circleIdParam = searchParams.get("circleId") || routeCircleId || null;
  const isMobileOrderRoute = !!routeCircleId;
  // 未入場 (リストバンド未発行) は空文字。閲覧は許可し注文送信側でゲートする
  const { userId: visitorUserId, session, isLoaded: visitorLoaded } = useVisitor();
  const userId = visitorUserId ?? "";
  // 2026-10-20: QR表示はAPI上の入場登録完了(onboardedAt)を条件にし、下見中の未登録バンドを表示しない。
  const { data: wristbandStatus, isLoading: isWristbandStatusLoading, isError: isWristbandStatusError } = useQuery({
    queryKey: ["userWristbandStatus", userId],
    queryFn: () => wristbandApi.lookup(userId),
    enabled: visitorLoaded && !!userId,
  });
  const activeWristband = wristbandStatus?.wristband;
  const familyAllergies = parseJapaneseAllergens(wristbandStatus?.user.allergies);

  // 2026-10-21: 来場者の店舗一覧へ戻った時に選択中のイベントと店舗を復元する。
  const [selectedEventId, setSelectedEventId] = useSessionState<string | null>(`fesflow:visitor-menu:${eventNameParam ?? "browse"}:event`, null);
  const circleSelectionKey = circleIdParam ?? (eventNameParam ? `${eventNameParam}:${circleNameParam ?? "event"}` : "browse");
  const [selectedCircleId, setSelectedCircleId] = useSessionState<string | null>(`fesflow:visitor-menu-selection:${circleSelectionKey}`, circleIdParam);
  const visitorOrderStateKey = `fesflow:visitor-menu:${selectedCircleId || circleIdParam || "browse"}`;
  const [cart, setCart] = useSessionState<CartLine[]>(`${visitorOrderStateKey}:cart`, []);
  const [selectedMenuCategory, setSelectedMenuCategory] = useSessionState<string | null>(`${visitorOrderStateKey}:category`, null);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isReviewsOpen, setIsReviewsOpen] = useState(false);
  const [appOrigin, setAppOrigin] = useState("");
  const [draftSaveRetry, setDraftSaveRetry] = useState(0);
  const [draftRetryWaitElapsed, setDraftRetryWaitElapsed] = useState(true);
  const draftIdentityRef = useRef<{ key: string; id: string; updatedAt: number | null } | null>(null);
  const lastDraftPayloadRef = useRef<{ key: string; payload: string } | null>(null);
  const suppressNextDraftSaveRef = useRef(false);
  const draftSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // クーポン適用 (2026-09-16, issue #50)。/visitor/coupon/:slug で合言葉検証済みのものは
  // localStorage (coupon-storage.ts) に複数枚まとめて保存されているので、このサークルの分を
  // 一覧で読み込む (以前は1枚しか保存/表示できず「クーポンが1つしか出ない」不具合になっていた)。
  // 検証済みでも自動では適用せず、客が「クーポン」欄で明示的に選んだものだけ (enabledCouponSlugs) 使う。
  const [appliedCoupons, setAppliedCoupons] = useState<StoredCoupon[]>([]);
  const [enabledCouponSlugs, setEnabledCouponSlugs] = useState<Set<string>>(new Set());
  const [couponsLoadedCircleId, setCouponsLoadedCircleId] = useState<string | null>(null);

  useEffect(() => {
    setCouponsLoadedCircleId(null);
    setAppliedCoupons(selectedCircleId ? getCouponsForCircle(selectedCircleId) : []);
    setEnabledCouponSlugs(new Set());
    // 2026-10-08: クーポンは localStorage から同期取得するため、対象サークル分の読込後に下書き保存を解放する。
    setCouponsLoadedCircleId(selectedCircleId);
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
    networkMode: "always",
  });

  // 2026-10-08: App.tsx に登録済みの名称URLは、イベント一覧を読み込んでから選択状態へ解決する。
  useEffect(() => {
    if (circleIdParam || !eventNameParam || !events) return;
    const event = findVisitorRouteItem(events, eventNameParam, (item) => item.id, (item) => item.eventName);
    if (event) setSelectedEventId(event.id);
  }, [circleIdParam, eventNameParam, events]);

  // 選択したイベントのサークル一覧取得
  const { data: circles, isLoading: circlesLoading } = useQuery({
    queryKey: ["circles", selectedEventId],
    queryFn: () => circleApi.list(selectedEventId!),
    enabled: !!selectedEventId,
    networkMode: "always",
  });

  useEffect(() => {
    if (circleIdParam || !circleNameParam || !circles) return;
    const circle = findVisitorRouteItem(circles, circleNameParam, (item) => item.id, (item) => item.name);
    if (circle) setSelectedCircleId(circle.id);
  }, [circleIdParam, circleNameParam, circles]);

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
    networkMode: "always",
  });

  const { data: publicReviewSummaries } = useQuery({
    queryKey: ["public-review-summaries", circleData?.eventId],
    queryFn: () => reviewApi.publicStores(circleData!.eventId),
    enabled: !!circleData?.eventId,
    staleTime: 30_000,
  });
  const publicReviewSummary = publicReviewSummaries?.find((summary) => summary.circleId === selectedCircleId);
  const publicReviewsQuery = useQuery<PublicStoreReviewList>({
    queryKey: ["public-store-reviews", circleData?.eventId, selectedCircleId],
    queryFn: () => reviewApi.publicStoreReviews(circleData!.eventId, selectedCircleId!),
    enabled: isReviewsOpen && !!circleData?.eventId && !!selectedCircleId && !!publicReviewSummary,
    staleTime: 15_000,
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
    enabled: visitorLoaded && !!selectedCircleId && (!session?.userId || !session.eventId || circleData?.eventId === session.eventId),
    networkMode: "always",
  });

  const draftKey = userId && selectedCircleId ? `${userId}:${selectedCircleId}` : null;
  const mobileCartStorageKey = userId && selectedCircleId
    ? `fesflow-mobile-cart:${userId}:${selectedCircleId}`
    : null;
  const { data: savedDrafts, isSuccess: draftsLoaded } = useQuery({
    queryKey: ["preOrderDraft", userId, selectedCircleId],
    queryFn: () => preOrderApi.getByCode(userId, selectedCircleId!),
    enabled: visitorLoaded && !!userId && !!selectedCircleId && !isMobileOrderRoute,
  });

  // 2026-10-23: セット割引 (N個で○円) はモバイル注文・事前注文のどちらでもサーバーが自動適用するため、
  // 同じ規則で合計を先に見せる。
  const { data: bundleRules = [] } = useQuery({
    queryKey: ["bundle-discounts", selectedCircleId],
    queryFn: () => bundleDiscountApi.active(selectedCircleId!),
    enabled: !!selectedCircleId,
    staleTime: 60_000,
  });
  const cartBundle = cartBundleDiscount(cart, bundleRules);
  const cartPayable = Math.max(0, cartTotal(cart) - cartBundle.totalDiscount);

  useEffect(() => {
    if (typeof window !== "undefined") setAppOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    setHydratedDraftKey(null);
    setCart([]);
    lastDraftPayloadRef.current = null;
    draftIdentityRef.current = null;
  }, [selectedCircleId, userId]);

  useEffect(() => {
    if (isMobileOrderRoute) {
      if (!draftKey || !mobileCartStorageKey || !menus || hydratedDraftKey === draftKey) return;
      let storedLines: CartLine[] = [];
      try {
        const raw = localStorage.getItem(mobileCartStorageKey);
        storedLines = raw ? JSON.parse(raw) as CartLine[] : [];
      } catch {
        storedLines = [];
      }
      const menuById = new Map(menus.map((item) => [item.id, item]));
      setCart(storedLines.flatMap((line) => {
        const menuItem = menuById.get(line.menuId);
        if (!menuItem) return [];
        const validToppings = new Map((menuItem.toppings ?? []).map((topping) => [topping.id, topping]));
        return [{
          ...line,
          menuName: menuItem.name,
          menuPrice: menuItem.price,
          toppings: line.toppings.flatMap((topping) => {
            const current = validToppings.get(topping.toppingId);
            return current && !current.soldOut
              ? [{ toppingId: current.id, toppingName: current.name, toppingPrice: current.price }]
              : [];
          }),
        }];
      }));
      suppressNextDraftSaveRef.current = true;
      setHydratedDraftKey(draftKey);
      return;
    }
    if (!draftKey || !draftsLoaded || !menus || hydratedDraftKey === draftKey) return;
    const draft = savedDrafts?.[0];
    // 2026-10-07 Issue #49: 以後のautosaveは初回から同じIDを使い、claim後の遅延要求を新規注文にしない。
    draftIdentityRef.current = {
      key: draftKey,
      id: draft?.id ?? crypto.randomUUID(),
      updatedAt: draft?.draftVersion ?? null,
    };
    const menuById = new Map(menus.map((item) => [item.id, item]));
    const restoredCart: CartLine[] = (draft?.items ?? []).flatMap((item) => {
      const menuItem = menuById.get(item.menuId);
      if (!menuItem) return [];
      return [{
        lineId: crypto.randomUUID(),
        menuId: menuItem.id,
        menuName: menuItem.name,
        menuPrice: menuItem.price,
        quantity: item.quantity,
        toppings: (item.toppings ?? []).map((topping) => ({
          toppingId: topping.id,
          toppingName: topping.name,
          toppingPrice: topping.price,
        })),
      }];
    });
    const draftCouponSlugs = new Set(draft?.couponSlugs ?? []);
    setEnabledCouponSlugs(new Set(
      getCouponsForCircle(selectedCircleId!).filter((coupon) => draftCouponSlugs.has(coupon.slug)).map((coupon) => coupon.slug),
    ));
    setCart(restoredCart);
    suppressNextDraftSaveRef.current = true;
    setHydratedDraftKey(draftKey);
  }, [isMobileOrderRoute, draftKey, mobileCartStorageKey, draftsLoaded, savedDrafts, menus, hydratedDraftKey, selectedCircleId]);

  useEffect(() => {
    if (!isMobileOrderRoute || !mobileCartStorageKey || !draftKey || hydratedDraftKey !== draftKey) return;
    try {
      if (cart.length > 0) localStorage.setItem(mobileCartStorageKey, JSON.stringify(cart));
      else localStorage.removeItem(mobileCartStorageKey);
    } catch {
      // 2026-10-21: 端末容量不足でも注文画面を止めず、送信待ち保存時に明示的に失敗させる。
    }
  }, [isMobileOrderRoute, mobileCartStorageKey, draftKey, hydratedDraftKey, cart]);

  // サークルが属するイベントのテーマ (配色/ロゴ) を取得して画面に反映
  const {
    data: circleEvent,
    isLoading: isCircleEventLoading,
    isError: isCircleEventError,
  } = useQuery({
    queryKey: ["event", circleData?.eventId],
    queryFn: () => eventApi.get(circleData!.eventId),
    enabled: !!circleData?.eventId,
    networkMode: "always",
    // 2026-10-21: 開いたままの注文画面にも運営の終了状態を反映する。
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const eventEnded = isEventEnded(circleEvent);
  // 2026-10-22: 開催前はメニュー閲覧だけにし、カート・注文・QR操作を止める。
  const eventUpcoming = circleEvent?.lifecycleStatus === "upcoming";
  const preOrderAcceptanceEnabled = parseCircleSettings(circleData?.settings).preOrderEnabled;
  const preOrderAcceptanceDisabled = !isMobileOrderRoute && !!circleData && !preOrderAcceptanceEnabled;
  const orderEntryDisabled = eventEnded || eventUpcoming || isCircleEventLoading || isCircleEventError;
  const orderEntryDisabledLabel = eventUpcoming
    ? "開催前"
    : eventEnded
      ? "開催終了"
      : isCircleEventError
        ? "開催状態を確認できません"
        : "開催状態を確認中…";
  // 2026-10-20: 来場案内と同じイベント設定を使い、物理バンド必須のイベントではスマホQRを出さない。
  const mustPresentPhysicalWristband = Boolean(
    circleEvent?.hasPhysicalWristband && !circleEvent.allowSelfIssue
  );
  const canDisplayMyQr = !!circleEvent
    && !isCircleEventError
    && !eventUpcoming
    && !eventEnded
    && !mustPresentPhysicalWristband
    && !!wristbandStatus?.user.onboardedAt
    && !!activeWristband
    && ["active", "smartphone"].includes(activeWristband.status);
  const myQrButtonLabel = isWristbandStatusLoading || isCircleEventLoading
    ? "入場情報を確認中…"
    : isWristbandStatusError || isCircleEventError
      ? "入場情報を確認できません"
      : mustPresentPhysicalWristband
        ? "物理リストバンドを提示してください"
        : eventEnded
          ? "開催終了のためQRは表示できません"
        : canDisplayMyQr
          ? "マイQRを表示"
          : "入場登録をおこなってください";

  useEffect(() => {
    if (circleIdParam) {
      setSelectedCircleId(circleIdParam);
    }
  }, [circleIdParam]);

  // 2026-10-07 Issue #49: 保存要求を直列化し、短時間の連続操作で古いカートが後から上書きしないようにする。
  const preOrderMutation = useMutation({
    mutationFn: (payload: Omit<CreatePreOrderInput, "draftId" | "expectedUpdatedAt">) => {
      const queued = draftSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const key = `${payload.userId}:${payload.circleId}`;
          const identity = draftIdentityRef.current;
          if (!identity || identity.key !== key) {
            throw new Error("カート情報を読み込み直しています。少し待ってからお試しください");
          }
          const response = await preOrderApi.create({
            ...payload,
            draftId: identity.id,
            expectedUpdatedAt: identity.updatedAt,
          });
          if (draftIdentityRef.current?.key === key && draftIdentityRef.current.id === identity.id) {
            // 削除はIDを取消済みにした後、新しいカート用のIDへ移る。
            draftIdentityRef.current = response.deleted
              ? { key, id: crypto.randomUUID(), updatedAt: null }
              : { ...identity, updatedAt: response.updatedAt };
          }
          return response;
        });
      draftSaveQueueRef.current = queued;
      return queued;
    },
    // 2026-10-08 Issue #49: 通信障害は限定回数再試行し、競合などの修正不能な要求は自動再送しない。
    retry: shouldRetryPreOrderSave,
    retryDelay: getPreOrderSaveRetryDelay,
    onError: (error: any) => {
      toast.error(error.message || "カートの自動保存に失敗しました");
    },
  });
  const { mutate: saveDraft } = preOrderMutation;
  const preOrderStockError =
    preOrderMutation.error instanceof ApiError &&
    preOrderMutation.error.code === "BAD_REQUEST" &&
    /在庫が不足|売り切れ/.test(preOrderMutation.error.message)
      ? `${preOrderMutation.error.message}。数量を調整してから再度お試しください。`
      : null;

  useEffect(() => {
    const waitMs = preOrderMutation.isError
      ? getPreOrderSaveRetryAfterMs(preOrderMutation.error)
      : null;
    if (waitMs === null || waitMs === 0) {
      setDraftRetryWaitElapsed(true);
      return;
    }

    // 2026-10-08 Issue #49: Retry-After がある場合、手動再試行もサーバー指定時刻まで待つ。
    setDraftRetryWaitElapsed(false);
    const timeout = window.setTimeout(() => setDraftRetryWaitElapsed(true), waitMs);
    return () => window.clearTimeout(timeout);
  }, [preOrderMutation.error, preOrderMutation.isError]);

  const orderInput: CreateOrderInput | null = selectedCircleId && userId && cart.length > 0 ? {
    circleId: selectedCircleId, userId, peopleCount: 1,
    ...(isMobileOrderRoute ? { expectedTotalPrice: cartPayable } : {}),
    items: cart.map((line) => ({ menuId: line.menuId, quantity: line.quantity, toppingIds: line.toppings.map((t) => t.toppingId) })),
  } : null;
  const circleNameForSubmission = useRef(circleData?.name || "サークル");
  circleNameForSubmission.current = circleData?.name || "サークル";
  const mobileOrderDisplayItems = useRef(cart.map((line) => ({
    menuName: line.menuName,
    quantity: line.quantity,
    unitPrice: line.menuPrice + line.toppings.reduce((sum, topping) => sum + topping.toppingPrice, 0),
    toppings: line.toppings.map((topping) => topping.toppingName),
  })));
  mobileOrderDisplayItems.current = cart.map((line) => ({
    menuName: line.menuName,
    quantity: line.quantity,
    unitPrice: line.menuPrice + line.toppings.reduce((sum, topping) => sum + topping.toppingPrice, 0),
    toppings: line.toppings.map((topping) => topping.toppingName),
  }));
  const submitOrder = useOrderSubmission(orderInput, (input, key) =>
    submitMobileOrder(input, circleNameForSubmission.current, mobileOrderDisplayItems.current, key),
  );
  const clearSavedMobileCart = () => {
    try {
      if (mobileCartStorageKey) localStorage.removeItem(mobileCartStorageKey);
    } catch {
      // 2026-10-21: 注文の受付処理を端末キャッシュの削除失敗で覆い隠さない。
    }
  };
  // モバイル注文は送信前に冪等キーと内容を端末へ保存し、通信断後も同じ注文として再送する。
  const codOrderMutation = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      if (eventEnded) throw new Error("開催終了後は注文を受け付けていません");
      if (eventUpcoming) throw new Error("開催前のため注文を受け付けていません");
      if (orderEntryDisabled) throw new Error("開催状態を確認できないため、注文を受け付けられません");
      if (!orderInput) throw new Error("注文にはリストバンドとカート内の商品が必要です");
      return submitOrder(orderInput);
    },
    onSuccess: (orderData) => {
      if (!orderData) return;
      clearSavedMobileCart();
      toast.success(`注文を受け付けました！呼出番号: ${orderData.orderNumber}`);
      setCart([]);
      // 2026-10-21: 注文履歴で今回の注文を注文票として強調し、番号・内容・金額を店頭で伝えられるようにする。
      navigate("/visitor/orders", {
        state: isMobileOrderRoute ? {
          mobileOrderReceipt: {
            orderId: orderData.id,
            orderNumber: orderData.orderNumber,
            circleName: circleNameForSubmission.current,
            totalPrice: cartPayable,
            items: mobileOrderDisplayItems.current,
          },
        } : undefined,
      });
    },
    onError: (error: any) => {
      if (error instanceof ApiError && (error.code === "NETWORK" || error.status === 429 || error.status >= 500)) {
        clearSavedMobileCart();
        toast.message("受付状態を確認中です。通信が戻ると同じ注文キーで受付結果を確認します。");
        setCart([]);
        navigate("/visitor/orders");
        return;
      }
      toast.error(error.message || "注文の送信に失敗しました");
    },
  });

  const [isCartOpen, setIsCartOpen] = useState(false);

  // 2026-10-21: 終了境界をまたいで開いていた注文・QRモーダルを閉じ、終了前の操作状態を持ち越さない。
  useEffect(() => {
    if (!orderEntryDisabled) return;
    setIsCartOpen(false);
    setIsQrOpen(false);
  }, [orderEntryDisabled]);


  // カードで選んだトッピング付きで1行追加。トッピング構成まで同一なら数量+1、違えば別行。
  const addLine = (menu: MenuWithToppings, chosen: CartTopping[]) => {
    if (orderEntryDisabled) return;
    setCart((prev) => addCartLine(prev, menu, chosen));
  };

  // このメニューに関係するクーポン (2026-10-16)。cart_percentage は商品小計全体が対象。
  // menu_discount はこのメニューが対象、free_topping は紐づくトッピングが対象。
  const relevantCouponsForMenu = (menu: MenuWithToppings) =>
    (isMobileOrderRoute ? [] : appliedCoupons).filter((c) =>
      c.kind === "cart_percentage"
        ? true
        : c.kind === "menu_discount"
          ? c.menuIds.includes(menu.id)
          : (menu.toppings ?? []).some((t) => c.toppingIds.includes(t.id))
    );

  const updateLineQuantity = (lineId: string, delta: number) => {
    setCart((prev) => updateCartQuantity(prev, lineId, delta));
  };

  // 2026-10-03: 編集中の行を維持し、トッピングを切り替える。行の自動統合は行わない。
  const toggleLineTopping = (lineId: string, topping: Topping) => {
    setCart((prev) => toggleCartTopping(prev, lineId, topping));
  };

  // ── 外部モッド互換 (menuId ベース) ────────────────────────────────
  // 既存モッドは addToCart(menuId,...) / updateQuantity(menuId, delta) を呼ぶため、
  // トッピング無し行に対して従来通り menuId 単位で操作するラッパーを維持する。
  const addToCart = (menuId: string, menuName: string, menuPrice: number) => {
    if (orderEntryDisabled) return;
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
    if (orderEntryDisabled) return;
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

  const getTotalCount = () => cartCount(cart);
  const getTotalPrice = () => cartPayable;

  // カート内トッピング編集用に menuId → メニュー(許可トッピング付き)を引けるようにする
  const menuMap = new Map((menus ?? []).map((m) => [m.id, m]));
  const cartAllergyWarnings = getCartAllergyWarnings(cart, menuMap, familyAllergies);

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

  // 2026-10-17: 来場者側にも受付可否を伝え、設定OFFでは送信ボタンを出さない。
  const isMobileOrderEnabled = () => {
    try {
      return JSON.parse(circleData?.settings || "{}").mobileOrderEnabled === true;
    } catch {
      return false;
    }
  };

  // クーポン適用は事前オーダー(preOrderApi)経由のみ対応 (issue #50 スコープ外: COD直販/レジ)。
  // COD (代引き) モッドが有効なサークルでは orderApi.create に割引を渡す経路が無いため、
  // 誤って「割引されると見せて実際は反映されない」ことがないよう表示自体を出さない。
  // 2026-10-16: cart_percentage は商品小計全体 (税・送料なし) から割引し、サーバと同じく円未満切り捨て。
  // 2026-09-16 フィードバック対応: menu_discount / free_topping も既存どおり計算する。
  // サーバ側 (utils/coupon.ts computeCouponDiscount) と同じロジック。(2) 検証済みでも
  // 自動では適用せず、enabledCouponSlugs (「クーポン」欄でのユーザーの明示選択) に
  // 含まれるものだけ有効にする。(3) 複数枚を検証済みの場合は全部リストに出し、
  // 選んだ分だけ同時に適用できる (以前は1枚しか保存/表示できなかった不具合の修正)。
  const potentialDiscountFor = (c: StoredCoupon): number => {
    if (c.kind === "cart_percentage") {
      const subtotal = getTotalPrice();
      return Math.min(subtotal, Math.floor((subtotal * (c.discountPercent ?? 0)) / 100));
    }
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
  const couponApplications: { coupon: StoredCoupon; discount: number }[] = [];
  if (!isMobileOrderRoute && !isPreOrderEnabled()) {
    for (const c of appliedCoupons) {
      if (!enabledCouponSlugs.has(c.slug)) continue;
      const remaining = Math.max(0, getTotalPrice() - couponApplications.reduce((sum, item) => sum + item.discount, 0));
      const discount = Math.min(remaining, potentialDiscountFor(c));
      if (discount > 0) couponApplications.push({ coupon: c, discount });
    }
  }
  const applicableCoupons = couponApplications.map((item) => item.coupon);
  const couponDiscount = couponApplications.reduce((sum, item) => sum + item.discount, 0);
  const getDiscountedTotal = () => Math.max(0, getTotalPrice() - couponDiscount);

  const draftPayload = JSON.stringify({
    items: cart.map((line) => ({
      menuId: line.menuId,
      quantity: line.quantity,
      toppingIds: line.toppings.map((topping) => topping.toppingId),
    })),
    coupons: applicableCoupons.map((coupon) => ({ slug: coupon.slug, passphrase: coupon.passphrase })),
  });

  useEffect(() => {
    const hasSavedDraft = draftIdentityRef.current?.key === draftKey && draftIdentityRef.current.updatedAt !== null;
    if (
      isMobileOrderRoute || !draftKey || hydratedDraftKey !== draftKey || !userId || !visitorLoaded ||
      couponsLoadedCircleId !== selectedCircleId || isPreOrderEnabled() ||
      (!preOrderAcceptanceEnabled && !(cart.length === 0 && hasSavedDraft))
    ) return;

    if (suppressNextDraftSaveRef.current) {
      lastDraftPayloadRef.current = { key: draftKey, payload: draftPayload };
      suppressNextDraftSaveRef.current = false;
      return;
    }
    if (lastDraftPayloadRef.current?.key === draftKey && lastDraftPayloadRef.current.payload === draftPayload) return;

    // 2026-10-07 Issue #49: 操作をまとめてから保存し、変更のたびの通信を抑える。
    lastDraftPayloadRef.current = { key: draftKey, payload: draftPayload };
    const timeout = window.setTimeout(() => {
      saveDraft({ userId, circleId: selectedCircleId!, ...JSON.parse(draftPayload) });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [
    draftKey, hydratedDraftKey, userId, visitorLoaded, couponsLoadedCircleId,
    selectedCircleId, draftPayload, saveDraft, draftSaveRetry, isMobileOrderRoute,
    preOrderAcceptanceEnabled, cart.length,
  ]);

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
  if ((circleError && !circleData) || (menusError && !menus)) {
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

  // 2026-10-21: モバイル注文の可否は現行のサークル設定で判定し、旧COD拡張の有効化を必須にしない。
  if (isMobileOrderRoute && circleData && !isMobileOrderEnabled() && !eventEnded) {
    return (
      <div className="mx-auto max-w-xl p-6 font-mono" role="alert">
        <h1 className="text-xl font-black">モバイル注文は利用できません</h1>
        <p className="my-4">このサークルは現在、モバイル注文を受け付けていません。</p>
        <Button onClick={() => navigate("/visitor/events")}>出店一覧へ戻る</Button>
      </div>
    );
  }

  return (
    <EventTheme theme={circleEvent} className="bg-background text-foreground">
    {/* 2026-09-27: スマートフォンでは固定カートバーがカード末尾の「カートに追加」を
        隠すため、バーの最大高さぶんスクロール余白を確保する。 */}
    <div className="max-w-6xl mx-auto p-sp-3 sm:p-sp-4 space-y-sp-4 sm:space-y-sp-5 pb-56 sm:pb-36">
      {(circleError || menusError) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-thick border-warning bg-warning/10 p-3 text-xs font-bold">
          <span>通信に失敗しました。前回取得したメニューを表示しています。</span>
          <Button type="button" variant="outline" onClick={() => { void refetchCircle(); void refetchMenus(); }} className="min-h-10 border-thick border-border">再接続して更新</Button>
        </div>
      )}
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

      {circleData && publicReviewSummary && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsReviewsOpen(true)}
          aria-haspopup="dialog"
          className="min-h-12 w-full border-thick border-border bg-background px-4 font-mono text-sm font-black hover:bg-primary hover:text-primary-foreground sm:w-auto"
        >
          <MessageSquareText className="mr-2 h-4 w-4" aria-hidden="true" />
          レビューを見る
        </Button>
      )}

      {eventEnded && (
        <section className="border-heavy border-error bg-error/10 p-4" role="status" aria-live="polite">
          <p className="text-sm font-black text-error">開催終了・注文受付終了</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">メニューと価格は引き続きご覧いただけます。カート追加、注文送信、マイQRの表示はできません。</p>
        </section>
      )}
      {eventUpcoming && (
        <section className="border-heavy border-warning bg-warning/10 p-4" role="status" aria-live="polite">
          <p className="text-sm font-black">開催前</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">開催前のため注文・カート追加・マイQRの表示はできません。メニューと価格はご覧いただけます。</p>
        </section>
      )}
      {!eventEnded && !eventUpcoming && orderEntryDisabled && (
        <section className="border-heavy border-border bg-muted p-4" role="status" aria-live="polite">
          <p className="text-sm font-black">{isCircleEventLoading ? "開催状況を確認しています" : "開催状況を確認できません"}</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">
            {isCircleEventLoading
              ? "受付状況を確認するまでカート追加を停止しています。"
              : "受付状況を取得できませんでした。通信を確認して再読み込みしてください。"}
          </p>
        </section>
      )}
      {preOrderAcceptanceDisabled && !orderEntryDisabled && (
        <section className="border-heavy border-warning bg-warning/10 p-4" role="status" aria-live="polite">
          <p className="text-sm font-black">事前注文の受付を停止しています</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">メニューは確認できます。注文を受け付ける場合は、サークル設定の「注文受付」から事前注文を有効にしてください。</p>
        </section>
      )}

      {/* メニュー一覧。常設のクーポンセクションは置かず、各カードの中でトッピング選択の
          すぐ下に関係するクーポンを出す (2026-09-16、モーダル案は撤回してカード内に戻した)。 */}
      <div>
        <h2 className="text-[24px] sm:text-[32px] font-headline uppercase tracking-tight mb-sp-3 leading-[1.1]">
            {isMobileOrderRoute ? "モバイル注文" : "メニューを選択して事前注文"}
        </h2>
        {menus && menus.length > 0 ? (
          <>
          <MenuCategoryFilter menus={menus} selectedCategory={selectedMenuCategory} onSelect={setSelectedMenuCategory} />
          {/* 2026-10-21: 商品数が少ない画面で空の列を残さず、1件でも中央に読みやすい幅で表示する。 */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-sp-3">
            {menus.filter((menu) => selectedMenuCategory === null || menuCategoryKey(menu.category) === selectedMenuCategory).map((menu) => (
              <VisitorMenuCard
                key={menu.id}
                menu={menu}
                relevantCoupons={isPreOrderEnabled() ? [] : relevantCouponsForMenu(menu)}
                enabledCouponSlugs={enabledCouponSlugs}
                onToggleCoupon={toggleCoupon}
                onAdd={addLine}
                orderingDisabled={orderEntryDisabled || preOrderAcceptanceDisabled}
                orderingDisabledLabel={orderEntryDisabled ? orderEntryDisabledLabel : "事前注文は受付停止中"}
              />
            ))}
          </div>
          </>
        ) : (
          <EmptyState icon={ShoppingCart} message="メニューがまだ登録されていません" />
        )}
      </div>

      {/* 2026-10-07 Issue #49: カート保存状態とマイQRを同じ操作起点に置き、注文確定前でも提示できるようにする。 */}
      {!orderEntryDisabled && (cart.length > 0 || userId) && (
        <div id="standard-cart-bar" className="fixed bottom-0 left-0 right-0 z-40 bg-primary text-primary-foreground border-t-heavy border-border p-3 sm:p-4">
          <div className="max-w-4xl mx-auto flex flex-col gap-3">
            {cart.length > 0 && <div className="flex items-center justify-between gap-2">
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
              {cartBundle.applied.length > 0 && (
                <p className="text-[10px] sm:text-xs font-mono font-bold">
                  {cartBundle.applied.map((item) => `${item.title}${item.sets > 1 ? ` ×${item.sets}` : ""}`).join("・")}適用 −¥{cartBundle.totalDiscount.toLocaleString()}
                </p>
              )}
              <p className="text-[10px] sm:text-xs text-primary-foreground/80 font-mono hidden sm:block">
                事前に注文を予約し、レジでスムーズに会計できます。
              </p>
            </div>}
            {!isPreOrderEnabled() && (cart.length > 0 || preOrderMutation.isError) && (
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-primary-foreground/80" role="status">
                {preOrderMutation.isError ? (
                  <>
                    {preOrderStockError ? (
                      <span className="w-full font-bold text-destructive" role="alert">
                        {preOrderStockError}
                      </span>
                    ) : (
                      <span>
                        {isRetryablePreOrderSaveError(preOrderMutation.error)
                          ? "カートを保存できませんでした。通信を確認して再試行してください。"
                          : "カートの保存状態を確認できません。画面を再読み込みしてください。"}
                      </span>
                    )}
                    {isRetryablePreOrderSaveError(preOrderMutation.error) && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={preOrderMutation.isPending || !draftRetryWaitElapsed}
                        onClick={() => {
                          // 2026-10-08 Issue #49: 同一内容の自動保存失敗後も、利用者が保存を再開できるよう重複抑止を解除する。
                          lastDraftPayloadRef.current = null;
                          setDraftSaveRetry((attempt) => attempt + 1);
                        }}
                        className="h-7 rounded-none px-2 text-[10px] font-bold"
                      >
                        {draftRetryWaitElapsed ? "再試行" : "再試行待ち…"}
                      </Button>
                    )}
                  </>
                ) : preOrderMutation.isPending ? "カートを保存しています…" : hydratedDraftKey === draftKey ? "カートは自動保存されます" : "カートを読み込んでいます…"}
              </div>
            )}
            {applicableCoupons.length > 0 && (
              <div className="flex items-center gap-1.5 bg-background text-foreground px-2 py-1 text-[11px] font-bold w-fit flex-wrap">
                <Ticket className="h-3.5 w-3.5 shrink-0" />
                {applicableCoupons.map((c) => `「${c.title}」`).join(" + ")} 適用中 (¥{couponDiscount.toLocaleString()}引き)
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                onClick={() => setIsQrOpen(true)}
                disabled={!canDisplayMyQr || isWristbandStatusLoading}
                className="w-full sm:flex-1 h-12 border-thick border-border bg-background px-3 font-mono text-sm font-black uppercase text-foreground rounded-none hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-foreground"
              >
                <QrCode className="mr-2 h-5 w-5 shrink-0" />{myQrButtonLabel}
              </Button>
              {cart.length > 0 && (
                <Button
                  onClick={() => setIsCartOpen(true)}
                  className="w-full sm:flex-1 h-12 border-thick border-border bg-background px-3 font-mono text-sm font-black uppercase text-foreground rounded-none hover:bg-primary hover:text-primary-foreground"
                >
                  <ShoppingCart className="mr-2 h-5 w-5 shrink-0" />{isMobileOrderRoute ? "注文内容を確認する" : "注文を確認する"}
                </Button>
              )}
            </div>
            {!canDisplayMyQr && !isWristbandStatusLoading && !isCircleEventLoading && (
              <p className="text-[10px] text-primary-foreground/80 font-mono" role="status">
                {isWristbandStatusError || isCircleEventError
                  ? "入場情報を確認できません。通信を確認して画面を再読み込みしてください。"
                  : mustPresentPhysicalWristband
                    ? "このイベントではスマートフォンQRを発行していません。物理リストバンドを提示してください。"
                    : "受付・本部で入場登録すると、注文の受取や店頭会計で使うQRを表示できます。"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 標準カート確認モーダル */}
      <Modal
        isOpen={isCartOpen && !orderEntryDisabled}
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

        <OrderAllergyWarning
          warnings={cartAllergyWarnings}
          familyAllergies={familyAllergies}
          enabled={!!userId && cart.length > 0}
        />

        <div className="border-t-thick border-border pt-3 space-y-2">
          {/* 2026-10-16: 小計上限で調整した後の実適用額を内訳にも表示する。 */}
          {couponApplications.map(({ coupon: c, discount }) => (
            <div key={c.slug} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-bold">
                <Ticket className="h-3.5 w-3.5 shrink-0" />
                「{c.title}」
              </span>
              <span className="flex items-center gap-2">
                <span className="font-bold text-success">-¥{discount.toLocaleString()}</span>
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
            {isMobileOrderEnabled()
              ? "注文はサーバーで受付が完了してから確定します。通信が切れた場合は端末に保存し、復帰後に再送します。"
              : "このサークルはモバイルオーダーを受け付けていません。カートを保存し、レジでお支払いください。"}
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
          {/* 2026-10-21: APIも mobileOrderEnabled だけを受付条件にするため、画面側も同じ設定へ揃える。 */}
          {isMobileOrderRoute && isMobileOrderEnabled() ? <Button
            onClick={() => {
              if (!userId) {
                toast.error("注文にはリストバンドが必要です。QR を読み取って入場してください。");
                return;
              }
              setIsCartOpen(false);
              codOrderMutation.mutate();
            }}
            disabled={!userId || codOrderMutation.isPending}
            className="w-full h-12 border-thick border-border bg-primary text-primary-foreground text-base font-black uppercase rounded-none hover:bg-background hover:text-foreground transition-all disabled:opacity-50"
          >
            {codOrderMutation.isPending
              ? "送信中..."
              : !userId
                ? "入場が必要です"
                : "注文を送信する"}
          </Button> : (
            <Button
              type="button"
              onClick={() => setIsCartOpen(false)}
              className="w-full h-12 border-thick border-border bg-primary text-primary-foreground text-base font-black uppercase rounded-none hover:bg-background hover:text-foreground"
            >
              カートへ戻る
            </Button>
          )}
        </div>
      </Modal>

      {/* 2026-10-21: 店舗が公開を選んだ項目だけを表示し、匿名レビューに来場者IDを含めない。 */}
      <Modal
        isOpen={isReviewsOpen && !!publicReviewSummary}
        onClose={() => setIsReviewsOpen(false)}
        title={`[${circleData?.name ?? "店舗"}のレビュー]`}
        subtitle="来場者から寄せられたレビューです"
        maxWidth="lg"
      >
        {publicReviewsQuery.isLoading ? (
          <div className="space-y-3" role="status" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <span className="sr-only">レビューを読み込んでいます</span>
          </div>
        ) : publicReviewsQuery.isError ? (
          <ErrorState
            error={publicReviewsQuery.error}
            title="レビューを読み込めませんでした"
            onRetry={() => void publicReviewsQuery.refetch()}
          />
        ) : publicReviewsQuery.data && publicReviewSummary ? (
          <div className="space-y-4">
            {publicReviewSummary.showAverageRating && (
              <div className="flex flex-wrap items-center gap-2 border-thick border-border bg-muted/30 p-3">
                <span className="text-2xl font-black tabular-nums">
                  {publicReviewSummary.averageRating == null ? "—" : publicReviewSummary.averageRating.toFixed(1)}
                </span>
                <span className="inline-flex items-center" role="img" aria-label={`${publicReviewSummary.averageRating?.toFixed(1) ?? "評価なし"} / 5`}>
                  {Array.from({ length: 5 }, (_, index) => (
                    <Star key={index} aria-hidden="true" className={`h-4 w-4 ${publicReviewSummary.averageRating != null && index < Math.round(publicReviewSummary.averageRating) ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                  ))}
                </span>
                <span className="text-xs text-muted-foreground">{publicReviewSummary.reviewCount}件の評価</span>
              </div>
            )}

            {!publicReviewsQuery.data.showStars && !publicReviewsQuery.data.showComments ? (
              <div className="border-thick border-border bg-muted/30 p-4 text-sm leading-relaxed">
                この店舗はレビューを公開していますが、星と文章は表示しない設定です。
              </div>
            ) : publicReviewsQuery.data.reviews.length === 0 ? (
              <EmptyState icon={MessageSquareText} message="公開中のレビューはまだありません" />
            ) : (
              <div className="space-y-2" role="list" aria-label="公開中のレビュー">
                {publicReviewsQuery.data.reviews.map((review, index) => (
                  <article key={`${review.createdAt}-${index}`} role="listitem" className="min-w-0 border-thick border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {publicReviewsQuery.data!.showStars && review.rating != null ? (
                        <span className="inline-flex items-center gap-1" role="img" aria-label={`${review.rating}つ星`}>
                          {Array.from({ length: 5 }, (_, starIndex) => (
                            <Star key={starIndex} aria-hidden="true" className={`h-4 w-4 ${starIndex < review.rating! ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                          ))}
                          <span className="ml-1 text-xs font-bold tabular-nums">{review.rating}.0</span>
                        </span>
                      ) : <span className="text-xs font-bold text-muted-foreground">レビュー</span>}
                      <time className="text-[10px] text-muted-foreground">
                        {new Date(review.createdAt).toLocaleDateString("ja-JP")}
                      </time>
                    </div>
                    {publicReviewsQuery.data!.showComments && review.comment?.trim() && (
                      <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-relaxed">{review.comment}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* 2026-10-08: 登録済みバンドがない場合は userId を代用したQRを生成しない。 */}
      <Modal isOpen={isQrOpen && canDisplayMyQr} onClose={() => setIsQrOpen(false)} title="[マイQR]" maxWidth="md">
        {canDisplayMyQr && activeWristband ? (
          <div className="space-y-3 text-center">
            <div className="inline-block border-thick border-border bg-background p-3">
              <QRCodeSVG
                value={`${appOrigin}/w/${activeWristband.id}`}
                size={200}
                level="M"
                title="マイQR"
                className="mx-auto block"
              />
            </div>
            <p className="break-all text-xs font-bold">{wristbandStatus.user.id}</p>
          </div>
        ) : (
          <p className="text-sm">マイQRを表示するには、受付・本部で入場登録を行ってください。</p>
        )}
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
                eventEnded,
                orderingDisabled: orderEntryDisabled,
              }}
              onAction={(actionType, payload) => {
                if (orderEntryDisabled && ["ADD_TO_CART", "UPDATE_QUANTITY", "SAVE_DIRECT_ORDER", "CLEAR_CART"].includes(actionType)) {
                  toast.message(eventEnded ? "開催終了のため注文を受け付けていません" : eventUpcoming ? "開催前のため注文できません" : "開催状況を確認できるまで注文できません");
                  return;
                }
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
                eventEnded,
                orderingDisabled: orderEntryDisabled,
              }}
              onAction={(actionType, payload) => {
                if (orderEntryDisabled && ["ADD_TO_CART", "UPDATE_QUANTITY", "SAVE_DIRECT_ORDER", "CLEAR_CART"].includes(actionType)) {
                  toast.message(eventEnded ? "開催終了のため注文を受け付けていません" : eventUpcoming ? "開催前のため注文できません" : "開催状況を確認できるまで注文できません");
                  return;
                }
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

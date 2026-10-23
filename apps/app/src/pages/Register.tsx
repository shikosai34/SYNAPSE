
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAuthGuard, getAuthInfo, useAuth } from "@/hooks/useCircleAuth";
import { menuApi, toppingApi, orderApi, circleApi, eventApi, wristbandApi, preOrderApi, couponApi, discountApi, bundleDiscountApi, parseCircleSettings, parseEventPaymentMethods, activeWaitTimeReport, type MenuWithToppings, type Topping, type OrderWithItems, type RegisterDiscountOption, type RegisterDisplaySession } from "@/lib/api";
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
import { Modal } from "@/components/ui/Modal";
import { toast } from "sonner";
import { Minus, Plus, ShoppingCart, Trash2, QrCode, X, ScanLine, Monitor, Copy, Receipt, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { ApiError } from "@/lib/api-error";
import { resolveAssetUrl } from "@/lib/asset-url";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useSessionState } from "@/hooks/useSessionState";
import { displayOrderNumber } from "@/lib/order-number";
// 2026-10-03: 画面をまたぐカート規則と再送制御を機能モジュールに集約する。
import { addCartLine, updateCartQuantity, toggleCartTopping, lineSubtotal, checkoutTotal, cartBundleDiscount, cartCount, type CartLine, type CartTopping } from "@/features/orders/cart";
import { useOrderSubmission } from "@/features/orders/use-order-submission";
import type { CreateOrderInput } from "@fesflow/config/order-contract";
import { ToppingSelection, parseToppingCategoryMaximums, parseToppingCategoryMinimums } from "@/components/menu/ToppingSelection";
import { MenuCategoryFilter, menuCategoryKey } from "@/components/menu/MenuCategoryFilter";
import { parseJapaneseAllergens, type JapaneseAllergen } from "@fesflow/config/allergens";
import { getCartAllergyWarnings, OrderAllergyWarning } from "@/features/orders/allergy-check";
import { clearRegisterDisplayConnection, readRegisterDisplayConnection, saveRegisterDisplayConnection } from "@/features/orders/register-display-connection";
import type { RegisterDisplaySnapshot } from "@fesflow/config/register-display-contract";

type CustomerDisplayShare = RegisterDisplaySession & { circleId: string; url: string; localOnly: boolean };

// カートは「行 (line)」単位。同じメニューでもトッピング構成が違えば別行として持てるように
// menuId ではなく lineId をキーにする (トッピングあり/なしを同時注文したい要件のため)。
// 2026-10-08: ウィザード設定品は独立画面で一品ずつ選ぶ。確定/取消のたびに既定状態へ戻し、選択の持ち越しを防ぐ。
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
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  // 2026-10-07 Issue #111: トッピング未設定なら選択工程が存在しないため、追加を止めない。
  const [selectionReady, setSelectionReady] = useState(!menu.toppingWizardEnabled || menu.toppings.length === 0);
  const toppingMinimums = parseToppingCategoryMinimums(menu.toppingCategoryMinimums);
  const toppingMaximums = parseToppingCategoryMaximums(menu.toppingCategoryMaximums);

  // メニュー(既定トッピング)が変わったら選択状態を作り直す
  useEffect(() => {
    setSelected(defaultIds());
    setSelectionReady(!menu.toppingWizardEnabled || menu.toppings.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.id, menu.defaultToppingIds, menu.toppingWizardEnabled]);

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
    if (!selectionReady) return;
    const chosen: CartTopping[] = availableToppings
      .filter((t) => selected.has(t.id))
      .map((t) => ({ toppingId: t.id, toppingName: t.name, toppingPrice: t.price }));
    onAdd(menu, chosen);
    setSelected(defaultIds()); // 次の1品のために既定へ戻す
    setIsWizardOpen(false);
  };

  const openToppingWizard = () => {
    setSelected(defaultIds());
    setSelectionReady(false);
    setIsWizardOpen(true);
  };

  const closeToppingWizard = () => {
    setIsWizardOpen(false);
    setSelected(defaultIds());
  };

  const wizardTotal = menu.price + availableToppings
    .filter((t) => selected.has(t.id) && !t.soldOut)
    .reduce((sum, t) => sum + t.price, 0);

  return (
    <Card>
      <CardHeader className="p-0">
        <div className="relative h-28 sm:h-36 w-full overflow-hidden border-b-thick border-border">
          {menu.imagePath ? (
            <img src={resolveAssetUrl(menu.imagePath)} alt={menu.name} className="object-cover absolute inset-0 h-full w-full" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <span className="font-mono text-[11px] sm:text-[14px] uppercase tracking-[1px]">No Image</span>
            </div>
          )}
          {/* 2026-10-21: 来場者画面と同じ赤系の売切表示にそろえる。 */}
          {menu.soldOut && (
            <div className="absolute inset-0 bg-error/85 flex items-center justify-center">
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

        {/* 2026-10-08: ウィザード設定品はカード上で誤操作させず、完了後に一度だけカートへ加える。 */}
        {availableToppings.length > 0 && !menu.toppingWizardEnabled && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">トッピング（任意）</p>
            <ToppingSelection
              menuId={menu.id}
              toppings={availableToppings}
              selected={selected}
              onToggle={toggle}
              wizardEnabled={false}
              disabled={menu.soldOut}
              minimums={toppingMinimums}
              maximums={toppingMaximums}
              onReadyChange={setSelectionReady}
            />
          </div>
        )}

        <Button
          className="w-full h-10 sm:h-11 border-thick border-border bg-primary text-primary-foreground font-mono text-xs sm:text-sm font-bold uppercase rounded-none hover:bg-background hover:text-foreground transition-all"
          onClick={menu.toppingWizardEnabled && availableToppings.length > 0 ? openToppingWizard : handleAdd}
          disabled={menu.soldOut || (!menu.toppingWizardEnabled && !selectionReady)}
          aria-label={menu.toppingWizardEnabled && availableToppings.length > 0
            ? `${menu.name}のトッピングを選択`
            : `${menu.name}をカートに追加。トッピング込み ¥${(menu.price + selectedExtra).toLocaleString()}`}
        >
          {menu.toppingWizardEnabled && availableToppings.length > 0
            ? "選択"
            : `追加${selectedExtra !== 0 ? ` (¥${(menu.price + selectedExtra).toLocaleString()})` : ""}`}
        </Button>
      </CardContent>

      {menu.toppingWizardEnabled && availableToppings.length > 0 && (
        <Modal
          isOpen={isWizardOpen}
          onClose={closeToppingWizard}
          title={`[${menu.name} のトッピング選択]`}
          subtitle="カテゴリの条件を確認し、選び終わったらカートへ入れてください。"
          maxWidth="lg"
        >
          <ToppingSelection
            menuId={menu.id}
            toppings={availableToppings}
            selected={selected}
            onToggle={toggle}
            wizardEnabled
            disabled={menu.soldOut}
            minimums={toppingMinimums}
            maximums={toppingMaximums}
            onReadyChange={setSelectionReady}
          />
          <div className="flex flex-col-reverse gap-3 border-t-thick border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" onClick={closeToppingWizard} className="w-full sm:w-auto">
              キャンセル
            </Button>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">トッピング込み</p>
                <p className="text-lg font-black">¥{wizardTotal.toLocaleString()}</p>
              </div>
              <Button type="button" onClick={handleAdd} disabled={!selectionReady} className="flex-1 sm:flex-none">
                <ShoppingCart className="h-4 w-4" />
                カートに入れる
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// カート本体。デスクトップのサイドバーとモバイルのスライドアップの両方で使い回す。
function CartBody({
  cart,
  idPrefix,
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
  bundleApplied,
  bundleDiscountAmount,
  isPreOrder,
  registerCoupons,
  registerCouponId,
  onSetRegisterCoupon,
  registerDiscounts,
  discountId,
  onSetDiscount,
  paymentMethods,
  paymentMethod,
  onSetPayment,
}: {
  cart: CartLine[];
  idPrefix: "desktop" | "mobile";
  menuMap: Map<string, MenuWithToppings>;
  peopleCount: number;
  activeCustomer: { userId: string; wristbandId: string | null; familyBandCount: number; allergies: JapaneseAllergen[] | null } | null;
  submitting: boolean;
  onToggleTopping: (lineId: string, topping: Topping) => void;
  onUpdateQuantity: (lineId: string, delta: number) => void;
  onRemoveLine: (lineId: string) => void;
  onSetPeople: (n: number) => void;
  onSubmit: () => void;
  onClear: () => void;
  total: number;
  // 2026-10-23: 自動適用されるセット割引。手動割引/クーポンの割引額プレビューはこの後の金額に対して計算する。
  bundleApplied: { id: string; title: string; sets: number; discountApplied: number }[];
  bundleDiscountAmount: number;
  isPreOrder: boolean;
  registerCoupons: { id: string; title: string; discountPercent: number | null }[];
  registerCouponId: string;
  onSetRegisterCoupon: (id: string) => void;
  registerDiscounts: RegisterDiscountOption[];
  discountId: string;
  onSetDiscount: (id: string) => void;
  // 支払い方法 (2026-07-12)。要素が2つ以上のときだけ選択UIを出す。
  paymentMethods: string[];
  paymentMethod: string;
  onSetPayment: (m: string) => void;
}) {
  // 支払い方法が2つ以上あるのに未選択なら確定を止める。
  const needsPayment = paymentMethods.length > 1 && !paymentMethod;
  // 2026-10-16: カート操作の状態を読み上げ可能にし、数量変更後の合計と選択状態を追えるようにする。
  const peopleCountId = `${idPrefix}-people-count`;
  const allergyWarnings = getCartAllergyWarnings(cart, menuMap, activeCustomer?.allergies ?? null);
  return (
    // 2026-07-16: 親 (aside / モバイルのスライドアップパネル) は max-height + overflow-hidden で
    // 高さの上限を持つコンテナ。ここを h-full ではなく flex-1 min-h-0 にすることで、
    // 「アイテム一覧」と「フッター」を含むこのブロック全体が親の残り高さぴったりに収まり、
    // はみ出した分は内側の overflow-y-auto (アイテム一覧側) がスクロールで吸収するようにする。
    // (h-full は親が max-height のみで高さが確定していないと効かず、以前はここが常に
    //  コンテンツ丈まで伸びてしまい、フッターごと画面外に押し出されてスクロールもできなかった)
    <div className="flex flex-col flex-1 min-h-0 font-mono">
      {/* アイテム一覧: flex-1 だけでは子が縮まない (flexアイテムの初期 min-height:auto によりコンテンツ丈を下回れない) ため、
          min-h-0 を明示して初めて overflow-y-auto が実際にスクロール領域として機能する。 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
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
                  {/* 2026-10-16: アイコンだけの操作にも商品名を含む読み上げ名を付ける。 */}
                  <button
                    type="button"
                    onClick={() => onRemoveLine(line.lineId)}
                    aria-label={`${line.menuName}をカートから削除`}
                    className="w-8 h-8 border-thin border-border flex items-center justify-center hover:bg-error hover:text-white shrink-0 transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>

                {/* トッピング調整 (カート内でも変更可。タップでトグル) */}
                {allowed.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wider">トッピング:</p>
                    <div className="space-y-1.5">
                      {allowed.map((topping) => {
                        const on = line.toppings.some((t) => t.toppingId === topping.id);
                        return (
                          <button
                            key={topping.id}
                            type="button"
                            disabled={topping.soldOut}
                            onClick={() => onToggleTopping(line.lineId, topping)}
                            aria-pressed={on}
                            className={cn(
                              "flex min-h-10 w-full items-center justify-between gap-2 border-thick rounded-none px-2 py-1 text-left text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                              on
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background hover:bg-muted"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {topping.imagePath && (
                                <img src={resolveAssetUrl(topping.imagePath)} alt="" className="h-5 w-5 object-cover border-thin border-current shrink-0" />
                              )}
                              <span className="break-words">{topping.name}</span>
                            </span>
                            <span className={cn("shrink-0 tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>
                              {topping.price >= 0 ? `+¥${topping.price.toLocaleString()}` : `-¥${Math.abs(topping.price).toLocaleString()}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 数量 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center border-thin border-border" role="group" aria-label={`${line.menuName}の数量`}>
                    <button
                      type="button"
                      onClick={() => onUpdateQuantity(line.lineId, -1)}
                      aria-label={`${line.menuName}の数量を1減らす`}
                      className="w-10 h-10 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all border-r-thin border-border"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-10 text-center font-black text-lg" aria-live="polite" aria-atomic="true">{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => onUpdateQuantity(line.lineId, 1)}
                      aria-label={`${line.menuName}の数量を1増やす`}
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

      {/* フッター (合計・人数・確定): shrink-0 で、アイテムが増えて領域が窮屈になっても
          このフッター自体は縮まないようにする (縮むのは上のアイテム一覧側だけにする)。
          これが無いと flex の既定 shrink:1 により極端なケースで確定ボタンごと潰れうる。 */}
      <div className="shrink-0 p-3 sm:p-4 border-t-thick border-border space-y-3 bg-background">
        <div className="flex items-center gap-3">
          {/* 2026-10-16: PC用とモバイル用のカートが同時にDOMへあるため、入力IDを分けてラベル先を一意にする。 */}
          <Label htmlFor={peopleCountId} className="font-mono text-xs uppercase tracking-wider whitespace-nowrap">来店人数</Label>
          {/* 入力中は 0/空を許容し、フォーカスを外した時に 1 未満なら 1 へ戻す
              (min=1 だと打ち直しのたびに値が押し戻されて入力しづらいため)。 */}
          <Input
            id={peopleCountId}
            type="number"
            inputMode="numeric"
            className="h-10 text-center font-bold border-thick border-border rounded-none"
            value={peopleCount}
            onChange={(e) => onSetPeople(Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
            onBlur={() => { if (peopleCount < 1) onSetPeople(1); }}
          />
        </div>
        {/* 2026-10-17: 来店人数はラベルで区別し、家族バンド数との関係を説明文で繰り返さない。 */}
        {registerCoupons.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-register-coupon`} className="font-mono text-xs uppercase tracking-wider">レジ専用割引券</Label>
            <select
              id={`${idPrefix}-register-coupon`}
              value={registerCouponId}
              onChange={(event) => onSetRegisterCoupon(event.target.value)}
              disabled={isPreOrder || !!discountId}
              className="h-10 w-full border-thick border-border bg-background px-2 text-sm font-bold disabled:opacity-50"
            >
              <option value="">適用しない</option>
              {registerCoupons.map((coupon) => (
                <option key={coupon.id} value={coupon.id}>{coupon.title} ({coupon.discountPercent}％引き)</option>
              ))}
            </select>
            {isPreOrder && <p className="text-[10px] text-muted-foreground">事前注文には適用できません。</p>}
            {!isPreOrder && registerCouponId && (() => {
              const selected = registerCoupons.find((coupon) => coupon.id === registerCouponId);
              const amount = selected?.discountPercent
                ? Math.floor(((checkoutTotal(cart, null) - bundleDiscountAmount) * selected.discountPercent) / 100)
                : 0;
              return amount > 0 ? <p className="text-xs font-bold text-primary">割引額: −¥{amount.toLocaleString()}</p> : null;
            })()}
          </div>
        )}
        {registerDiscounts.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-discount`} className="font-mono text-xs uppercase tracking-wider">割引</Label>
            <select
              id={`${idPrefix}-discount`}
              value={discountId}
              onChange={(event) => onSetDiscount(event.target.value)}
              disabled={isPreOrder || !!registerCouponId}
              className="h-10 w-full border-thick border-border bg-background px-2 text-sm font-bold disabled:opacity-50"
            >
              <option value="">適用しない</option>
              {registerDiscounts.map((item) => (
                <option key={item.id} value={item.id}>{item.title} ({item.kind === "percentage" ? `${item.value}%引き` : `¥${item.value.toLocaleString()}引き`})</option>
              ))}
            </select>
            {isPreOrder && <p className="text-[10px] text-muted-foreground">割引は新規のレジ会計にのみ適用できます。</p>}
            {!isPreOrder && registerCouponId && <p className="text-[10px] text-muted-foreground">クーポンを解除すると選択できます。</p>}
            {!isPreOrder && discountId && (() => {
              const selected = registerDiscounts.find((item) => item.id === discountId);
              const subtotal = Math.max(0, checkoutTotal(cart, null) - bundleDiscountAmount);
              const amount = selected?.kind === "percentage"
                ? Math.floor((subtotal * selected.value) / 100)
                : selected ? Math.min(subtotal, selected.value) : 0;
              return <p className="text-xs font-bold text-primary">割引額: −¥{amount.toLocaleString()}</p>;
            })()}
          </div>
        )}
        {!isPreOrder && bundleApplied.length > 0 && (
          <ul className="space-y-0.5 text-xs font-bold text-primary" aria-label="自動適用されたセット割引">
            {bundleApplied.map((item) => (
              <li key={item.id}>セット割引 {item.title}{item.sets > 1 ? ` ×${item.sets}` : ""}: −¥{item.discountApplied.toLocaleString()}</li>
            ))}
          </ul>
        )}
        <div className="flex justify-between items-center border-thick border-border px-4 py-3 bg-muted" role="status" aria-live="polite" aria-atomic="true">
          <span className="font-mono text-sm uppercase tracking-wider">合計金額</span>
          <span className="font-headline text-2xl sm:text-3xl font-black">¥{total.toLocaleString()}</span>
        </div>
        {isPreOrder && <p className="text-xs text-muted-foreground">事前注文時に確定した金額です。</p>}

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
                  aria-pressed={paymentMethod === m}
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
            <div>来場者: {activeCustomer.wristbandId ?? activeCustomer.userId}</div>
            <div className="mt-1 font-bold">登録バンド {activeCustomer.familyBandCount}本</div>
          </div>
        )}
        <OrderAllergyWarning
          warnings={allergyWarnings}
          familyAllergies={activeCustomer?.allergies ?? null}
          enabled={!!activeCustomer && cart.length > 0}
        />
        {/* 2026-10-17: 不足状態は確定ボタンの文言に集約し、画面上部の案内と重ねない。 */}
        <Button
          className="w-full h-14 border-thick border-border bg-primary text-primary-foreground font-mono text-base font-black uppercase rounded-none hover:bg-background hover:text-foreground transition-all"
          onClick={onSubmit}
          disabled={cart.length === 0 || submitting || !activeCustomer || needsPayment}
        >
          {submitting
            ? "確定中…"
            : needsPayment
              ? "支払い方法を選択"
              : !activeCustomer
                ? "来場者を確認"
                : cart.length === 0
                  ? "商品を選択"
                  : isPreOrder
                    ? "受取を確定"
                    : "注文を確定する"}
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
  // 2026-07-16: circleId を useState+useEffect(mount時一度きり) で固定していると、
  // 同一パス上でスペース切り替え後も古いサークルのレジ画面のまま表示され続ける。
  // useAuth() (authChange 購読) に統一する。
  const { circleId: authCircleId } = useAuth();
  const queryClient = useQueryClient();
  const circleId = authCircleId ?? "";
  const registerStateKey = `fesflow:register-state:${circleId || "unselected"}`;
  const [selectedMenuCategory, setSelectedMenuCategory] = useSessionState<string | null>(`${registerStateKey}:category`, null);
  const [cart, setCart] = useSessionState<CartLine[]>(`${registerStateKey}:cart`, []);
  const [peopleCount, setPeopleCount] = useSessionState(`${registerStateKey}:people`, 1);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isCustomerQrModalOpen, setIsCustomerQrModalOpen] = useState(false);
  const [isCustomerDisplayModalOpen, setIsCustomerDisplayModalOpen] = useState(false);
  const [customerDisplayShare, setCustomerDisplayShare] = useState<CustomerDisplayShare | null>(null);
  const [customerDisplaySyncError, setCustomerDisplaySyncError] = useState(false);
  const customerDisplayWindow = useRef<Window | null>(null);
  const [submittedCustomerDisplaySnapshot, setSubmittedCustomerDisplaySnapshot] = useSessionState<RegisterDisplaySnapshot | null>(`${registerStateKey}:customer-display-submitted`, null);
  const submittingCustomerDisplaySnapshot = useRef<RegisterDisplaySnapshot | null>(null);
  const [isCartPanelOpen, setIsCartPanelOpen] = useState(false);
  useBodyScrollLock(isCartPanelOpen);
  useEffect(() => {
    if (!isCartPanelOpen) return;
    // 2026-10-21: xl 以上では固定カートを隠すため、画面回転/リサイズ時にロックも解除する。
    const closeOnWideViewport = () => {
      if (window.matchMedia("(min-width: 1280px)").matches) setIsCartPanelOpen(false);
    };
    window.addEventListener("resize", closeOnWideViewport);
    return () => window.removeEventListener("resize", closeOnWideViewport);
  }, [isCartPanelOpen]);
  const [scannedCode, setScannedCode] = useState("");
  const [activeCustomer, setActiveCustomer] = useSessionState<{ userId: string; wristbandId: string | null; familyBandCount: number; allergies: JapaneseAllergen[] | null } | null>(`${registerStateKey}:customer`, null);
  const [mobilePaymentMethods, setMobilePaymentMethods] = useState<Record<string, string>>({});
  const [activePreOrderId, setActivePreOrderId] = useSessionState<string | null>(`${registerStateKey}:preorder`, null);
  const [activePreOrderTotalPrice, setActivePreOrderTotalPrice] = useSessionState<number | null>(`${registerStateKey}:preorder-total`, null);
  const [registerCouponId, setRegisterCouponId] = useSessionState(`${registerStateKey}:coupon`, "");
  const { data: registerCoupons = [] } = useQuery({
    queryKey: ["register-coupons", circleId],
    queryFn: () => couponApi.registerOptions(circleId),
    enabled: !!circleId,
    refetchInterval: 60_000,
  });
  const [discountId, setDiscountId] = useSessionState(`${registerStateKey}:discount`, "");
  const { data: registerDiscounts = [] } = useQuery({
    queryKey: ["register-discounts", circleId],
    queryFn: () => discountApi.registerOptions(circleId),
    enabled: !!circleId,
    refetchInterval: 60_000,
  });

  // 2026-10-23: セット割引 (N個で○円) はサーバーが自動適用する。同じ規則で画面の合計も先に出す。
  const { data: bundleRules = [] } = useQuery({
    queryKey: ["bundle-discounts", circleId],
    queryFn: () => bundleDiscountApi.active(circleId),
    enabled: !!circleId,
    refetchInterval: 60_000,
  });

  const { data: circle } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
    // 2026-10-07 (#9): レジ担当にも報告後30分の期限切れを画面上で反映する。
    refetchInterval: 60_000,
  });
  // 2026-10-21: レジを離れて厨房へ移動しても、報告前の待ち時間入力を同じサークル内で保つ。
  const [waitMinutes, setWaitMinutes] = useSessionState<string>(`${registerStateKey}:wait-minutes`, "10");
  const waitTimeReport = activeWaitTimeReport(circle?.settings);
  const reportWaitTime = useMutation({
    mutationFn: () => circleApi.reportWaitTime(circleId, Number(waitMinutes)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circle", circleId] });
      queryClient.invalidateQueries({ queryKey: ["circles", circle?.eventId] });
      toast.success("待ち時間を報告しました");
    },
    onError: (error: any) => toast.error(error.message || "待ち時間を報告できませんでした"),
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
  // 2026-10-22: 注文登録済みのモバイル注文はカートへ複製せず、読み取った来場者の未会計分として別表示する。
  const unpaidMobileQueryKey = ["unpaidMobileOrders", circleId, activeCustomer?.userId] as const;
  const unpaidMobileOrders = useQuery({
    queryKey: unpaidMobileQueryKey,
    queryFn: () => orderApi.getUnpaidMobileByUser(circleId, activeCustomer!.userId),
    enabled: !!circleId && !!activeCustomer?.userId,
    refetchInterval: 15_000,
    retry: false,
  });
  const settleMobileOrder = useMutation({
    mutationFn: ({ orderId, userId, paymentMethod }: { orderId: string; userId: string; paymentMethod: string }) =>
      orderApi.settleMobile(orderId, paymentMethod),
    onSuccess: (result, variables) => {
      setMobilePaymentMethods((current) => {
        const next = { ...current };
        delete next[variables.orderId];
        return next;
      });
      toast.success(result.alreadyPaid ? "別のレジで会計済みでした" : "未会計注文の会計を確定しました");
      void queryClient.invalidateQueries({ queryKey: ["unpaidMobileOrders", circleId, variables.userId] });
      void queryClient.invalidateQueries({ queryKey: ["myOrders", variables.userId] });
      void queryClient.invalidateQueries({ queryKey: ["orders", circleId] });
    },
    onError: (error: any, variables) => {
      toast.error(error?.message || "会計状態を確認できませんでした。一覧を更新してください");
      void queryClient.invalidateQueries({ queryKey: ["unpaidMobileOrders", circleId, variables.userId] });
    },
  });
  const [paymentMethod, setPaymentMethod] = useSessionState(`${registerStateKey}:payment`, "");
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
        setSubmittedCustomerDisplaySnapshot(null);
        // 顧客を特定するだけ。事前オーダーのロードは activeCustomer の変化を監視する
        // useEffect 側で行う (カメラスキャン経由でも確実に走らせるための共通化)。
        setActiveCustomer({
          userId: data.user.id,
          wristbandId: data.wristband?.id || null,
          familyBandCount: data.familyBandCount ?? 0,
          allergies: parseJapaneseAllergens(data.user.allergies),
        });
        toast.success("来場者を確認しました");
        setScannedCode("");
      } else {
        toast.error("ユーザーが見つかりませんでした");
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "照会に失敗しました");
    },
  });

  // 2026-07-13: 顧客が特定されたら (カメラスキャン/手入力どちらでも) 該当サークルの
  // pending な事前オーダーを自動でカートにロードする。特定手段による分岐をなくすため、
  // activeCustomer の変化を監視するリアクティブな設計にしている。
  useEffect(() => {
    if (!activeCustomer) {
      setActivePreOrderId(null);
      setActivePreOrderTotalPrice(null);
      return;
    }

    // アンマウントや顧客切替時に、遅れて解決した fetch がカートを上書きしないようにするガード
    let isMounted = true;
    const loadPreOrder = async () => {
      try {
        const preOrders = await preOrderApi.getByCode(activeCustomer.userId, circleId);
        const pendingOrders = preOrders.filter(
          (po) => po.status === "pending" && po.circleId === circleId
        );
        if (!isMounted) return;
        if (pendingOrders.length > 0) {
          const po = pendingOrders[0]!;
          setRegisterCouponId("");
          setDiscountId("");
          setActivePreOrderId(po.id);
          setActivePreOrderTotalPrice(po.totalPrice);
          setCart(
            po.items.map((item) => ({
              lineId: crypto.randomUUID(),
              menuId: item.menuId,
              menuName: item.menu?.name || "不明なメニュー",
              menuPrice: item.menu?.price || 0,
              quantity: item.quantity,
              // 2026-07-13: 事前オーダーで選択されたトッピングをスナップショットから復元する
              toppings: (item.toppings || []).map((t) => ({
                toppingId: t.id,
                toppingName: t.name,
                toppingPrice: t.price,
              })),
            }))
          );
          toast.success("事前オーダーの内容をカートにロードしました！", {
            style: {
              border: "3px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              fontWeight: "bold",
            },
          });
        } else {
          setActivePreOrderId(null);
          setRegisterCouponId("");
          setDiscountId("");
          setActivePreOrderTotalPrice(null);
        }
      } catch (err) {
        console.error("Failed to load pre-order items:", err);
        if (isMounted) {
          setActivePreOrderId(null);
          setRegisterCouponId("");
          setDiscountId("");
          setActivePreOrderTotalPrice(null);
        }
      }
    };

    loadPreOrder();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCustomer, circleId]);

  const orderInput: CreateOrderInput | null = activeCustomer ? {
    circleId, userId: activeCustomer.userId, peopleCount,
    items: cart.map((line) => ({ menuId: line.menuId, quantity: line.quantity, toppingIds: line.toppings.map((t) => t.toppingId) })),
    paymentMethod: paymentMethod || undefined,
    cashierId: getAuthInfo()?.userEmail ?? undefined,
    registerCouponId: activePreOrderId ? undefined : registerCouponId || undefined,
    discountId: activePreOrderId ? undefined : discountId || undefined,
  } : null;
  const submitOrder = useOrderSubmission(orderInput);
  const createOrder = useMutation({
    mutationFn: submitOrder,
    onSuccess: (data) => {
      const submittedSnapshot = submittingCustomerDisplaySnapshot.current;
      if (submittedSnapshot) setSubmittedCustomerDisplaySnapshot({ ...submittedSnapshot, displayState: "submitted", orderNumber: data.orderNumber });
      submittingCustomerDisplaySnapshot.current = null;
      toast.success(`注文完了！呼出番号: ${displayOrderNumber(data.orderNumber)}`);
      setCart([]);
      setPeopleCount(1);
      setActiveCustomer(null); // 会計完了後に顧客情報をクリア
      setActivePreOrderId(null);
      setRegisterCouponId("");
      setDiscountId("");
      setIsCartPanelOpen(false);
      // 支払い方法は次の会計で選び直す (単一方法は effect で再セットされる)
      setPaymentMethod("");
    },
    onError: (error: any) => {
      submittingCustomerDisplaySnapshot.current = null;
      toast.error(error.message || "注文に失敗しました");
    },
  });

  const claimOrder = useMutation({
    // 受取確定でもレジで選択した支払い方法を渡す (2026-07-14)。省略時はサーバが単一方法を補完する。
    // 2026-07-16: cashierId も通常注文と同様にログイン中スタッフの識別子を渡す
    // (以前は undefined を明示的に渡していたため、誰が受取確定を処理したかが記録されなかった)。
    mutationFn: async (input: { preOrderId: string; paymentMethod?: string; cashierId?: string }) => {
      return preOrderApi.claim(input.preOrderId, input.cashierId, input.paymentMethod);
    },
    onSuccess: (data) => {
      const submittedSnapshot = submittingCustomerDisplaySnapshot.current;
      if (submittedSnapshot) setSubmittedCustomerDisplaySnapshot({ ...submittedSnapshot, displayState: "submitted", orderNumber: data.orderNumber });
      submittingCustomerDisplaySnapshot.current = null;
      toast.success(`注文完了！ 呼出番号: ${displayOrderNumber(data.orderNumber)}`, {
        style: {
          border: "3px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          fontWeight: "bold",
        },
      });
      setCart([]);
      setPeopleCount(1);
      setActiveCustomer(null);
      setActivePreOrderId(null);
      setRegisterCouponId("");
      setDiscountId("");
      setIsCartPanelOpen(false);
      setPaymentMethod("");
    },
    onError: (error: any) => {
      submittingCustomerDisplaySnapshot.current = null;
      toast.error(error.message || "注文確定に失敗しました");
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
    setSubmittedCustomerDisplaySnapshot(null);
    setActivePreOrderId(null);
    setCart((prev) => addCartLine(prev, menu, chosen));
  };

  const removeLine = (lineId: string) => {
    setSubmittedCustomerDisplaySnapshot(null);
    setActivePreOrderId(null);
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  };

  const updateQuantity = (lineId: string, delta: number) => {
    setSubmittedCustomerDisplaySnapshot(null);
    setActivePreOrderId(null);
    setCart((prev) => updateCartQuantity(prev, lineId, delta));
  };

  const toggleTopping = (lineId: string, topping: Topping) => {
    setSubmittedCustomerDisplaySnapshot(null);
    setActivePreOrderId(null);
    setCart((prev) => toggleCartTopping(prev, lineId, topping));
  };

  // 2026-10-08: 店頭受取では事前注文に保存済みの合計を請求額として見せる。
  // 明細の現行価格を足すと事前注文の割引が消えて見え、画面表示とclaim後の記録額がずれる。
  // 事前注文の受取は保存済みの合計をそのまま使う。セット割引は事前注文の保存時に織り込み済みなので重ねない。
  const bundleResult = activePreOrderId ? { applied: [], totalDiscount: 0 } : cartBundleDiscount(cart, bundleRules);
  const getTotalPrice = () => {
    const subtotal = Math.max(0, checkoutTotal(cart, activePreOrderId ? activePreOrderTotalPrice : null) - bundleResult.totalDiscount);
    const selectedCoupon = activePreOrderId ? null : registerCoupons.find((option) => option.id === registerCouponId);
    const couponDiscount = selectedCoupon?.discountPercent ? Math.floor((subtotal * selectedCoupon.discountPercent) / 100) : 0;
    const selectedDiscount = activePreOrderId ? null : registerDiscounts.find((option) => option.id === discountId);
    const discountAmount = selectedDiscount?.kind === "percentage"
      ? Math.floor((subtotal * selectedDiscount.value) / 100)
      : selectedDiscount ? Math.min(subtotal, selectedDiscount.value) : 0;
    return Math.max(0, subtotal - couponDiscount - discountAmount);
  };
  const customerDisplaySnapshot = useMemo<RegisterDisplaySnapshot>(() => {
    const itemsSubtotal = checkoutTotal(cart, activePreOrderId ? activePreOrderTotalPrice : null);
    const subtotal = Math.max(0, itemsSubtotal - bundleResult.totalDiscount);
    const selectedCoupon = activePreOrderId ? null : registerCoupons.find((option) => option.id === registerCouponId);
    const couponDiscount = selectedCoupon?.discountPercent ? Math.floor((subtotal * selectedCoupon.discountPercent) / 100) : 0;
    const selectedDiscount = activePreOrderId ? null : registerDiscounts.find((option) => option.id === discountId);
    const discountAmount = selectedDiscount?.kind === "percentage"
      ? Math.floor((subtotal * selectedDiscount.value) / 100)
      : selectedDiscount ? Math.min(subtotal, selectedDiscount.value) : 0;
    const total = Math.max(0, subtotal - couponDiscount - discountAmount);
    return {
      circleName: (circle?.name ?? "").slice(0, 120),
      isPreOrder: !!activePreOrderId,
      displayState: "cart",
      orderNumber: null,
      items: cart.map((line) => ({
        name: line.menuName.slice(0, 120),
        quantity: line.quantity,
        // 2026-10-21: トッピング価格は内訳に別表示するため、単価にはベースメニュー価格だけを送る。
        unitPrice: line.menuPrice,
        subtotal: lineSubtotal(line),
        toppings: line.toppings.map((topping) => ({
          name: topping.toppingName.slice(0, 120),
          unitPrice: topping.toppingPrice,
        })),
      })),
      // 客側表示の「小計」は割引前の商品合計。セット割引も割引欄に含めて、小計−割引=合計を保つ。
      subtotal: itemsSubtotal,
      discount: Math.max(0, itemsSubtotal - total),
      total,
    };
  }, [cart, circle?.name, activePreOrderId, activePreOrderTotalPrice, registerCoupons, registerCouponId, registerDiscounts, discountId, bundleResult.totalDiscount]);
  const currentCustomerDisplaySnapshot = submittedCustomerDisplaySnapshot ?? customerDisplaySnapshot;

  useEffect(() => {
    if (!circleId || customerDisplayShare?.circleId === circleId) return;
    const saved = readRegisterDisplayConnection(circleId);
    if (!saved) return;
    if (saved.expiresAt <= Date.now()) {
      clearRegisterDisplayConnection(saved.circleId, saved.id);
      return;
    }
    // 2026-10-21: レジへ戻った時も稼働中のお客さま画面を再利用し、新規共有を作らない。
    setCustomerDisplayShare(saved);
    setCustomerDisplaySyncError(false);
  }, [circleId, customerDisplayShare?.circleId]);

  useEffect(() => {
    if (!customerDisplayShare || customerDisplayShare.circleId !== circleId) return;
    saveRegisterDisplayConnection({ ...customerDisplayShare, snapshot: currentCustomerDisplaySnapshot });
  }, [customerDisplayShare, currentCustomerDisplaySnapshot, circleId]);

  useEffect(() => {
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; ok: boolean }>).detail;
      if (detail?.sessionId === customerDisplayShare?.id) setCustomerDisplaySyncError(!detail.ok);
    };
    window.addEventListener("fesflow:register-display-sync", onSync);
    return () => window.removeEventListener("fesflow:register-display-sync", onSync);
  }, [customerDisplayShare?.id]);

  useEffect(() => {
    if (!customerDisplayShare || customerDisplayShare.circleId === circleId) return;
    // 2026-10-21: サークルを切り替えた時は旧共有を終了し、別サークルのカートを旧画面へ送らない。
    if (!customerDisplayShare.localOnly) {
      void orderApi.closeRegisterDisplay(customerDisplayShare.id).catch(() => undefined);
    }
    clearRegisterDisplayConnection(customerDisplayShare.circleId, customerDisplayShare.id);
    if (customerDisplayWindow.current && !customerDisplayWindow.current.closed) customerDisplayWindow.current.close();
    customerDisplayWindow.current = null;
    setCustomerDisplayShare(null);
    setCustomerDisplaySyncError(false);
    setIsCustomerDisplayModalOpen(false);
  }, [circleId, customerDisplayShare]);

  const getTotalCount = () => cartCount(cart);

  const handleSubmitOrder = async () => {
    if (createOrder.isPending || claimOrder.isPending) return;
    if (cart.length === 0) { toast.error("カートが空です"); return; }
    if (!activeCustomer) { toast.error("顧客が特定されていません。リストバンド/QRをスキャンしてください"); return; }
    if (effectivePayments.length > 1 && !paymentMethod) { toast.error("支払い方法を選択してください"); return; }

    // 2026-10-21: 送信時点の明細を保持し、カートが空になった後も注文番号と一緒に顧客画面へ残す。
    submittingCustomerDisplaySnapshot.current = currentCustomerDisplaySnapshot;

    // 2026-07-16: 「誰がレジをやったか」を記録するため、ログイン中スタッフの識別子を
    // cashierId として送る。メールアドレスが無いアカウント (旧形式の認証情報等) では
    // undefined のままとし、サーバ側で NULL として保存される。
    const cashierId = getAuthInfo()?.userEmail ?? undefined;

    if (activePreOrderId) {
      await claimOrder.mutateAsync({ preOrderId: activePreOrderId, paymentMethod: paymentMethod || undefined, cashierId });
      return;
    }

    if (orderInput) await createOrder.mutateAsync(orderInput);
  };

  const getOrCreateCustomerDisplaySession = async (snapshot: RegisterDisplaySnapshot) => {
    const storageKey = `fesflow-register-display:${circleId}`;
    let cached: RegisterDisplaySession | null = null;
    try {
      cached = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as RegisterDisplaySession | null;
    } catch {
      cached = null;
    }
    if (
      cached && cached.expiresAt > Date.now() + 30_000 && cached.id && cached.token &&
      Number.isSafeInteger(cached.revision) && cached.revision >= 1
    ) {
      const revision = cached.revision + 1;
      try {
        await orderApi.updateRegisterDisplay(cached.id, snapshot, revision);
        const renewed = { ...cached, revision };
        try { sessionStorage.setItem(storageKey, JSON.stringify(renewed)); } catch { /* 保存不可でも表示は続ける */ }
        return renewed;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "NOT_FOUND") throw error;
        // 2026-10-21: 期限切れ・終了済みの保存セッションは新しい共有へ置き換える。
        try { sessionStorage.removeItem(storageKey); } catch { /* 新規共有を優先する */ }
      }
    } else {
      try { sessionStorage.removeItem(storageKey); } catch { /* 新規共有を優先する */ }
    }

    const created = await orderApi.createRegisterDisplay(circleId, snapshot);
    try { sessionStorage.setItem(storageKey, JSON.stringify(created)); } catch { /* 保存不可でも表示は続ける */ }
    return created;
  };

  const openCustomerDisplay = async () => {
    // 2026-10-21: 先に選択UIを出し、レジ担当が明示した時だけ新しいタブを開く。
    setIsCustomerDisplayModalOpen(true);
    if (customerDisplayShare?.circleId === circleId) return;
    try {
      if (!circleId) throw new Error("サークルを特定できません");
      const session = await getOrCreateCustomerDisplaySession(currentCustomerDisplaySnapshot);
      const url = new URL(`/register-display/${session.id}`, window.location.origin);
      url.hash = session.token;
      const share: CustomerDisplayShare = { ...session, circleId, url: url.toString(), localOnly: false };
      setCustomerDisplayShare(share);
      setCustomerDisplaySyncError(false);
    } catch {
      // 2026-10-21: APIが使えない時も同じ端末の別窓は維持し、QR共有だけを未接続として示す。
      const localId = `local-${crypto.randomUUID()}`;
      const localUrl = new URL(`/register-display/${localId}`, window.location.origin).toString();
      const localShare: CustomerDisplayShare = {
        id: localId,
        token: "",
        revision: 0,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
        circleId,
        url: localUrl,
        localOnly: true,
      };
      setCustomerDisplayShare(localShare);
      setCustomerDisplaySyncError(true);
      toast.warning("別端末共有に接続できません。同じ端末の別ウィンドウ表示は利用できます。");
    }
  };

  const openCustomerDisplayWindow = () => {
    if (!customerDisplayShare) return;
    if (customerDisplayWindow.current && !customerDisplayWindow.current.closed) {
      customerDisplayWindow.current.focus();
      return;
    }
    const popup = window.open(customerDisplayShare.url, "_blank");
    if (!popup) {
      toast.error("画面を開けませんでした。ブラウザーのポップアップ設定をご確認ください。");
      return;
    }
    popup.opener = null;
    customerDisplayWindow.current = popup;
  };

  const copyCustomerDisplayUrl = async () => {
    if (!customerDisplayShare || customerDisplayShare.localOnly) return;
    try {
      await navigator.clipboard.writeText(customerDisplayShare.url);
      toast.success("共有URLをコピーしました");
    } catch {
      toast.error("URLをコピーできませんでした。QRコードをご利用ください。");
    }
  };

  const closeCustomerDisplayShare = async () => {
    if (!customerDisplayShare) return;
    try {
      if (!customerDisplayShare.localOnly) await orderApi.closeRegisterDisplay(customerDisplayShare.id);
      clearRegisterDisplayConnection(customerDisplayShare.circleId, customerDisplayShare.id);
      if (customerDisplayWindow.current && !customerDisplayWindow.current.closed) customerDisplayWindow.current.close();
      customerDisplayWindow.current = null;
      setCustomerDisplayShare(null);
      setCustomerDisplaySyncError(false);
      setIsCustomerDisplayModalOpen(false);
      toast.success("お客さま用画面を終了しました");
    } catch {
      toast.error("共有を終了できませんでした。通信状態を確認してください。");
    }
  };

  const clearCart = () => {
    setSubmittedCustomerDisplaySnapshot(null);
    const prev = cart;
    const previousCouponId = registerCouponId;
    const previousDiscountId = discountId;
    undoableAction({
      message: "カートをクリアしました",
      optimistic: () => {
        setCart([]);
        setActivePreOrderId(null);
        setRegisterCouponId("");
        setDiscountId("");
      },
      commit: () => {}, // クライアントのみ (サーバ反映なし)
      rollback: () => {
        setCart(prev);
        setRegisterCouponId(previousCouponId);
        setDiscountId(previousDiscountId);
      },
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
        onCustomerScanned={(userId, wristbandId, familyBandCount, allergies) => {
          setSubmittedCustomerDisplaySnapshot(null);
          setActiveCustomer({ userId, wristbandId, familyBandCount, allergies: parseJapaneseAllergens(allergies) });
        }}
      />
      <Modal
        isOpen={isCustomerDisplayModalOpen}
        title="[お客さま用カート表示]"
        subtitle="レジのカート内容を別画面へ表示します。共有画面は12時間で失効します。"
        onClose={() => setIsCustomerDisplayModalOpen(false)}
        maxWidth="md"
      >
        {customerDisplayShare?.localOnly ? (
          <div className="space-y-3">
            <p className="border-l-heavy border-error bg-muted p-3 text-sm font-bold">
              ネットワークに接続できないため、QR共有は停止中です。同じ端末で開いた別ウィンドウにはカートを表示できます。
            </p>
            <p className="break-all text-xs text-muted-foreground">{customerDisplayShare.url}</p>
            <Button onClick={openCustomerDisplayWindow} className="w-full border-thick border-border font-mono uppercase">
              <Monitor className="mr-2 h-4 w-4" />新しいタブで開く
            </Button>
          </div>
        ) : customerDisplayShare ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="border-thick border-border bg-white p-3">
              <QRCodeSVG value={customerDisplayShare.url} size={232} level="M" includeMargin />
            </div>
            <p className="text-sm font-bold">別のスマートフォンで読み取ると、カートの内容と金額が同期されます。</p>
            <p className="break-all text-xs text-muted-foreground">有効期限: {new Date(customerDisplayShare.expiresAt).toLocaleString("ja-JP")}</p>
            <Button onClick={openCustomerDisplayWindow} className="w-full border-thick border-border font-mono uppercase">
              <Monitor className="mr-2 h-4 w-4" />新しいタブで開く
            </Button>
            {customerDisplaySyncError && (
              <p role="status" className="w-full border-l-heavy border-error bg-muted p-3 text-left text-sm font-bold">
                別端末への同期を確認できません。同じ端末の別ウィンドウは引き続き同期します。
              </p>
            )}
            <Button variant="outline" onClick={copyCustomerDisplayUrl} className="w-full border-thick border-border font-mono uppercase">
              <Copy className="mr-2 h-4 w-4" />共有URLをコピー
            </Button>
          </div>
        ) : (
          <p className="text-sm">共有画面を準備しています…</p>
        )}
        {customerDisplayShare && (
          <Button variant="destructive" onClick={closeCustomerDisplayShare} className="mt-4 w-full font-mono uppercase">
            <X className="mr-2 h-4 w-4" />共有を終了
          </Button>
        )}
      </Modal>

      {/* 横幅に余裕がある画面 (xl+) はカートを右サイドバー固定、狭い画面は下部バー+スライドアップ */}
      <div className="xl:flex xl:items-start xl:gap-4">
        {/* ===== メニュー一覧 (メインカラム) ===== */}
        {/* 2026-10-16: モバイルの固定会計バーが商品ボタンを覆わないよう、バーと安全領域分の余白を予約する。 */}
        <div className="flex-1 min-w-0 p-3 pb-[calc(10rem+env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(11rem+env(safe-area-inset-bottom))] xl:pb-4">
          {/* ヘッダーバー */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-primary p-3 sm:p-4 text-primary-foreground border-thick border-border mb-4">
            <h1 className="font-mono text-lg sm:text-2xl font-black uppercase tracking-wider">[レジ]</h1>
            <div className="flex gap-2 flex-wrap">
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
              <Button
                variant="outline"
                onClick={openCustomerDisplay}
                className="h-10 bg-background text-xs uppercase tracking-wider text-foreground sm:h-12 sm:text-sm"
              >
                <Monitor className="mr-1 h-4 w-4 sm:mr-2 sm:h-5 sm:w-5" />
                [お客さま画面]
              </Button>
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

          {/* 2026-10-17: レジでは現在値と更新操作だけを短く示し、有効期限の説明を重ねない。 */}
          <section className="mb-4 border-b-thin border-border pb-3 font-mono">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="text-xs font-black uppercase tracking-wider">待ち時間</h2>
                {waitTimeReport ? (
                  <p role="status" className="text-xs text-success">約{waitTimeReport.minutes}分待ち · {waitTimeReport.minutesAgo}分前</p>
                ) : (
                  <p role="status" className="text-xs text-muted-foreground">未報告</p>
                )}
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <select
                  aria-label="待ち時間"
                  value={waitMinutes}
                  onChange={(event) => setWaitMinutes(event.target.value)}
                  className="h-10 min-w-0 flex-1 border-thick border-border bg-background px-3 text-xs sm:flex-initial"
                >
                  {Array.from({ length: 25 }, (_, index) => index * 10).map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes === 0 ? "待ち時間なし" : `${minutes}分待ち`}</option>
                  ))}
                </select>
                <Button
                  onClick={() => reportWaitTime.mutate()}
                  disabled={reportWaitTime.isPending}
                  className="h-10 shrink-0 whitespace-nowrap text-xs"
                >
                  {reportWaitTime.isPending ? "報告中…" : "報告"}
                </Button>
              </div>
            </div>
          </section>

          {/* 2026-10-17: 来場者の確認操作を一か所に集約し、状態説明は主ボタンへ置き換える。 */}
          {!activeCustomer ? (
            <div className="mb-4 flex flex-col items-center justify-center gap-4 border-thick border-border bg-muted/40 p-4 text-center font-mono sm:p-6">
              <h2 className="text-sm font-black uppercase tracking-wider">来場者を確認</h2>
              <Button
                onClick={() => setIsCustomerQrModalOpen(true)}
                className="flex h-auto min-h-20 w-full max-w-md flex-col gap-2 border-heavy px-8 py-5 text-base sm:w-auto"
              >
                <ScanLine className="h-12 w-12 sm:h-16 sm:w-16" />
                <span>QRを読み取る</span>
              </Button>
              <div className="flex items-center gap-2 w-full max-w-md">
                <Input
                  type="text"
                  aria-label="QRコードまたはリストバンドID"
                  placeholder="QR / リストバンドID"
                  className="h-11 min-w-0 flex-1 border-thick border-border bg-background font-mono text-xs focus-visible:ring-0"
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
                  className="h-11 shrink-0 border-thick border-border font-mono text-xs"
                >
                  {lookupCustomer.isPending ? "確認中…" : "検索"}
                </Button>
              </div>
            </div>
          ) : (
            <Card className="mb-4 bg-muted/40">
              <CardContent className="flex flex-col gap-3 p-3 font-mono sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-xs font-black text-success sm:text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 bg-success" />
                  来場者確認済み
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                  <Button
                    variant="outline"
                    onClick={() => setIsCustomerQrModalOpen(true)}
                    className="h-9 border-thick border-border font-mono text-xs"
                  >
                    来場者を変更
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="来場者を解除"
                    onClick={() => {
                      setActiveCustomer(null);
                      setActivePreOrderId(null);
                    }}
                    className="h-9 w-9 shrink-0 border-thick border-border"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 2026-10-22: 既存のモバイル注文は新規カートと分け、注文番号と支払状態を確認して会計する。 */}
          {activeCustomer && (
            <section aria-labelledby="unpaid-mobile-orders-title" className="mb-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b-thick border-border pb-2">
                <h2 id="unpaid-mobile-orders-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wider">
                  <Receipt className="h-4 w-4" /> 未会計のモバイル注文
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void unpaidMobileOrders.refetch()}
                  disabled={unpaidMobileOrders.isFetching}
                  className="h-9 border-thick border-border font-mono text-xs"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${unpaidMobileOrders.isFetching ? "animate-spin" : ""}`} />
                  {unpaidMobileOrders.isFetching ? "更新中…" : "一覧を更新"}
                </Button>
              </div>
              <p className="border-l-4 border-warning bg-warning/10 px-3 py-2 text-xs leading-relaxed">
                注文はすでに厨房へ登録されています。下の明細を会計してください。注文をカートに入れ直す必要はありません。
              </p>

              {unpaidMobileOrders.isError ? (
                <ErrorState error={unpaidMobileOrders.error} onRetry={() => void unpaidMobileOrders.refetch()} />
              ) : unpaidMobileOrders.isLoading ? (
                <div className="space-y-2" aria-label="未会計注文を読み込み中">
                  <Skeleton className="h-28 w-full" />
                </div>
              ) : (unpaidMobileOrders.data ?? []).length === 0 ? (
                <div className="border-thick border-border bg-background px-4 py-5 text-center text-sm text-muted-foreground">
                  この来場者の未会計モバイル注文はありません。
                </div>
              ) : (
                <div className="space-y-3">
                  {(unpaidMobileOrders.data ?? []).map((mobileOrder: OrderWithItems) => {
                    const savedMethod = mobilePaymentMethods[mobileOrder.id];
                    const preferredMethod = paymentMethod && effectivePayments.includes(paymentMethod) ? paymentMethod : "";
                    const selectedMethod = savedMethod && effectivePayments.includes(savedMethod)
                      ? savedMethod
                      : effectivePayments.length === 1 ? effectivePayments[0]! : preferredMethod;
                    const kitchenStatus = ({
                      pending: "受付済み",
                      preparing: "調理中",
                      ready: "受取可能",
                      completed: "受け取り待ち",
                      cancelled: "キャンセル",
                    } as Record<string, string>)[mobileOrder.status] ?? mobileOrder.status;
                    return (
                      <Card key={mobileOrder.id} className="rounded-none border-heavy shadow-none">
                        <CardHeader className="flex-row items-start justify-between gap-3 border-b-thin border-border bg-muted/20 p-3">
                          <div className="min-w-0 space-y-2">
                            <CardTitle className="text-base font-black">注文 #{displayOrderNumber(mobileOrder.orderNumber)}</CardTitle>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="border-thin border-warning bg-warning px-2 py-0.5 font-bold text-foreground">未会計</span>
                              <span className="border-thin border-border bg-background px-2 py-0.5 text-muted-foreground">厨房: {kitchenStatus}</span>
                              {mobileOrder.createdAt && (
                                <span className="text-muted-foreground">{new Date(mobileOrder.createdAt).toLocaleString("ja-JP")}</span>
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 text-lg font-black tabular-nums">¥{mobileOrder.totalPrice.toLocaleString()}</span>
                        </CardHeader>
                        <CardContent className="space-y-3 p-3">
                          <ul className="divide-y divide-border/30 text-sm">
                            {mobileOrder.items.map((item) => (
                              <li key={item.id} className="py-2">
                                <div className="flex justify-between gap-3">
                                  <span className="font-bold">{item.menuName}</span>
                                  <span className="shrink-0">× {item.quantity}</span>
                                </div>
                                {(item.toppings ?? []).length > 0 && (
                                  <p className="mt-1 text-xs text-muted-foreground">{(item.toppings ?? []).map((topping) => topping.toppingName).join("・")}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                          {effectivePayments.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                              <div className="space-y-1.5">
                                <Label htmlFor={`mobile-order-payment-${mobileOrder.id}`} className="font-mono text-xs">支払い方法</Label>
                                <select
                                  id={`mobile-order-payment-${mobileOrder.id}`}
                                  value={selectedMethod}
                                  onChange={(event) => setMobilePaymentMethods((current) => ({ ...current, [mobileOrder.id]: event.target.value }))}
                                  disabled={settleMobileOrder.isPending}
                                  className="h-11 w-full border-thick border-border bg-background px-3 text-sm font-bold"
                                >
                                  {effectivePayments.length > 1 && <option value="">支払い方法を選択</option>}
                                  {effectivePayments.map((method) => <option key={method} value={method}>{method}</option>)}
                                </select>
                              </div>
                              <Button
                                type="button"
                                onClick={() => settleMobileOrder.mutate({ orderId: mobileOrder.id, userId: activeCustomer.userId, paymentMethod: selectedMethod })}
                                disabled={!selectedMethod || effectivePayments.length === 0 || settleMobileOrder.isPending}
                                aria-label={`注文番号 ${displayOrderNumber(mobileOrder.orderNumber)} の会計を確定`}
                                className="h-11 border-thick border-border px-5 font-mono font-black"
                              >
                                {settleMobileOrder.isPending && settleMobileOrder.variables?.orderId === mobileOrder.id ? "会計中…" : "会計を確定"}
                              </Button>
                            </div>
                          ) : (
                            <p role="alert" className="border-thick border-warning bg-warning/10 p-3 text-xs font-bold">
                              利用できる支払い方法がありません。イベントとサークルの支払い方法設定を確認してください。
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* メニューグリッド */}
          <MenuCategoryFilter menus={menus ?? []} selectedCategory={selectedMenuCategory} onSelect={setSelectedMenuCategory} />
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
            {menus?.filter((menu) => selectedMenuCategory === null || menuCategoryKey(menu.category) === selectedMenuCategory).map((menu) => (
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

        {/* ===== デスクトップ用: 右サイドバーの常設カート (xl+) =====
            2026-07-16: overflow-hidden が無いと max-height はレイアウト計算に反映されず、
            中身 (CartBody) がコンテンツ丈まで際限なく伸びてしまい、画面下のフッター/確定ボタンが
            見えなくなる・スクロールもできない、という破綻の原因になっていた。
            overflow-hidden をここに付けることで初めて max-height が「実際の高さ上限」として働き、
            CartBody 側の flex-1 min-h-0 + 内側 overflow-y-auto が機能するようになる。 */}
        <aside className="hidden xl:flex xl:flex-col xl:sticky xl:top-4 xl:w-[380px] xl:shrink-0 xl:max-h-[calc(100vh-2rem)] overflow-hidden border-heavy border-border bg-background">
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b-thick border-border bg-primary text-primary-foreground">
            <h2 className="font-black text-lg uppercase font-mono">[カート]</h2>
            <span className="bg-background text-foreground px-2 py-0.5 text-xs font-black uppercase font-mono">
              {getTotalCount()}点
            </span>
          </div>
          <CartBody
            cart={cart}
            idPrefix="desktop"
            menuMap={menuMap}
            peopleCount={peopleCount}
            activeCustomer={activeCustomer}
            submitting={createOrder.isPending || claimOrder.isPending}
            onToggleTopping={toggleTopping}
            onUpdateQuantity={updateQuantity}
            onRemoveLine={removeLine}
            onSetPeople={setPeopleCount}
            onSubmit={handleSubmitOrder}
            onClear={clearCart}
            total={getTotalPrice()}
            bundleApplied={bundleResult.applied}
            bundleDiscountAmount={bundleResult.totalDiscount}
            isPreOrder={!!activePreOrderId}
            registerCoupons={registerCoupons}
            registerCouponId={registerCouponId}
            onSetRegisterCoupon={setRegisterCouponId}
            registerDiscounts={registerDiscounts}
            discountId={discountId}
            onSetDiscount={setDiscountId}
            paymentMethods={effectivePayments}
            paymentMethod={paymentMethod}
            onSetPayment={setPaymentMethod}
          />
        </aside>
      </div>

      {/* ===== モバイル/タブレット: 固定カートフッターバー (xl 未満のみ) ===== */}
      {cart.length > 0 && (
        <div className="xl:hidden fixed bottom-0 left-0 right-0 z-40 border-t-heavy border-border bg-primary pb-[env(safe-area-inset-bottom)] text-primary-foreground">
          <button
            onClick={() => setIsCartPanelOpen(true)}
            aria-label={`カートを開く。${getTotalCount()}点、合計${getTotalPrice().toLocaleString()}円`}
            className="flex w-full items-center justify-between gap-2 px-3 py-3 font-mono sm:px-4 sm:py-4"
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <span className="shrink-0 bg-background px-2 py-0.5 text-xs font-black uppercase text-foreground" aria-live="polite" aria-atomic="true">
                {getTotalCount()}点
              </span>
              <span className="truncate text-lg font-black tabular-nums sm:text-2xl">
                ¥{getTotalPrice().toLocaleString()}
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-1 border-thick border-primary-foreground px-2 py-2 text-xs font-black uppercase tracking-wider transition-all hover:bg-primary-foreground hover:text-primary sm:gap-2 sm:px-4 sm:text-sm">
              <ShoppingCart className="h-4 w-4" />
              <span className="sm:hidden">カート</span>
              <span className="hidden sm:inline">カートを見る</span>
            </span>
          </button>
        </div>
      )}

      {/* ===== モバイル/タブレット: カートパネル（スライドアップ, xl 未満のみ） ===== */}
      {/* 2026-10-21: ページ内の stacking context による背面化を避け、iOS の safe area 内に出す。 */}
      {isCartPanelOpen && createPortal((
        <div role="dialog" aria-modal="true" aria-labelledby="register-cart-title" className="viewport-safe-area xl:hidden fixed inset-0 z-[80] flex items-end overflow-y-auto sm:items-center justify-center">
          <div className="absolute inset-0 bg-foreground/60" onClick={() => setIsCartPanelOpen(false)} />
          {/* 2026-07-16: aside 側と同じ理由で overflow-hidden が必須。無いと画面が小さい端末で
              カート行が増えたときにシートが max-h-[90vh] を超えて伸び、確定ボタンが画面外に出て
              かつスクロールもできなくなる (UI破綻)。 */}
          <div className="relative max-h-full w-full min-w-0 max-w-lg overflow-hidden bg-background border-t-heavy sm:border-heavy border-border flex flex-col font-mono">
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b-thick border-border bg-primary text-primary-foreground">
              <h2 id="register-cart-title" className="min-w-0 break-words font-black text-lg uppercase">[カート確認]</h2>
              <button
                onClick={() => setIsCartPanelOpen(false)}
                aria-label="カートを閉じる"
                className="w-10 h-10 border-thin border-primary-foreground flex items-center justify-center hover:bg-primary-foreground hover:text-primary transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <CartBody
              cart={cart}
              idPrefix="mobile"
              menuMap={menuMap}
              peopleCount={peopleCount}
              activeCustomer={activeCustomer}
              submitting={createOrder.isPending || claimOrder.isPending}
              onToggleTopping={toggleTopping}
              onUpdateQuantity={updateQuantity}
              onRemoveLine={removeLine}
              onSetPeople={setPeopleCount}
              onSubmit={handleSubmitOrder}
              onClear={clearCart}
              total={getTotalPrice()}
              bundleApplied={bundleResult.applied}
              bundleDiscountAmount={bundleResult.totalDiscount}
              isPreOrder={!!activePreOrderId}
              registerCoupons={registerCoupons}
              registerCouponId={registerCouponId}
              onSetRegisterCoupon={setRegisterCouponId}
              registerDiscounts={registerDiscounts}
              discountId={discountId}
              onSetDiscount={setDiscountId}
              paymentMethods={effectivePayments}
              paymentMethod={paymentMethod}
              onSetPayment={setPaymentMethod}
            />
          </div>
        </div>
      ), document.body)}
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

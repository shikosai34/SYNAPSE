// coupon-storage.ts: 来場者端末に「このサークルでは合言葉検証済みのクーポンがある」ことを
// 覚えておくための localStorage ヘルパー (2026-09-16, issue #50)。
// CouponRedeem.tsx (合言葉検証) と Menu.tsx (事前オーダー送信) の両方から使う。
// あくまで UI 側の利便性(再入力なしで適用できる)のためのキャッシュであり、
// 実際の正当性は事前オーダー作成時にサーバ側 (checkCouponEligibility) が必ず再検証する。
//
// 2026-09-16 フィードバック対応: 1サークルにつき1枚しか覚えられず「クーポン一覧」が
// 実質1件しか出せなかったため、サークルごとに複数枚を配列で保持する形に変更した。
import type { CouponKind } from "./api";

export interface StoredCoupon {
  slug: string;
  passphrase: string;
  title: string;
  kind: CouponKind;
  discountAmount: number | null; // menu_discount のみ
  freeUnits: number | null; // free_topping のみ。null = 無制限
  // 適用対象。kind に応じてどちらかが使われる (カートにこのいずれかが入っている時だけ有効)。
  menuIds: string[];
  toppingIds: string[];
}

const keyFor = (circleId: string) => `visitor_coupons_${circleId}`;

/** 保存データが現行の StoredCoupon 形状を満たしているかを確認する。
 * menuIds/kind/toppingIds 追加など、過去のバージョンで保存された形が合わないものは弾く。 */
function isValidStoredCoupon(value: unknown): value is StoredCoupon {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<StoredCoupon>;
  return (
    typeof v.slug === "string" &&
    typeof v.passphrase === "string" &&
    typeof v.title === "string" &&
    (v.kind === "menu_discount" || v.kind === "free_topping") &&
    Array.isArray(v.menuIds) &&
    Array.isArray(v.toppingIds)
  );
}

/** そのサークルで合言葉検証済みのクーポン一覧を返す。形が合わないものは自己修復として除外する。 */
export function getCouponsForCircle(circleId: string): StoredCoupon[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(keyFor(circleId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // 単数形だった旧バージョン (~2026-09-16) のデータなど、配列でないものは丸ごと破棄する。
      localStorage.removeItem(keyFor(circleId));
      return [];
    }
    const valid = parsed.filter(isValidStoredCoupon);
    if (valid.length !== parsed.length) {
      // 一部だけ不正だった場合は、有効な分だけ残して書き戻しておく (自己修復)。
      localStorage.setItem(keyFor(circleId), JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

/** クーポンを追加保存する。同じ slug が既にあれば新しい内容で置き換える (再検証時の更新)。 */
export function storeCouponForCircle(circleId: string, coupon: StoredCoupon) {
  if (typeof window === "undefined") return;
  const next = [...getCouponsForCircle(circleId).filter((c) => c.slug !== coupon.slug), coupon];
  localStorage.setItem(keyFor(circleId), JSON.stringify(next));
}

/** 使用済みなどで不要になった1枚だけを取り除く (他の未使用クーポンは残す)。 */
export function removeCouponForCircle(circleId: string, slug: string) {
  if (typeof window === "undefined") return;
  const next = getCouponsForCircle(circleId).filter((c) => c.slug !== slug);
  if (next.length === 0) {
    localStorage.removeItem(keyFor(circleId));
  } else {
    localStorage.setItem(keyFor(circleId), JSON.stringify(next));
  }
}

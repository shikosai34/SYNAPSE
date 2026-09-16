// coupon.ts: サークル限定クーポン (issue #50) の検証・消費ロジック。
// pre_order.ts (実際の消費) と coupon.ts (来場者向け合言葉プレビュー /verify) の
// 両方から同じ検証条件を使うため、片方だけ直す変更漏れを防ぐためにここへ共通化する
// (utils/stock.ts の decrementStockWithGuard と同じ考え方)。
import { and, eq, inArray, sql } from "drizzle-orm";
import { coupon, couponMenu, couponTopping, couponRedemption, type DB } from "@fesflow/db";
import { apiError } from "../http-error";

export type CouponRow = typeof coupon.$inferSelect;

/**
 * スラッグ+合言葉からクーポンを検証する (消費はしない、プレビュー/事前チェック用)。
 * circleId を渡した場合はクーポンの所属サークルと一致するかも検証する
 * (pre_order.ts でクロスサークルの取り違えを防ぐため。/verify は circleId 未確定なので渡さない)。
 * 失敗時は apiError (BAD_REQUEST/NOT_FOUND) を投げる。
 */
export async function checkCouponEligibility(
  db: DB,
  params: { slug: string; passphrase: string; eventUserId: string; circleId?: string }
): Promise<CouponRow> {
  const rows = await db.select().from(coupon).where(eq(coupon.slug, params.slug));
  if (rows.length === 0) {
    apiError("NOT_FOUND", "クーポンが見つかりません");
  }
  const cp = rows[0]!;

  if (params.circleId && cp.circleId !== params.circleId) {
    apiError("BAD_REQUEST", "このクーポンは指定サークルのものではありません");
  }
  if (cp.status !== "active") {
    apiError("BAD_REQUEST", "このクーポンは現在利用できません");
  }
  if (cp.expiresAt && cp.expiresAt.getTime() < Date.now()) {
    apiError("BAD_REQUEST", "このクーポンの有効期限が切れています");
  }
  // 小規模イベント運用の割り切りとして平文比較で開始する (issue #50 スコープ外: ハッシュ化)
  if (cp.passphrase !== params.passphrase) {
    apiError("BAD_REQUEST", "合言葉が違います");
  }
  // maxRedemptions が null なら無制限 (2026-09-16 フィードバック対応)。
  if (cp.maxRedemptions !== null && cp.redeemedCount >= cp.maxRedemptions) {
    apiError("BAD_REQUEST", "このクーポンは使用上限に達しました");
  }

  const existing = await db
    .select()
    .from(couponRedemption)
    .where(
      and(
        eq(couponRedemption.couponId, cp.id),
        eq(couponRedemption.eventUserId, params.eventUserId)
      )
    );
  if (existing.length > 0) {
    apiError("BAD_REQUEST", "このクーポンは既に使用済みです");
  }

  return cp;
}

/** クーポンの適用対象メニューID一覧を返す (2026-09-16 フィードバック対応: 全体ではなく特定メニュー限定)。 */
export async function getCouponMenuIds(db: DB, couponId: string): Promise<string[]> {
  const rows = await db.select({ menuId: couponMenu.menuId }).from(couponMenu).where(eq(couponMenu.couponId, couponId));
  return rows.map((r) => r.menuId);
}

/** 複数クーポンの対象メニューIDをまとめて引く (一覧表示用)。couponId → menuId[] の Map を返す。 */
export async function getCouponMenuIdsBulk(db: DB, couponIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (couponIds.length === 0) return map;
  const rows = await db
    .select({ couponId: couponMenu.couponId, menuId: couponMenu.menuId })
    .from(couponMenu)
    .where(inArray(couponMenu.couponId, couponIds));
  for (const row of rows) {
    const list = map.get(row.couponId) ?? [];
    list.push(row.menuId);
    map.set(row.couponId, list);
  }
  return map;
}

/** クーポンの適用対象トッピングID一覧を返す (2026-09-16, kind=free_topping 用)。 */
export async function getCouponToppingIds(db: DB, couponId: string): Promise<string[]> {
  const rows = await db
    .select({ toppingId: couponTopping.toppingId })
    .from(couponTopping)
    .where(eq(couponTopping.couponId, couponId));
  return rows.map((r) => r.toppingId);
}

/** 複数クーポンの対象トッピングIDをまとめて引く (一覧表示用)。couponId → toppingId[] の Map を返す。 */
export async function getCouponToppingIdsBulk(db: DB, couponIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (couponIds.length === 0) return map;
  const rows = await db
    .select({ couponId: couponTopping.couponId, toppingId: couponTopping.toppingId })
    .from(couponTopping)
    .where(inArray(couponTopping.couponId, couponIds));
  for (const row of rows) {
    const list = map.get(row.couponId) ?? [];
    list.push(row.toppingId);
    map.set(row.couponId, list);
  }
  return map;
}

/** pre_order.ts の itemList のうち、割引計算に必要な最小限の形。 */
export interface CouponItemLine {
  menuId: string;
  quantity: number;
  subtotal: number; // (メニュー単価 + トッピング合計) × quantity
  toppings: { id: string; price: number }[];
}

/**
 * クーポンの割引額を計算する (消費はしない純粋関数)。
 * - menu_discount: targetIds は対象メニューID。対象メニューの小計合計と discountAmount の
 *   小さい方を返す (小計を超えて引かない)。
 * - free_topping: targetIds は対象トッピングID。カート内の対象トッピングを「個」単位に展開し
 *   (数量分だけ複製)、単価の高い順に freeUnits 個 (null なら全部) を無料にした合計を返す。
 * どちらも対象が1件もカートに無ければ 0 を返す。呼び出し側は 0 なら「消費せず拒否」すること。
 */
export function computeCouponDiscount(
  cp: Pick<CouponRow, "kind" | "discountAmount" | "freeUnits">,
  targetIds: string[],
  items: CouponItemLine[]
): number {
  const targetSet = new Set(targetIds);

  if (cp.kind === "free_topping") {
    const unitPrices: number[] = [];
    for (const item of items) {
      for (const t of item.toppings) {
        if (targetSet.has(t.id)) {
          for (let i = 0; i < item.quantity; i++) unitPrices.push(t.price);
        }
      }
    }
    unitPrices.sort((a, b) => b - a);
    const freeCount = cp.freeUnits ?? unitPrices.length;
    return unitPrices.slice(0, Math.max(0, freeCount)).reduce((sum, p) => sum + p, 0);
  }

  // menu_discount (既定)
  const eligibleSubtotal = items
    .filter((item) => targetSet.has(item.menuId))
    .reduce((sum, item) => sum + item.subtotal, 0);
  return Math.min(cp.discountAmount ?? 0, eligibleSubtotal);
}

/**
 * クーポンの使用回数をガード付きUPDATEでアトミックに+1する (在庫減算と同じレースコンディション対策)。
 * checkCouponEligibility で上限未達を確認済みでも、その後に競合した別リクエストが
 * 先に枠を使い切る可能性があるため、実際の消費はこの条件付きUPDATEで最終判定する。
 * 呼び出し側は成功後、失敗時に呼べるよう返り値の rollback を保持しておくこと
 * (pre_order.ts で後続の preOrder 作成が失敗した場合のベストエフォート補償用)。
 */
export async function redeemCouponWithGuard(db: DB, couponId: string): Promise<{ rollback: () => Promise<void> }> {
  const result = await db
    .update(coupon)
    .set({ redeemedCount: sql`${coupon.redeemedCount} + 1` })
    .where(
      and(
        eq(coupon.id, couponId),
        // maxRedemptions が null (無制限) なら常に通す。SQLite は NULL との比較演算子が
        // NULL(=false扱い) になるため、単純な `<` だけだと無制限クーポンが誤って
        // 「上限到達」扱いされてしまう。
        sql`(${coupon.maxRedemptions} IS NULL OR ${coupon.redeemedCount} < ${coupon.maxRedemptions})`
      )
    )
    .returning({ redeemedCount: coupon.redeemedCount });

  if (result.length === 0) {
    apiError("BAD_REQUEST", "このクーポンは使用上限に達しました");
  }

  const rollback = async () => {
    try {
      await db
        .update(coupon)
        .set({ redeemedCount: sql`max(${coupon.redeemedCount} - 1, 0)` })
        .where(eq(coupon.id, couponId));
    } catch (restoreError) {
      console.error("Coupon redemption rollback error:", restoreError);
    }
  };

  return { rollback };
}

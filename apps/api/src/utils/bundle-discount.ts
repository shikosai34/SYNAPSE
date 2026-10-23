import { and, asc, eq, inArray } from "drizzle-orm";
import { bundleDiscount, bundleDiscountMenu, type DB } from "@fesflow/db";
import type { BundleKind, BundleRule } from "@fesflow/config/bundle-discount";

// 2026-10-23: 注文確定と来場者向けの一覧で同じ「有効なセット割引」の取り方を使う。
// 並びは作成順。複数のセットが同じメニューを含むとき、先に作ったものが優先して商品を使う
// (calculateBundleDiscounts の規則)。id で順序を固定し、同時刻作成でも結果が揺れないようにする。
export async function loadActiveBundleRules(db: DB, circleId: string): Promise<BundleRule[]> {
  const bundles = await db.select().from(bundleDiscount)
    .where(and(eq(bundleDiscount.circleId, circleId), eq(bundleDiscount.status, "active")))
    .orderBy(asc(bundleDiscount.createdAt), asc(bundleDiscount.id));
  return attachMenuIds(db, bundles);
}

export async function attachMenuIds<T extends { id: string; title: string; kind: string; bundleSize: number; value: number }>(
  db: DB,
  bundles: T[],
): Promise<(T & BundleRule)[]> {
  if (bundles.length === 0) return [];
  const links = await db.select().from(bundleDiscountMenu)
    .where(inArray(bundleDiscountMenu.bundleId, bundles.map((item) => item.id)));
  return bundles.map((item) => ({
    ...item,
    // DB の CHECK 制約で kind は BundleKind のいずれかに限られる。
    kind: item.kind as BundleKind,
    menuIds: links.filter((link) => link.bundleId === item.id).map((link) => link.menuId),
  }));
}

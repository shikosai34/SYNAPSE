import { and, eq, gte, sql } from "drizzle-orm";
import { menu, topping, type DB } from "@fesflow/db";
import { apiError } from "../http-error";

// 2026-07-16: order.ts (レジ直販 POST /) と pre_order.ts (事前オーダー受取確定 claim) は
// どちらも「ガード付きUPDATEでの在庫減算 → 0で soldOut → 失敗時のベストエフォート補償」という
// 同一の在庫減算処理を持っていた。並行作業の競合を避けるためこれまで共通化を見送っていたが、
// 片方だけ直す変更漏れ事故のリスクが高いためここに切り出す。
//
// 意味論 (order.ts / pre_order.ts と完全に同一。挙動は1ミリも変えない):
// - stockQuantity === 0 は「無制限/未管理」を意味し、チェック・減算をスキップする。
//   そのため stockNeeded / toppingStockNeeded には stockQuantity > 0 の対象のみを
//   積んでおくこと (集計自体は呼び出し側の責務のまま。order.ts は事前のスナップショット
//   読み取りチェックを持つが pre_order.ts の claim は持たない、という差異があるため
//   集計ロジックはここに寄せず呼び出し側に残している)。
// - D1 は対話的トランザクション非対応 (過去に db.transaction() で BEGIN が拒否され
//   全注文が500になったリグレッションあり。order.ts 参照)。そのため常に逐次実行＋
//   ガード付きUPDATE (`gte(stockQuantity, needed)` が0行なら在庫不足) ＋
//   ベストエフォート補償で実装する。完全なロールバック保証はない (既知の制約 M-5)。
// - 補償の非対称性: メニューは stockNeeded の全量を戻す一方、トッピングは実際に
//   減算できた分 (decrementedToppings) だけを戻す。トッピングは減算ループの途中で
//   失敗し得るため、まだ減算していない分まで加算してしまわないようにするための実装で
//   あり、意図した非対称性のため維持する。

/** 在庫不足エラーメッセージ用に、ID からメニュー/トッピング名を引く関数群。 */
export type StockNameLookup = {
  getMenuName: (menuId: string) => string | undefined;
  getToppingName: (toppingId: string) => string | undefined;
};

export type StockDecrementHandle = {
  /**
   * 減算済みの在庫をベストエフォートで戻す (0件でも安全に呼べる)。
   * decrementStockWithGuard 自身がトッピング減算の失敗時に内部で呼ぶ他、
   * 呼び出し側は後続処理 (order/orderItem insert 等) が失敗した場合に
   * 再度これを呼んで補償すること (order.ts / pre_order.ts の外側 try/catch を参照)。
   */
  restoreStockBestEffort: () => Promise<void>;
};

/**
 * メニュー/トッピングの在庫をガード付きUPDATEで減算する共通処理。
 * 在庫不足 (ガード付きUPDATEが0行) の場合は、その時点までに減算済みの在庫を
 * ベストエフォートで戻したうえで apiError(BAD_REQUEST) を throw する
 * (apiError は never を返すため、呼び出し側で追加の return は不要)。
 *
 * 成功時は restoreStockBestEffort を含むハンドルを返す。呼び出し側で在庫減算より
 * 後段の処理 (注文レコード作成等) が失敗した場合、このハンドルの restoreStockBestEffort
 * を呼んで補償すること。
 */
export async function decrementStockWithGuard(
  db: DB,
  stockNeeded: Map<string, number>,
  toppingStockNeeded: Map<string, number>,
  names: StockNameLookup
): Promise<StockDecrementHandle> {
  // トッピングは実際に減算できた分だけを補償対象として記録する (非対称性、上記コメント参照)。
  const decrementedToppings: Array<[string, number]> = [];

  const restoreStockBestEffort = async () => {
    for (const [menuId, neededQty] of stockNeeded.entries()) {
      try {
        await db
          .update(menu)
          .set({ stockQuantity: sql`${menu.stockQuantity} + ${neededQty}` })
          .where(eq(menu.id, menuId));
        await db
          .update(menu)
          .set({ soldOut: false })
          .where(and(eq(menu.id, menuId), gte(menu.stockQuantity, 1)));
      } catch (restoreError) {
        console.error("Stock restore error:", restoreError);
      }
    }
    for (const [toppingId, neededQty] of decrementedToppings) {
      try {
        await db
          .update(topping)
          .set({ stockQuantity: sql`${topping.stockQuantity} + ${neededQty}` })
          .where(eq(topping.id, toppingId));
        await db
          .update(topping)
          .set({ soldOut: false })
          .where(and(eq(topping.id, toppingId), gte(topping.stockQuantity, 1)));
      } catch (restoreError) {
        console.error("Topping stock restore error:", restoreError);
      }
    }
  };

  // メニュー在庫の減算 (ガード付きUPDATE)。
  for (const [menuId, neededQty] of stockNeeded.entries()) {
    const result = await db
      .update(menu)
      .set({ stockQuantity: sql`${menu.stockQuantity} - ${neededQty}` })
      .where(and(eq(menu.id, menuId), gte(menu.stockQuantity, neededQty)))
      .returning({ stockQuantity: menu.stockQuantity });

    if (result.length === 0) {
      apiError("BAD_REQUEST", `${names.getMenuName(menuId) ?? menuId}の在庫が不足しています`);
    }

    // 減算の結果 在庫が0になった場合は soldOut も併せてセットする
    if (result[0]!.stockQuantity <= 0) {
      await db.update(menu).set({ soldOut: true }).where(eq(menu.id, menuId));
    }
  }

  // トッピング在庫の減算 (メニュー在庫の減算後)。ここでの不足(競合)時は
  // 既に減らしたメニュー在庫も戻してから中断する。
  for (const [toppingId, neededQty] of toppingStockNeeded.entries()) {
    const result = await db
      .update(topping)
      .set({ stockQuantity: sql`${topping.stockQuantity} - ${neededQty}` })
      .where(and(eq(topping.id, toppingId), gte(topping.stockQuantity, neededQty)))
      .returning({ stockQuantity: topping.stockQuantity });

    if (result.length === 0) {
      await restoreStockBestEffort();
      apiError("BAD_REQUEST", `${names.getToppingName(toppingId) ?? toppingId}の在庫が不足しています`);
    }
    decrementedToppings.push([toppingId, neededQty]);
    if (result[0]!.stockQuantity <= 0) {
      await db.update(topping).set({ soldOut: true }).where(eq(topping.id, toppingId));
    }
  }

  return { restoreStockBestEffort };
}

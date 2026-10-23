import { describe, expect, it } from "bun:test";
import { calculateBundleDiscounts, type BundleRule } from "@fesflow/config/bundle-discount";

const takoyaki3: BundleRule = { id: "b1", title: "3個セット", kind: "set_price", bundleSize: 3, value: 1000, menuIds: ["a", "b"] };

describe("bundle price discount", () => {
  it("discounts the difference between regular and set price", () => {
    const result = calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 3 }], [takoyaki3]);
    expect(result.totalDiscount).toBe(200);
    expect(result.applied).toEqual([{ id: "b1", title: "3個セット", sets: 1, discountApplied: 200 }]);
  });

  it("combines different target menus and merges rows that differ only by toppings", () => {
    const result = calculateBundleDiscounts([
      { menuId: "a", unitPrice: 400, quantity: 1 },
      { menuId: "a", unitPrice: 400, quantity: 1 },
      { menuId: "b", unitPrice: 400, quantity: 1 },
    ], [takoyaki3]);
    expect(result.totalDiscount).toBe(200);
  });

  it("forms as many sets as possible and leaves the remainder at regular price", () => {
    const result = calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 7 }], [takoyaki3]);
    expect(result.applied[0]?.sets).toBe(2);
    expect(result.totalDiscount).toBe(400);
  });

  it("does nothing below the set size or for other menus", () => {
    expect(calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 2 }], [takoyaki3]).totalDiscount).toBe(0);
    expect(calculateBundleDiscounts([{ menuId: "z", unitPrice: 400, quantity: 5 }], [takoyaki3]).totalDiscount).toBe(0);
  });

  it("puts the cheapest items into the set when prices are mixed", () => {
    const result = calculateBundleDiscounts([
      { menuId: "a", unitPrice: 300, quantity: 2 },
      { menuId: "b", unitPrice: 600, quantity: 2 },
    ], [takoyaki3]);
    // 4個中1組: 安い 300+300+600=1200 → 200円引き (高い順なら 1500 → 500円引きになる)
    expect(result.totalDiscount).toBe(200);
  });

  it("never raises the price when the set price is not a bargain", () => {
    const result = calculateBundleDiscounts([{ menuId: "a", unitPrice: 300, quantity: 3 }], [takoyaki3]);
    expect(result.totalDiscount).toBe(0);
    expect(result.applied).toEqual([]);
  });

  it("uses each item in only one set across overlapping rules, in rule order", () => {
    const second: BundleRule = { id: "b2", title: "2個セット", kind: "set_price", bundleSize: 2, value: 600, menuIds: ["a"] };
    const result = calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 5 }], [takoyaki3, second]);
    expect(result.applied.map((item) => [item.id, item.sets, item.discountApplied])).toEqual([["b1", 1, 200], ["b2", 1, 200]]);
  });

  it("handles huge quantities without expanding them", () => {
    const result = calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 3_000_000 }], [takoyaki3]);
    expect(result.applied[0]?.sets).toBe(1_000_000);
  });

  it("amount_off takes a fixed yen amount per set, capped at the set's regular price", () => {
    const rule: BundleRule = { id: "o", title: "3個で100円引き", kind: "amount_off", bundleSize: 3, value: 100, menuIds: ["a"] };
    const result = calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 7 }], [rule]);
    expect(result.applied[0]).toMatchObject({ sets: 2, discountApplied: 200 });
    const tiny = calculateBundleDiscounts([{ menuId: "a", unitPrice: 10, quantity: 3 }], [{ ...rule, value: 500 }]);
    expect(tiny.totalDiscount).toBe(30);
  });

  it("free_cheapest makes the cheapest item of each set free", () => {
    const rule: BundleRule = { id: "f", title: "3個で1個無料", kind: "free_cheapest", bundleSize: 3, value: 0, menuIds: ["a", "b"] };
    expect(calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 3 }], [rule]).totalDiscount).toBe(400);
    expect(calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 6 }], [rule]).totalDiscount).toBe(800);
    // 安い順に 300,300,600,600 → 1組目(300,300,600)の先頭 300 が無料
    const mixed = calculateBundleDiscounts([
      { menuId: "a", unitPrice: 300, quantity: 2 },
      { menuId: "b", unitPrice: 600, quantity: 2 },
    ], [rule]);
    expect(mixed.totalDiscount).toBe(300);
    // 6個 = 300,300,300,300,600,600 → 先頭は 1個目と4個目の 300 が2つ
    const two = calculateBundleDiscounts([
      { menuId: "a", unitPrice: 300, quantity: 4 },
      { menuId: "b", unitPrice: 600, quantity: 2 },
    ], [rule]);
    expect(two.totalDiscount).toBe(600);
  });

  it("percent_off discounts the whole cart including toppings once the count is reached", () => {
    const rule: BundleRule = { id: "p", title: "3個で10%引き", kind: "percent_off", bundleSize: 3, value: 10, menuIds: ["a"] };
    const lines = [
      { menuId: "a", unitPrice: 400, quantity: 3, toppingPrice: 50 },
      { menuId: "z", unitPrice: 150, quantity: 1 },
    ];
    // (1200+150 トッピング + 150) = 1500 の10%
    expect(calculateBundleDiscounts(lines, [rule]).totalDiscount).toBe(150);
    expect(calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 2 }], [rule]).totalDiscount).toBe(0);
  });

  it("applies percent_off last, on the amount left after the other discounts", () => {
    const percent: BundleRule = { id: "p", title: "10%", kind: "percent_off", bundleSize: 2, value: 10, menuIds: ["z"] };
    const result = calculateBundleDiscounts([
      { menuId: "a", unitPrice: 400, quantity: 3 },
      { menuId: "z", unitPrice: 100, quantity: 2 },
    ], [percent, takoyaki3]);
    // セット割引200 → (1400-200) の10% = 120。並びが percent 先でも後に処理される
    expect(result.applied.map((item) => [item.id, item.discountApplied])).toEqual([["b1", 200], ["p", 120]]);
  });

  it("ignores rules whose value does not fit their kind", () => {
    const bad: BundleRule = { id: "x", title: "x", kind: "percent_off", bundleSize: 2, value: 150, menuIds: ["a"] };
    expect(calculateBundleDiscounts([{ menuId: "a", unitPrice: 400, quantity: 2 }], [bad]).totalDiscount).toBe(0);
  });
});

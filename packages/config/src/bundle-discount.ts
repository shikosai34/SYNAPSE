// 2026-10-23: 「対象メニューをN個以上」を条件にした自動割引。
// 画面のプレビューと注文確定 (API) で同じ規則を使うため共有する。
export const BUNDLE_KINDS = ["set_price", "amount_off", "free_cheapest", "percent_off"] as const;
export type BundleKind = (typeof BUNDLE_KINDS)[number];

export interface BundleRule {
  id: string;
  title: string;
  kind: BundleKind;
  /** 条件の個数。set_price/amount_off/free_cheapest では1セットの個数 */
  bundleSize: number;
  /**
   * kind ごとの意味:
   *   set_price     : 1セットの価格 (円)
   *   amount_off    : 1セットあたりの割引額 (円)
   *   free_cheapest : 未使用 (0)
   *   percent_off   : 割引率 (1〜100)
   */
  value: number;
  /** 対象メニューID。複数メニューの合算で条件を満たせる */
  menuIds: string[];
}

export interface BundleLine {
  menuId: string;
  /** メニュー単価。個数の対象・セット価格の比較にはこれだけを使う */
  unitPrice: number;
  quantity: number;
  /** 1個あたりのトッピング合計。percent_off の「注文全体」の金額にだけ含める */
  toppingPrice?: number;
}

export interface AppliedBundle {
  id: string;
  title: string;
  sets: number;
  discountApplied: number;
}

export interface BundleDiscountResult {
  applied: AppliedBundle[];
  totalDiscount: number;
}

/** 管理画面・一覧用の説明文 */
export function describeBundleRule(rule: Pick<BundleRule, "kind" | "bundleSize" | "value">): string {
  switch (rule.kind) {
    case "set_price": return `${rule.bundleSize}個で¥${rule.value.toLocaleString()}`;
    case "amount_off": return `${rule.bundleSize}個ごとに¥${rule.value.toLocaleString()}引き`;
    case "free_cheapest": return `${rule.bundleSize}個ごとに1個分(一番安いもの)無料`;
    case "percent_off": return `${rule.bundleSize}個以上で全体から${rule.value}%引き`;
  }
}

/** kind ごとの value の妥当性。API の入力検証と画面のフォーム検証で共有する */
export function isValidBundleValue(kind: BundleKind, value: number): boolean {
  if (!Number.isInteger(value)) return false;
  switch (kind) {
    case "set_price": return value >= 0;
    case "amount_off": return value > 0;
    case "free_cheapest": return value === 0;
    case "percent_off": return value >= 1 && value <= 100;
  }
}

type PoolEntry = { unitPrice: number; quantity: number };

/**
 * 自動割引を当てはめ、割引額 (円) を返す。
 *
 * - set_price / amount_off / free_cheapest は「セット」単位。何組でも成立し (6個なら3個セット2組)、
 *   端数の個数は通常価格のまま。percent_off は条件を満たせば注文全体に1回だけかかる。
 * - 1つの商品は1つのセットにしか使わない。複数の割引が同じメニューを含む場合は
 *   rules の並び順 (呼び出し側で作成順にする) で先に消費する。
 * - percent_off は他の割引を引いた後の金額 (トッピング込み) に対してかけるため、
 *   rules の並びにかかわらず最後に処理する。個数は他の割引が消費した後の残りで数え、自身は消費しない。
 * - セットは対象のうち安い商品から組む。価格が混在してもサークルの売上を割り込みにくい側に倒し、
 *   結果を決定的にするため。free_cheapest は各セットの一番安い1個 (=各セットの先頭) が無料になる。
 * - 数量の展開はせず価格ごとの塊で数えるので、数量が大きくても計算量は変わらない。
 * - set_price のセット価格が通常価格以上のときは 0 円引き (値上げにはしない)。
 */
export function calculateBundleDiscounts(lines: BundleLine[], rules: BundleRule[]): BundleDiscountResult {
  // 同じメニューの行 (トッピング違い) は合算して残数を管理する。
  const remaining = new Map<string, PoolEntry>();
  let grossTotal = 0;
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    grossTotal += (line.unitPrice + (line.toppingPrice ?? 0)) * line.quantity;
    const entry = remaining.get(line.menuId);
    if (entry) entry.quantity += line.quantity;
    else remaining.set(line.menuId, { unitPrice: line.unitPrice, quantity: line.quantity });
  }

  const applied: AppliedBundle[] = [];
  let discounted = 0;
  const ordered = [...rules.filter((rule) => rule.kind !== "percent_off"), ...rules.filter((rule) => rule.kind === "percent_off")];
  for (const rule of ordered) {
    if (rule.bundleSize < 2 || !isValidBundleValue(rule.kind, rule.value)) continue;
    const eligible = rule.menuIds
      .map((menuId) => remaining.get(menuId))
      .filter((entry): entry is PoolEntry => !!entry && entry.quantity > 0)
      .sort((a, b) => a.unitPrice - b.unitPrice);
    const eligibleCount = eligible.reduce((sum, entry) => sum + entry.quantity, 0);

    if (rule.kind === "percent_off") {
      if (eligibleCount < rule.bundleSize) continue;
      const discountApplied = Math.floor(((grossTotal - discounted) * rule.value) / 100);
      if (discountApplied > 0) {
        applied.push({ id: rule.id, title: rule.title, sets: 1, discountApplied });
        discounted += discountApplied;
      }
      continue;
    }

    const sets = Math.floor(eligibleCount / rule.bundleSize);
    if (sets <= 0) continue;

    let need = sets * rule.bundleSize;
    let position = 0; // 安い順に並べた何個目まで進んだか
    let regularTotal = 0;
    let freeTotal = 0;
    for (const entry of eligible) {
      if (need <= 0) break;
      const take = Math.min(entry.quantity, need);
      regularTotal += take * entry.unitPrice;
      // [position, position+take) に含まれる「セット先頭 (サイズの倍数番目)」の数だけ一番安い1個が無料になる。
      freeTotal += (Math.ceil((position + take) / rule.bundleSize) - Math.ceil(position / rule.bundleSize)) * entry.unitPrice;
      position += take;
      entry.quantity -= take;
      need -= take;
    }
    const discountApplied = rule.kind === "set_price"
      ? Math.max(0, regularTotal - sets * rule.value)
      : rule.kind === "amount_off"
        ? Math.min(regularTotal, sets * rule.value)
        : freeTotal;
    if (discountApplied > 0) {
      applied.push({ id: rule.id, title: rule.title, sets, discountApplied });
      discounted += discountApplied;
    }
  }

  return { applied, totalDiscount: discounted };
}

type WizardMenu = {
  toppingWizardEnabled: boolean;
  toppingCategoryMinimums: string;
  toppingCategoryMaximums?: string;
};

type CategorizedTopping = { category: string | null };

export type ToppingSelectionViolation = {
  category: string;
  selected: number;
  minimum: number;
  maximum: number | null;
  reason: "minimum" | "maximum";
};

function parseCategoryCounts(raw: string | undefined, allowZero: boolean): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isInteger(entry[1]) && (allowZero ? entry[1] >= 0 : entry[1] > 0),
    ));
  } catch {
    // 破損した古い設定は未設定扱いにし、注文受付を止めない。
    return {};
  }
}

// 2026-10-08: 必須数と上限数を同じ判定にし、UIと注文APIで選択条件を揃える。
export function validateToppingCategorySelection(
  menu: WizardMenu,
  selectedToppings: CategorizedTopping[],
  availableToppings: CategorizedTopping[],
): ToppingSelectionViolation | null {
  if (!menu.toppingWizardEnabled) return null;

  const minimums = parseCategoryCounts(menu.toppingCategoryMinimums, true);
  const maximums = parseCategoryCounts(menu.toppingCategoryMaximums, false);
  const categories = new Set([...Object.keys(minimums), ...Object.keys(maximums)]);

  for (const category of categories) {
    // 2026-10-07 Issue #111: メニューから選択肢を外した後も、その設定で注文を永久に止めない。
    if (!availableToppings.some((topping) => (topping.category?.trim() ?? "") === category)) continue;
    const selected = selectedToppings.filter((topping) => (topping.category?.trim() ?? "") === category).length;
    const minimum = minimums[category] ?? 0;
    const maximum = maximums[category] ?? null;
    if (selected < minimum) return { category, selected, minimum, maximum, reason: "minimum" };
    if (maximum !== null && selected > maximum) return { category, selected, minimum, maximum, reason: "maximum" };
  }
  return null;
}

// 既存の呼び出し元向けに最低数専用の結果形式を保つ。
export function missingToppingCategoryMinimum(
  menu: WizardMenu,
  selectedToppings: CategorizedTopping[],
  availableToppings: CategorizedTopping[],
): { category: string; required: number; selected: number } | null {
  const violation = validateToppingCategorySelection(menu, selectedToppings, availableToppings);
  if (!violation || violation.reason !== "minimum") return null;
  return { category: violation.category, required: violation.minimum, selected: violation.selected };
}

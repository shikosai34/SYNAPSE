type WizardMenu = {
  toppingWizardEnabled: boolean;
  toppingCategoryMinimums: string;
};

type CategorizedTopping = { category: string | null };

// 2026-10-07 Issue #111: クライアントを経由しない注文にもカテゴリ最低選択数を適用する。
export function missingToppingCategoryMinimum(
  menu: WizardMenu,
  selectedToppings: CategorizedTopping[],
  availableToppings: CategorizedTopping[],
): { category: string; required: number; selected: number } | null {
  if (!menu.toppingWizardEnabled) return null;

  let minimums: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(menu.toppingCategoryMinimums || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      minimums = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] > 0,
      ));
    }
  } catch {
    // 破損した古い設定は必須選択なしとして扱い、注文受付を止めない。
  }

  for (const [category, required] of Object.entries(minimums)) {
    // 2026-10-07 Issue #111: メニューからカテゴリの選択肢を外した後も、その設定で注文を永久に止めない。
    if (!availableToppings.some((topping) => (topping.category?.trim() ?? "") === category)) continue;
    const selected = selectedToppings.filter((topping) => (topping.category?.trim() ?? "") === category).length;
    if (selected < required) return { category, required, selected };
  }
  return null;
}

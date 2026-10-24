import { useState } from "react";
import { parseJapaneseAllergens, type JapaneseAllergen } from "@fesflow/config/allergens";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { ArrowUpRight } from "lucide-react";
import type { CartLine } from "./cart";

type AllergenTopping = { id: string; name: string; allergens: string | null };
type AllergenMenu = { id: string; name: string; allergens: string | null; toppings: AllergenTopping[] };

// 2026-10-21: メニュー本体と選択トッピングを分け、主メニューの一致だけ赤い確認モーダルへ振り分ける。
export interface CartAllergyWarning {
  lineId: string;
  menuName: string;
  menuMatches: JapaneseAllergen[];
  toppingMatches: JapaneseAllergen[];
  unregistered: string[];
}

// 2026-10-15 (#124): 選択中のメニュー本体と選択されたトッピングだけを家族全体の申告と照合する。
export function getCartAllergyWarnings(
  cart: CartLine[],
  menus: ReadonlyMap<string, AllergenMenu>,
  familyAllergies: JapaneseAllergen[] | null,
): CartAllergyWarning[] {
  const familySet = new Set(familyAllergies ?? []);
  return cart.map((line) => {
    const menuMatches = new Set<JapaneseAllergen>();
    const toppingMatches = new Set<JapaneseAllergen>();
    const unregistered: string[] = [];
    const menu = menus.get(line.menuId);

    if (!menu) {
      unregistered.push(line.menuName);
    } else {
      const menuAllergens = parseJapaneseAllergens(menu.allergens);
      if (menuAllergens === null) unregistered.push(menu.name);
      else menuAllergens.forEach((item) => { if (familySet.has(item)) menuMatches.add(item); });

      for (const selected of line.toppings) {
        const topping = menu.toppings.find((item) => item.id === selected.toppingId);
        if (!topping) {
          unregistered.push(`${menu.name}（${selected.toppingName}）`);
          continue;
        }
        const toppingAllergens = parseJapaneseAllergens(topping.allergens);
        if (toppingAllergens === null) unregistered.push(`${menu.name}（${topping.name}）`);
        else toppingAllergens.forEach((item) => { if (familySet.has(item)) toppingMatches.add(item); });
      }
    }

    return { lineId: line.lineId, menuName: line.menuName, menuMatches: [...menuMatches], toppingMatches: [...toppingMatches], unregistered };
  });
}

export function OrderAllergyWarning({
  warnings,
  enabled,
}: {
  warnings: CartAllergyWarning[];
  enabled: boolean;
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const matches = warnings.filter((warning) => warning.menuMatches.length > 0 || warning.toppingMatches.length > 0);
  if (!enabled) return null;
  if (matches.length === 0) return null;

  return (
    <>
      {/* 2026-10-25: 来場者状態の注意と重複する説明をなくし、一致商品がある場合だけ要約と詳細導線を出す。 */}
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-thick border-destructive bg-destructive/10 p-3 text-xs">
        <p className="font-bold">登録済みのアレルギーに該当する商品があります。</p>
        <Button type="button" variant="outline" className="min-h-9 gap-1 border-thick border-destructive px-2 text-xs" onClick={() => setIsDetailsOpen(true)}>
          詳しくはこちら <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Modal
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        title="[アレルギー警告]"
        maxWidth="md"
      >
        <div role="alert" className="space-y-3 border-thick border-destructive bg-destructive/10 p-4 text-sm">
          <p className="font-bold">登録済みのアレルギーに該当する商品があります。注文前に内容を確認してください。</p>
          <ul className="space-y-2">
            {matches.map((warning) => (
              <li key={warning.lineId} className="border-t border-destructive/30 pt-2">
                <p className="font-bold">{warning.menuName}</p>
                {warning.menuMatches.length > 0 && <p>メニュー本体: {warning.menuMatches.join("・")}</p>}
                {warning.toppingMatches.length > 0 && <p>トッピング: {warning.toppingMatches.join("・")}</p>}
              </li>
            ))}
          </ul>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full min-h-11"
          onClick={() => setIsDetailsOpen(false)}
        >
          閉じる
        </Button>
      </Modal>
    </>
  );
}

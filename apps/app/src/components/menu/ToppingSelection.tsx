import { useEffect, useMemo, useState } from "react";
import type { Topping } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveAssetUrl } from "@/lib/asset-url";

const categoryKey = (category: string | null | undefined) => category?.trim() ?? "";
const categoryLabel = (category: string) => category || "未分類";

// 2026-10-07 Issue #111: DBのJSON設定を壊れていても注文画面で落とさずに使える数値設定へ読む。
export function parseToppingCategoryMinimums(raw?: string | null): Record<string, number> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] >= 0,
    ));
  } catch {
    return {};
  }
}

export function ToppingSelection({
  menuId,
  toppings,
  selected,
  freeIds = new Set<string>(),
  onToggle,
  wizardEnabled,
  disabled = false,
  minimums,
  onReadyChange,
}: {
  menuId: string;
  toppings: Topping[];
  selected: Set<string>;
  freeIds?: Set<string>;
  onToggle: (id: string) => void;
  wizardEnabled: boolean;
  disabled?: boolean;
  minimums: Record<string, number>;
  onReadyChange: (ready: boolean) => void;
}) {
  // 2026-10-07 Issue #111: カテゴリ単位の同一UIで、来場者とレジの操作順・必須数判定をそろえる。
  const [step, setStep] = useState(0);
  const groups = useMemo(() => {
    const byCategory = new Map<string, Topping[]>();
    for (const topping of toppings) {
      const category = categoryKey(topping.category);
      const group = byCategory.get(category) ?? [];
      group.push(topping);
      byCategory.set(category, group);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => categoryLabel(a).localeCompare(categoryLabel(b), "ja"))
      .map(([category, options]) => ({
        category,
        options: options.sort((a, b) => a.name.localeCompare(b.name, "ja")),
      }));
  }, [toppings]);

  useEffect(() => setStep(0), [menuId]);
  const activeStep = Math.min(step, Math.max(0, groups.length - 1));
  const requirementsMet = !wizardEnabled || groups.every(({ category, options }) =>
    options.filter((topping) => selected.has(topping.id) && !topping.soldOut).length >= (minimums[category] ?? 0),
  );
  const ready = requirementsMet && (!wizardEnabled || groups.length === 0 || activeStep === groups.length - 1);
  const activeGroup = groups[activeStep];
  const canAdvance = !activeGroup || activeGroup.options
    .filter((topping) => selected.has(topping.id) && !topping.soldOut).length >= (minimums[activeGroup.category] ?? 0);

  useEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);

  if (groups.length === 0) {
    return <p className="text-[10px] text-muted-foreground">選択できるトッピングはありません。</p>;
  }

  const shownGroups = wizardEnabled ? [groups[activeStep]!] : groups;
  return (
    <div className="space-y-3">
      {wizardEnabled && (
        <div className="flex items-center justify-between gap-2 border-b-thin border-border pb-2 font-mono text-[10px] uppercase">
          <span>トッピング選択 {activeStep + 1} / {groups.length}</span>
          <span className="text-muted-foreground">カテゴリごとに選びます</span>
        </div>
      )}
      {shownGroups.map(({ category, options }) => {
        // 2026-10-07 Issue #111: ウィザード無効時は保存済み最低数を表示・判定に使わない。
        const minimum = wizardEnabled ? (minimums[category] ?? 0) : 0;
        const chosenCount = options.filter((topping) => selected.has(topping.id) && !topping.soldOut).length;
        const meetsMinimum = chosenCount >= minimum;
        return (
          <section key={category} className="space-y-2" aria-label={`${categoryLabel(category)}のトッピング`}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="font-mono text-xs font-black uppercase tracking-wider">{categoryLabel(category)}</h4>
              <span className={cn("font-mono text-[10px]", meetsMinimum ? "text-muted-foreground" : "text-warning font-bold")}>
                {minimum > 0 ? `最低 ${minimum} 個 · ` : "任意 · "}{chosenCount} 個選択中
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {options.map((topping) => {
                const isSelected = selected.has(topping.id);
                const isFree = isSelected && freeIds.has(topping.id);
                return (
                  <button
                    key={topping.id}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={disabled || topping.soldOut}
                    onClick={() => onToggle(topping.id)}
                    className={cn(
                      "flex min-h-11 items-center gap-1.5 border-thick px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {topping.imagePath && <img src={resolveAssetUrl(topping.imagePath)} alt="" className="h-5 w-5 shrink-0 border-thin border-current object-cover" />}
                    <span>{topping.name}</span>
                    {isFree ? (
                      <span className="flex items-center gap-1"><span className="line-through opacity-70">¥{topping.price}</span><span>無料</span></span>
                    ) : (
                      <span className={isSelected ? "opacity-80" : "text-muted-foreground"}>
                        {topping.price >= 0 ? `+¥${topping.price}` : `-¥${Math.abs(topping.price)}`}
                      </span>
                    )}
                    {topping.soldOut && <span className="text-error">売切</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {wizardEnabled && (
        <div className="flex justify-between gap-2 border-t-thin border-border pt-2">
          <Button type="button" variant="outline" size="sm" disabled={activeStep === 0} onClick={() => setStep(activeStep - 1)}>
            前へ
          </Button>
          {activeStep < groups.length - 1 ? (
            <Button type="button" size="sm" disabled={!canAdvance} onClick={() => setStep(activeStep + 1)}>
              次へ
            </Button>
          ) : (
            <span className={cn("self-center font-mono text-[10px] font-bold uppercase", ready ? "text-success" : "text-warning")}>
              {ready ? "選択完了" : "カテゴリの最低数を選んでください"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

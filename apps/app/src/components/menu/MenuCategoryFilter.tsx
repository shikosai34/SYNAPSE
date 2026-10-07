import type { Menu } from "@/lib/api";

// 2026-10-07 Issue #112: visitorとレジで同じカテゴリ選択と未分類の扱いを使う。
export function menuCategoryKey(category: string | null | undefined): string {
  return category?.trim() ?? "";
}

export function menuCategoryLabel(category: string | null | undefined): string {
  return menuCategoryKey(category) || "未分類";
}

export function MenuCategoryFilter({
  menus,
  selectedCategory,
  onSelect,
}: {
  menus: Menu[];
  selectedCategory: string | null;
  onSelect: (category: string | null) => void;
}) {
  const categories = Array.from(new Set(menus.map((menu) => menuCategoryKey(menu.category))))
    .sort((a, b) => menuCategoryLabel(a).localeCompare(menuCategoryLabel(b), "ja"));
  if (categories.length === 0) return null;

  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="メニューカテゴリ">
      <button
        type="button"
        aria-pressed={selectedCategory === null}
        onClick={() => onSelect(null)}
        className={`shrink-0 border-thick px-3 py-2 font-mono text-xs font-bold uppercase ${selectedCategory === null ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
      >
        すべて <span className="ml-1 opacity-70">{menus.length}</span>
      </button>
      {categories.map((category) => {
        const count = menus.filter((menu) => menuCategoryKey(menu.category) === category).length;
        const active = selectedCategory === category;
        return (
          <button
            key={category || "uncategorized"}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(category)}
            className={`shrink-0 border-thick px-3 py-2 font-mono text-xs font-bold uppercase ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
          >
            {menuCategoryLabel(category)} <span className="ml-1 opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

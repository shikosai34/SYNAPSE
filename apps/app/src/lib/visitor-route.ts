// 2026-10-08: App.tsx に登録済みの名称URLを表示名/ハイフン区切りの両方で解決し、
// 同名候補が複数ある場合に別イベント・サークルを誤表示しない。
export function findVisitorRouteItem<T>(
  items: readonly T[],
  routeName: string | undefined,
  getId: (item: T) => string,
  getName: (item: T) => string,
): T | null {
  if (!routeName) return null;

  const target = normalizeRouteName(routeName);
  if (!target) return null;

  const matches = items.filter((item) =>
    normalizeRouteName(getId(item)) === target || normalizeRouteName(getName(item)) === target,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function normalizeRouteName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/-+/g, "-");
}

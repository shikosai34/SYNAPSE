import type { CSSProperties, ReactNode } from "react";

/**
 * イベントテーマ適用ラッパ (2026-07-06)。
 *
 * イベント管理で設定した配色 (primary/accent/background/text) を、Tailwind が参照する
 * CSS 変数 (--primary, --accent, --background, --foreground …) にインラインで流し込む。
 * Tailwind v4 は `--color-primary: var(--primary)` のように定義しているため、コンテナに
 * これらの変数を上書きすれば配下の `bg-primary` / `text-foreground` 等がイベント配色になる。
 * これで「イベントごとの色設定」がフロントに実際に反映される。
 */
export interface EventThemeColors {
  primaryColor?: string | null;
  primaryTextColor?: string | null;
  accentColor?: string | null;
  accentTextColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
}

export function eventThemeStyle(theme?: EventThemeColors | null): CSSProperties {
  const s: Record<string, string> = {};
  if (!theme) return s as CSSProperties;
  if (theme.primaryColor) s["--primary"] = theme.primaryColor;
  if (theme.primaryTextColor) s["--primary-foreground"] = theme.primaryTextColor;
  if (theme.accentColor) s["--accent"] = theme.accentColor;
  if (theme.accentTextColor) s["--accent-foreground"] = theme.accentTextColor;
  if (theme.backgroundColor) s["--background"] = theme.backgroundColor;
  if (theme.textColor) s["--foreground"] = theme.textColor;
  return s as CSSProperties;
}

export function EventTheme({
  theme,
  className,
  children,
}: {
  theme?: EventThemeColors | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} style={eventThemeStyle(theme)}>
      {children}
    </div>
  );
}

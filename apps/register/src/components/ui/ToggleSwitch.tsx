import { cn } from "@/lib/utils";

/**
 * トグルスイッチ (2026-07-06)。
 * 拡張機能などの ON/OFF を「ボタン」ではなく物理スイッチとして表現する。
 * ブルータリスト調に合わせて角丸なし・太枠。
 */
export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** スクリーンリーダー用ラベル */
  label?: string;
  className?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
  className,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center border-thick rounded-none transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "border-primary bg-primary" : "border-border bg-muted",
        className,
      )}
    >
      <span
        className={cn(
          "block h-4 w-4 bg-background border-thin border-border transition-transform",
          checked ? "translate-x-[24px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

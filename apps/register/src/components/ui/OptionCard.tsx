import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 選択式の枠ボタン (2026-07-06)。
 * サークル設定「注文モード」のボタン UI を共通化したもの。強い枠 + 選択で反転し、
 * 「操作できる場所」を一目で分かるようにするためサービス全体で使う基準スタイル。
 */
export interface OptionCardProps {
  icon?: LucideIcon;
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
}

export function OptionCard({
  icon: Icon,
  label,
  description,
  selected,
  onSelect,
  disabled,
  className,
}: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "w-full text-left border-thick p-3 rounded-none transition-all flex items-start gap-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background hover:bg-muted",
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4 mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <div className="text-xs font-bold uppercase">{label}</div>
        {description && (
          <div
            className={cn(
              "text-[10px] mt-0.5",
              selected ? "text-primary-foreground/80" : "text-muted-foreground",
            )}
          >
            {description}
          </div>
        )}
      </div>
    </button>
  );
}

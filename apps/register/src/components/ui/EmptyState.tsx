import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 2026-07-05: 一覧が0件のときの表示がファイルごとにバラバラだったため共通化 (UX B-1)。
// RawBlock スタイル (破線の太枠・角丸なし・mono) で控えめに表示し、
// 追加アクションがある画面では「+ 追加」ボタンを直結できるようにする。

interface EmptyStateProps {
  /** 任意のアイコン。省略時はアイコンなし。 */
  icon?: LucideIcon;
  /** 空状態メッセージ (例: 「メニューがまだありません」)。 */
  message: string;
  /** 追加アクションのボタンラベル。省略時はメッセージのみ表示。 */
  actionLabel?: string;
  /** 追加アクションのクリックハンドラ。actionLabel と併せて指定する。 */
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  message,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-10 px-4 text-center",
        "border-thick border-dashed border-border bg-muted/10 font-mono",
        className,
      )}
    >
      {Icon && <Icon className="h-8 w-8 opacity-40 text-foreground" />}
      <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
        {message}
      </p>
      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          className="rounded-none border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-8 text-[11px] font-bold uppercase px-3 flex items-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

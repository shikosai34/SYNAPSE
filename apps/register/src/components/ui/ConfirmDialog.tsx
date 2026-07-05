import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// 2026-07-04: ネイティブ window.confirm() はブラウザにブロックされ得るため、
// 破壊的操作 (退出・削除・アンインストール等) の確認をアプリ内ダイアログで行う。
// 未保存フォームの3択は ConfirmationDialog、汎用の2択はこちらを使う。

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true で確定ボタンを destructive スタイルにする。 */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = "実行する",
  cancelLabel = "キャンセル",
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Escape はキャンセル扱い (処理は useFocusTrap 側に統合)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen, { onEscape: onCancel });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0" onClick={onCancel} />
      <div
        ref={focusTrapRef}
        tabIndex={-1}
        className="relative w-full max-w-md bg-background border-thick border-border p-6 space-y-6 font-mono text-foreground z-10"
      >
        <div className="space-y-2">
          <h3
            className={`text-sm font-bold uppercase tracking-wider ${
              destructive ? "text-destructive" : "text-foreground"
            }`}
          >
            {title}
          </h3>
          <p className="text-xs text-muted-foreground leading-[1.6]">{description}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button
            onClick={onConfirm}
            variant={destructive ? "destructive" : "default"}
            className="flex-1 h-10 text-xs font-bold uppercase rounded-none"
          >
            {confirmLabel}
          </Button>
          <Button
            onClick={onCancel}
            variant="outline"
            className="flex-1 h-10 text-xs font-bold uppercase rounded-none"
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

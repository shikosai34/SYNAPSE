import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// フォームを未保存のまま閉じようとした時の3択 (保存/破棄/継続) ダイアログ。
// 汎用の2択確認は ConfirmDialog を使う (2026-07-07 リネーム: 旧 ConfirmationDialog)。

interface UnsavedChangesDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: () => void; // 保存して閉じる等のアクション
  onDiscard: () => void; // 破棄して閉じる
  onCancel: () => void;  // 編集に戻る
}

export function UnsavedChangesDialog({
  isOpen,
  title,
  description,
  onConfirm,
  onDiscard,
  onCancel
}: UnsavedChangesDialogProps) {
  // Escape は「編集に戻る」扱い (処理は useFocusTrap 側に統合)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen, { onEscape: onCancel });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      {/* 背景タップで閉じるための透明オーバーレイ (Modal と同様の挙動) */}
      <div className="absolute inset-0" onClick={onCancel} />
      <div
        ref={focusTrapRef}
        tabIndex={-1}
        className="relative w-full max-w-md bg-background border-thick border-border p-6 space-y-6 font-mono text-foreground z-10"
      >
        <div className="space-y-2">
          <h3 className="text-sm font-bold uppercase tracking-wider text-destructive">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground leading-[1.6]">
            {description}
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button
            onClick={onConfirm}
            className="flex-1 h-10 border-thick border-primary bg-primary text-primary-foreground font-bold text-xs uppercase rounded-none hover:bg-background hover:text-foreground"
          >
            [保存して閉じる]
          </Button>
          <Button
            onClick={onDiscard}
            variant="outline"
            className="flex-1 h-10 border-thick border-destructive bg-destructive text-destructive-foreground font-bold text-xs uppercase rounded-none hover:bg-background hover:text-destructive"
          >
            [保存せず閉じる]
          </Button>
          <Button
            onClick={onCancel}
            variant="outline"
            className="flex-1 h-10 border-thick border-border bg-background text-foreground font-bold text-xs uppercase rounded-none hover:bg-primary hover:text-primary-foreground"
          >
            [入力を続ける]
          </Button>
        </div>
      </div>
    </div>
  );
}

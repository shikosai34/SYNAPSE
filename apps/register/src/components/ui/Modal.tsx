import { useEffect } from "react";
import { X } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// 2026-07-04: 各 FormModal (Circle/Menu/Topping/Staff/EventStaff) が同一の
// モーダル外枠 JSX をコピペしていたため共通化。RawBlock デザイン
// (backdrop-blur / border-thick / 角丸なし / font-mono) を一箇所に集約する。
// あわせて Escape キー閉じ・背景スクロールロック・aria 属性を付与し UX/a11y を改善。

const MAX_WIDTH: Record<NonNullable<ModalProps["maxWidth"]>, string> = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

interface ModalProps {
  isOpen: boolean;
  /** ヘッダーに表示するタイトル。呼び出し側で `[...]` を含めて渡す。 */
  title: string;
  /** タイトル下の補足説明 (任意)。 */
  subtitle?: string;
  /** 背景クリック・×ボタン・Escape で呼ばれる閉じるハンドラ。 */
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: "md" | "lg" | "xl";
  /** 確認ダイアログ等をこのモーダルの上に重ねる場合に z-index を調整する。 */
  zIndexClassName?: string;
}

export function Modal({
  isOpen,
  title,
  subtitle,
  onClose,
  children,
  maxWidth = "lg",
  zIndexClassName = "z-50",
}: ModalProps) {
  // 背景スクロールロック (Escape 閉じは useFocusTrap 側に統合)
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen, { onEscape: onClose });

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center bg-foreground/80 p-4 backdrop-blur-sm",
        zIndexClassName,
      )}
      role="dialog"
      aria-modal="true"
    >
      {/* 背景タップで閉じるための透明オーバーレイ */}
      <div className="absolute inset-0" onClick={onClose} />

      <Card
        ref={focusTrapRef}
        tabIndex={-1}
        className={cn(
          "relative w-full bg-background border-thick border-border shadow-none font-mono text-foreground z-10 max-h-[85vh] flex flex-col",
          MAX_WIDTH[maxWidth],
        )}
      >
        <CardHeader className="pb-3 border-b-thick border-border flex flex-row items-start justify-between shrink-0">
          <div className="space-y-1">
            <CardTitle className="text-sm font-bold uppercase">{title}</CardTitle>
            {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="p-1 hover:bg-muted border-thick border-transparent hover:border-border transition-all shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>
        <CardContent className="pt-4 space-y-4 flex-1 overflow-y-auto">{children}</CardContent>
      </Card>
    </div>
  );
}

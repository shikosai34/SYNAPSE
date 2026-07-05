import { useEffect, useRef } from "react";

// 2026-07-05: Modal / ConfirmDialog / ConfirmationDialog で個別にフォーカス管理を
// 実装するとロジックが重複するため共通化。開いた際にダイアログ内へフォーカスを移し、
// Tab / Shift+Tab をダイアログ内で循環させ、閉じたら開く前のフォーカス元へ戻す。
// Escape 処理もここに統合し、各ダイアログでの重複実装をなくす。

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Modal の上に ConfirmationDialog が重なる等、トラップが同時に複数開くケースがある。
// 全トラップが document の keydown を購読すると Tab/Escape を奪い合うため、
// モジュールレベルのスタックで「最前面 (最後に開いたもの) だけが動作する」ようにする。
const trapStack: symbol[] = [];

interface UseFocusTrapOptions {
  /** 最前面のトラップで Escape が押されたときに呼ばれる (閉じる/キャンセル)。 */
  onEscape?: () => void;
}

/**
 * ダイアログ/モーダル用のフォーカストラップ。
 * `isOpen` の間、返された ref をコンテナ要素に付与すると
 * - 初回フォーカス: コンテナ内の最初のフォーカス可能要素 (なければコンテナ自身)
 * - Tab/Shift+Tab: コンテナ内で循環し、外へは抜けない
 * - Escape: `onEscape` を呼ぶ (指定時)
 * - クローズ時: 開く直前にフォーカスされていた要素へ復帰
 * を行う。多重表示時は最後に開いたトラップだけがキー入力を処理する。
 */
export function useFocusTrap<T extends HTMLElement>(
  isOpen: boolean,
  options?: UseFocusTrapOptions,
) {
  const containerRef = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // onEscape が毎レンダー新しい関数でも effect を張り直さずに済むよう ref 経由で参照する
  const onEscapeRef = useRef(options?.onEscape);
  onEscapeRef.current = options?.onEscape;

  useEffect(() => {
    if (!isOpen) return;

    const token = Symbol("focus-trap");
    trapStack.push(token);
    const isTopmost = () => trapStack[trapStack.length - 1] === token;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    const focusFirst = () => {
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable[0] ?? container).focus();
    };
    // マウント直後の描画を待ってからフォーカスする
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (e: KeyboardEvent) => {
      // 自分より前面にダイアログが重なっている間は何もしない (Tab も奪わない)
      if (!isTopmost()) return;

      if (e.key === "Escape") {
        onEscapeRef.current?.();
        return;
      }

      if (e.key !== "Tab" || !container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      const index = trapStack.indexOf(token);
      if (index !== -1) trapStack.splice(index, 1);
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      // 閉じる際、開く前にフォーカスされていた要素 (トリガー) へ戻す
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  return containerRef;
}

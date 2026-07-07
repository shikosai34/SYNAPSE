import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-error";

// 2026-07-07 (Phase6 UX堅牢化): データ取得失敗時の表示がファイルごとにバラバラ
// (生の error.message をそのまま出す/何も出さず無限スピナーのまま、等) だったため
// EmptyState (components/ui/EmptyState.tsx) と対になる共通コンポーネントとして用意する。
// React Query の isError 分岐で `<ErrorState error={error} onRetry={refetch} />` を
// 差し込むだけで、既存テーマ (border-thick / 角なし / mono) に沿ったエラー表示 +
// 再試行ボタン + requestId (サポート照合用) が得られるようにする。

interface ErrorStateProps {
  /** useQuery 等から渡された error。ApiError ならメッセージと requestId を活用する。 */
  error?: unknown;
  /** 見出し。省略時は「読み込みに失敗しました」。 */
  title?: string;
  /** 再試行ボタンのハンドラ (例: refetch)。省略時はボタンを表示しない。 */
  onRetry?: () => void;
  className?: string;
}

/** ApiError ならメッセージを、それ以外の Error なら message を、不明な値なら既定文言を返す。 */
function resolveMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "予期しないエラーが発生しました";
}

export function ErrorState({
  error,
  title = "読み込みに失敗しました",
  onRetry,
  className,
}: ErrorStateProps) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-10 px-4 text-center",
        "border-thick border-error bg-error/5 font-mono",
        className,
      )}
    >
      <AlertTriangle className="h-8 w-8 text-error" />
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider font-bold text-error">{title}</p>
        <p className="text-xs text-muted-foreground">{resolveMessage(error)}</p>
        {requestId && (
          <p className="text-[10px] text-muted-foreground/70">ID: {requestId}</p>
        )}
      </div>
      {onRetry && (
        <Button
          onClick={onRetry}
          variant="outline"
          className="h-8 text-[11px] font-bold uppercase px-3"
        >
          再試行
        </Button>
      )}
    </div>
  );
}

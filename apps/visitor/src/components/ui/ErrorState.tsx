import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-error";

// 2026-07-07 (Phase6 UX堅牢化): register(components/ui/ErrorState.tsx) と対の実装。
// データ取得失敗時に「エラー文言 + 再試行ボタン + requestId」を出す共通コンポーネント。
// EmptyState と同様、visitor には対応するものが存在しなかったため新規に用意する。

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

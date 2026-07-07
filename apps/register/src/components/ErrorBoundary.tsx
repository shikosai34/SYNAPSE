import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// 2026-07-07 (Phase6 UX堅牢化): React のレンダリング例外は try/catch で捕まえられず、
// 何もしなければ SPA 全体が白画面になる (React Query の onError 基盤とは別レイヤーの問題)。
// react-error-boundary を追加するほどの要件ではない (再試行ロジックは「再読み込み」で十分)
// ため、素の class component として実装し、App.tsx のルートツリーを包む。
// 既存テーマ (border-thick / 角なし / mono / 大文字) に沿ったフォールバックを表示する。

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 開発時に原因追跡できるよう console にも残す。サーバ送信は行わない (Phase6 スコープ外)。
    console.error("[ErrorBoundary] レンダリング中に例外が発生しました:", error, info.componentStack);
  }

  handleReload = () => {
    // state をリセットするだけでは同じ例外を再現しやすいコンポーネントもあるため、
    // 単純さを優先してフルリロードする (白画面からの確実な復帰を最優先)。
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-svh flex items-center justify-center p-4">
          <div className="w-full max-w-md border-thick border-error bg-error/5 p-6 space-y-4 font-mono text-center">
            <AlertTriangle className="h-10 w-10 text-error mx-auto" />
            <div className="space-y-1">
              <h1 className="text-sm font-bold uppercase tracking-wider text-error">
                エラーが発生しました
              </h1>
              <p className="text-xs text-muted-foreground">
                予期しない問題が発生し、画面を表示できませんでした。
              </p>
            </div>
            <Button onClick={this.handleReload} className="w-full h-10 text-xs">
              再読み込み
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

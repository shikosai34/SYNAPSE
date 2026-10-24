import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";

/**
 * 「元に戻す (undo)」付きトーストのヘルパ (2026-07-06)。
 *
 * 削除/変更などの操作を、確認ダイアログの代わりに「実行 → undo 可能なトースト」で扱う。
 * ポイント: サーバ反映 (commit) を一定時間遅延させ、その間に「元に戻す」が押されたら
 * commit を実行しない (= 本当に取り消せる)。時間切れ or 明示 dismiss で commit する。
 * これにより再作成ロジック無しで真に可逆な操作にできる。
 *
 * 使い方:
 *   undoableAction({
 *     message: "メニューを削除しました",
 *     optimistic: () => { ...UI 上で即座に消す (キャッシュ更新) ... },
 *     commit: async () => { await api.delete(id) },        // 時間切れで実行
 *     rollback: () => { ...optimistic を取り消す (再取得等) ... }, // undo 時
 *   })
 */
export interface UndoableActionOptions {
  /** トーストの文言 (例: "削除しました") */
  message: string;
  /** 楽観的更新: 押下直後に UI へ即反映する (任意) */
  optimistic?: () => void;
  /** 実際のサーバ反映。undo されなかった場合に一度だけ呼ばれる */
  commit: () => void | Promise<void>;
  /** undo された場合に optimistic を巻き戻す (任意) */
  rollback?: () => void;
  /** commit までの猶予 (ms)。既定 5000 */
  duration?: number;
  /** undo ボタンのラベル。既定 "元に戻す" */
  undoLabel?: string;
  /** commit 失敗時の文言 */
  errorMessage?: string;
  /** 確定・取り消し・失敗のいずれかで呼ぶライフサイクル通知 */
  onSettled?: (outcome: "undone" | "committed" | "failed") => void;
}

export function undoableAction({
  message,
  optimistic,
  commit,
  rollback,
  duration = 5000,
  undoLabel = "元に戻す",
  errorMessage = "操作に失敗しました",
  onSettled,
}: UndoableActionOptions) {
  optimistic?.();

  let undone = false;
  let committed = false;
  let settled = false;
  const settle = (outcome: "undone" | "committed" | "failed") => {
    if (settled) return;
    settled = true;
    onSettled?.(outcome);
  };

  const doCommit = async () => {
    if (undone || committed) return;
    committed = true;
    try {
      await commit();
      settle("committed");
    } catch (e: any) {
      // commit 失敗時は巻き戻してエラー表示
      rollback?.();
      settle("failed");
      toast.error(e?.message || errorMessage);
    }
  };

  toast(message, {
    duration,
    action: {
      label: undoLabel,
      onClick: () => {
        undone = true;
        rollback?.();
        settle("undone");
      },
    },
    // 時間切れ (自動クローズ) で確定
    onAutoClose: () => {
      void doCommit();
    },
    // ユーザーが手動で閉じた場合も確定 (undo を押していなければ)
    onDismiss: () => {
      void doCommit();
    },
  });
}

/**
 * React Query のリストキャッシュに対する「元に戻す付き削除」ヘルパ。
 * 確認ダイアログの代わりに使う。楽観的にキャッシュから除去し、猶予中に undo されなければ
 * サーバ削除を確定する。undo でキャッシュを復元。
 */
export function undoableDelete<T extends { id: string }>(opts: {
  queryClient: QueryClient;
  queryKey: unknown[];
  id: string;
  message: string;
  commit: () => Promise<unknown>;
  duration?: number;
}) {
  const { queryClient, queryKey, id, message, commit, duration } = opts;
  const prev = queryClient.getQueryData<T[]>(queryKey);
  const removedIndex = prev?.findIndex((item) => item.id === id) ?? -1;
  const removedItem = removedIndex >= 0 ? prev?.[removedIndex] : undefined;

  undoableAction({
    message,
    duration,
    optimistic: () =>
      queryClient.setQueryData<T[]>(queryKey, (old) =>
        old ? old.filter((x) => x.id !== id) : old,
      ),
    rollback: () => {
      if (!removedItem) return;

      // 2026-10-20: 複数削除が重なっても、古い全件スナップショットで他の更新を巻き戻さない。
      queryClient.setQueryData<T[]>(queryKey, (current) => {
        const items = current ?? prev;
        if (!items || items.some((item) => item.id === id)) return items;

        const restored = [...items];
        restored.splice(Math.min(removedIndex, restored.length), 0, removedItem);
        return restored;
      });
    },
    commit: async () => {
      await commit();
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

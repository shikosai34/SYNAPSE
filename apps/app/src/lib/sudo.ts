import { adminApi } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { ApiError } from "@/lib/api-error";

// SaaS 運営の権限昇格 (sudo) クライアントヘルパ (2026-07-12 Phase D)。
// 機微操作 (なりすまし開始など) の直前に呼び、未昇格ならパスキー再認証で昇格する。
// 昇格は 15 分で自動失効する (サーバ側 sudoSession)。
export async function ensureSudo(): Promise<boolean> {
  // 既に昇格済みなら何もしない
  try {
    const status = await adminApi.sudoStatus();
    if (status.elevated) return true;
  } catch {
    // 状態取得に失敗しても、下で昇格を試みる
  }

  // まず素直に昇格を試みる (セッションが十分新しければ通る)
  try {
    const res = await adminApi.elevate();
    return res.elevated;
  } catch (e) {
    // 再認証が必要 (REAUTH_REQUIRED) の場合はパスキー再認証してから再度昇格する。
    if (e instanceof ApiError && e.code === "REAUTH_REQUIRED") {
      await reauthWithPasskey();
      const res = await adminApi.elevate();
      return res.elevated;
    }
    throw e;
  }
}

/**
 * 2026-11-03: イベント削除の直前に必ずパスキーを求める。既存の15分昇格状態を
 * 再利用せず、認証直後の新セッションからサーバー側のsudo昇格を取り直す。
 */
export async function ensureSudoWithPasskey(): Promise<void> {
  await reauthWithPasskey();
  const res = await adminApi.elevate();
  if (!res.elevated) throw new Error("パスキー認証後の昇格に失敗しました");
}

// パスキーで再認証する (新しいセッションを張り直す)。パスキー未登録なら例外。
export async function reauthWithPasskey(): Promise<void> {
  const result = await authClient.signIn.passkey();
  // better-auth のクライアントはエラーを result.error に載せる場合がある
  const err = (result as { error?: { message?: string } } | undefined)?.error;
  if (err) {
    throw new Error(err.message || "パスキーでの再認証に失敗しました");
  }
}

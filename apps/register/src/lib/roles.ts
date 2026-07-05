/**
 * ロール表示ラベルの集約 (docs/UX-IMPROVEMENTS.md C-1)
 *
 * 新ロール体系（super_admin/event_manager/circle_manager/circle_staff/visitor）の
 * 日本語ラベル・短縮バッジ表記を1箇所にまとめる。以前は components/header.tsx 内に
 * 同じ対応表が複数箇所に直書きされていたため、表示の追加・変更時に修正漏れが
 * 起きやすかった。表示専用のユーティリティであり、権限判定ロジックは持たない
 * (権限ロジックは hooks/useCircleAuth.tsx の ROLES/ROLE_PERMISSIONS を参照)。
 */

export type Role =
  | "super_admin"
  | "event_manager"
  | "circle_manager"
  | "circle_staff"
  | "visitor";

// ロールの日本語表示ラベル
export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "システム最高管理者",
  event_manager: "イベント管理者",
  circle_manager: "店舗管理者",
  circle_staff: "一般スタッフ",
  visitor: "来場者",
};

// ヘッダー等で使う短縮バッジ表記
export const ROLE_BADGES: Record<Role, string> = {
  super_admin: "SUPER ADMIN",
  event_manager: "EVENT MGR",
  circle_manager: "CIRCLE MGR",
  circle_staff: "STAFF",
  visitor: "VISITOR",
};

function isKnownRole(role: string): role is Role {
  return role in ROLE_LABELS;
}

/**
 * ロールの日本語表示ラベルを返す。
 * 旧ロール体系（cashier/waiter 等）が残っている場合や未知の値が来た場合は、
 * そのまま大文字化して安全にフォールバックする。
 */
export function roleLabel(role: string): string {
  if (!role) return "";
  if (isKnownRole(role)) return ROLE_LABELS[role];
  return role.toUpperCase();
}

/**
 * ロールの短縮バッジ表記を返す。
 * 未知のロールはそのまま大文字化して返す。
 */
export function roleBadge(role: string): string {
  if (!role) return "";
  if (isKnownRole(role)) return ROLE_BADGES[role];
  return role.toUpperCase();
}

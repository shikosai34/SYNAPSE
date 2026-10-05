// 認可の正本 (2026-09-27): API とブラウザーで同じロール/権限定義を使い、
// DB スキーマや UI が独自のロール表を持って意味がずれるのを防ぐ。
export const ROLES = {
  SUPER_ADMIN: "super_admin",
  EVENT_MANAGER: "event_manager",
  CIRCLE_MANAGER: "circle_manager",
  // 管理者 (2026-10-05): オーナー (circle_manager) が個別に付与する。メニュー編集・売上・クーポンなど
  // サークルの運営権限はオーナーと同じだが、メンバー管理・オーナー譲渡・基本情報の変更は持たない
  // (それらは権限表ではなく実ロールの circle_manager で判定する)。
  CIRCLE_ADMIN: "circle_admin",
  CIRCLE_STAFF: "circle_staff",
} as const;

export type RoleType = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: [
    "system:read", "system:write", "event:read", "event:write", "event:delete",
    "circle:read", "circle:write", "circle:delete", "menu:read", "menu:write", "menu:delete",
    "order:read", "order:write", "order:delete", "staff:read", "staff:write", "staff:delete",
    "stock:read", "stock:write", "sales:read", "member:read", "member:write", "member:delete",
    "coupon:read", "coupon:write",
  ],
  [ROLES.EVENT_MANAGER]: [
    "event:read", "event:write", "circle:read", "circle:write", "circle:delete",
    "menu:read", "menu:write", "menu:delete", "order:read", "order:write", "order:delete",
    "staff:read", "staff:write", "staff:delete", "stock:read", "stock:write", "sales:read",
    "member:read", "member:write", "member:delete", "coupon:read", "coupon:write",
  ],
  [ROLES.CIRCLE_MANAGER]: [
    "circle:read", "circle:write", "menu:read", "menu:write", "menu:delete",
    "order:read", "order:write", "staff:read", "staff:write", "staff:delete",
    "stock:read", "stock:write", "sales:read", "member:read", "member:write",
    "coupon:read", "coupon:write",
  ],
  [ROLES.CIRCLE_ADMIN]: [
    "circle:read", "circle:write", "menu:read", "menu:write", "menu:delete",
    "order:read", "order:write", "staff:read", "staff:write", "staff:delete",
    "stock:read", "stock:write", "sales:read", "member:read", "member:write",
    "coupon:read", "coupon:write",
  ],
  [ROLES.CIRCLE_STAFF]: [
    "circle:read", "menu:read", "order:read", "order:write", "stock:read", "stock:write", "staff:read",
  ],
} as const;

export type Permission = (typeof ROLE_PERMISSIONS)[RoleType][number];

export const PERMISSION_NAMES: Record<string, string> = {
  "system:read": "システム閲覧",
  "system:write": "システム設定",
  "event:read": "イベント閲覧",
  "event:write": "イベント編集",
  "event:delete": "イベント削除",
  "circle:read": "サークル閲覧",
  "circle:write": "サークル編集",
  "circle:delete": "サークル削除",
  "menu:read": "メニュー閲覧",
  "menu:write": "メニュー編集",
  "menu:delete": "メニュー削除",
  "order:read": "注文閲覧",
  "order:write": "注文操作",
  "order:delete": "注文削除",
  "staff:read": "スタッフ閲覧",
  "staff:write": "スタッフ編集",
  "staff:delete": "スタッフ削除",
  "stock:read": "在庫閲覧",
  "stock:write": "在庫編集",
  "sales:read": "売上閲覧",
  "member:read": "メンバー閲覧",
  "member:write": "メンバー編集",
  "member:delete": "メンバー削除",
  "coupon:read": "クーポン閲覧",
  "coupon:write": "クーポン編集",
};

// super_admin のテナント操作は実ロール/なりすましがサーバーで別途評価する。
// システムスペースの UI で全テナント権限を表示しないよう、表示/導線用の一覧は限定する。
export function permissionsForRole(role: string | null | undefined): readonly string[] {
  if (!role || !Object.hasOwn(ROLE_PERMISSIONS, role)) return [];
  const permissions = ROLE_PERMISSIONS[role as RoleType] as readonly string[];
  return role === ROLES.SUPER_ADMIN
    ? permissions.filter((permission) => permission.startsWith("system:"))
    : permissions;
}

export function hasRolePermission(
  role: string | null | undefined,
  permission: string
): boolean {
  if (!role || !Object.hasOwn(ROLE_PERMISSIONS, role)) return false;
  return (ROLE_PERMISSIONS[role as RoleType] as readonly string[]).includes(permission);
}

// 高度な権限管理 (event.advancedPermissions) が OFF のイベントでは、サークル所属の
// circle_staff を circle_manager 相当として扱う。DB の membership.role は書き換えず、
// API とブラウザーの双方でこの関数を通して実効ロールを求める (ON に戻せば元の区別が復活する)。
export function effectiveCircleRole(
  role: string | null | undefined,
  advancedPermissions: boolean | null | undefined
): string | null | undefined {
  return role === ROLES.CIRCLE_STAFF && !advancedPermissions ? ROLES.CIRCLE_MANAGER : role;
}

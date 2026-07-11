
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import Loader from "@/components/loader";
import { useQuery } from "@tanstack/react-query";
import { membershipApi } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

// ロール定義（バックエンドと同期）
export const ROLES = {
  SUPER_ADMIN: "super_admin",
  SYSTEM_MANAGER: "system_manager",
  SYSTEM_STAFF: "system_staff",
  EVENT_MANAGER: "event_manager",
  EVENT_STAFF: "event_staff",
  CIRCLE_MANAGER: "circle_manager",
  CIRCLE_STAFF: "circle_staff",
} as const;

export type RoleType = (typeof ROLES)[keyof typeof ROLES];

// ロールの日本語名
export const ROLE_NAMES: Record<RoleType, string> = {
  [ROLES.SUPER_ADMIN]: "システム最高管理者",
  [ROLES.SYSTEM_MANAGER]: "システムマネージャー",
  [ROLES.SYSTEM_STAFF]: "システムスタッフ",
  [ROLES.EVENT_MANAGER]: "イベントマネージャー",
  [ROLES.EVENT_STAFF]: "イベントスタッフ",
  [ROLES.CIRCLE_MANAGER]: "サークルマネージャー",
  [ROLES.CIRCLE_STAFF]: "サークルスタッフ",
};

// 権限定義
export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: [
    "system:read",
    "system:write",
    "event:read",
    "event:write",
    "event:delete",
    "circle:read",
    "circle:write",
    "circle:delete",
    "menu:read",
    "menu:write",
    "menu:delete",
    "order:read",
    "order:write",
    "order:delete",
    "staff:read",
    "staff:write",
    "staff:delete",
    "stock:read",
    "stock:write",
    "sales:read",
    "member:read",
    "member:write",
    "member:delete",
  ],
  [ROLES.SYSTEM_MANAGER]: [
    "system:read",
    "system:write",
    "event:read",
    "event:write",
    "circle:read",
    "circle:write",
    "menu:read",
    "order:read",
    "sales:read",
  ],
  [ROLES.SYSTEM_STAFF]: [
    "system:read",
    "event:read",
    "circle:read",
  ],
  [ROLES.EVENT_MANAGER]: [
    "event:read",
    "event:write",
    "circle:read",
    "circle:write",
    "circle:delete",
    "menu:read",
    "menu:write",
    "menu:delete",
    "order:read",
    "order:write",
    "order:delete",
    "staff:read",
    "staff:write",
    "staff:delete",
    "stock:read",
    "stock:write",
    "sales:read",
    "member:read",
    "member:write",
    "member:delete",
  ],
  [ROLES.EVENT_STAFF]: [
    "event:read",
    "circle:read",
    "order:read",
    "member:read",
  ],
  [ROLES.CIRCLE_MANAGER]: [
    "circle:read",
    "circle:write",
    "menu:read",
    "menu:write",
    "menu:delete",
    "order:read",
    "order:write",
    "staff:read",
    "staff:write",
    "staff:delete",
    "stock:read",
    "stock:write",
    "sales:read",
    "member:read",
    "member:write",
  ],
  [ROLES.CIRCLE_STAFF]: [
    "circle:read",
    "menu:read",
    "order:read",
    "order:write",
    "stock:read",
    "stock:write",
    "staff:read",
  ],
} as const;

export type Permission = (typeof ROLE_PERMISSIONS)[RoleType][number];

// 権限の日本語名
export const PERMISSION_NAMES: Record<string, string> = {
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
};

// 認証情報の型
interface AuthInfo {
  userId?: string | null;
  circleId: string | null;
  eventId: string | null;
  userEmail: string | null;
  userName: string | null;
  role: RoleType | null;
  membershipId: string | null;
  circleName?: string | null;
  // 複数ロール対応: event_admin かつ circle_manager 等
  isEventAdmin?: boolean;
  adminMembershipId?: string | null;
  adminEventId?: string | null;
}


// LocalStorageのキー
const AUTH_STORAGE_KEY = "circleAuth";

// 認証情報を保存
export function saveAuthInfo(info: AuthInfo) {
  if (typeof window !== "undefined") {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(info));
    // 後方互換性のため circleId も保存
    if (info.circleId) {
      localStorage.setItem("circleId", info.circleId);
    }
    if (info.circleName) {
      localStorage.setItem("circleName", info.circleName);
    }
    window.dispatchEvent(new Event("authChange"));
  }
}

// 認証情報を取得
export function getAuthInfo(): AuthInfo | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem(AUTH_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (!parsed.circleName) {
        parsed.circleName = localStorage.getItem("circleName") || null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  // 後方互換性: 古い形式からの移行
  const circleId = localStorage.getItem("circleId");
  if (circleId) {
    return {
      circleId,
      eventId: null,
      userEmail: null,
      userName: null,
      role: null,
      membershipId: null,
    };
  }

  return null;
}

// 認証情報をクリア
export function clearAuthInfo() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem("circleId");
    localStorage.removeItem("circleName");
    window.dispatchEvent(new Event("authChange"));
  }
}

// 権限チェック: roleベースに加え、isEventAdminフラグも考慮
export function hasPermission(
  role: RoleType | null | undefined,
  permission: string,
  isEventAdmin?: boolean
): boolean {
  // event_adminフラグがあれば全権限を持つ
  if (isEventAdmin) return true;
  if (!role) return false;
  const permissions = ROLE_PERMISSIONS[role] as readonly string[];
  return permissions?.includes(permission) ?? false;
}

// 複数の権限のいずれかを持っているかチェック
export function hasAnyPermission(
  role: RoleType | null | undefined,
  permissions: string[],
  isEventAdmin?: boolean
): boolean {
  return permissions.some((p) => hasPermission(role, p, isEventAdmin));
}

// すべての権限を持っているかチェック
export function hasAllPermissions(
  role: RoleType | null | undefined,
  permissions: string[],
  isEventAdmin?: boolean
): boolean {
  return permissions.every((p) => hasPermission(role, p, isEventAdmin));
}

// 基本的な認証フック（後方互換性維持）
export function useCircleAuth() {
  const navigate = useNavigate();
  const [circleId, setCircleId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const authInfo = getAuthInfo();
    if (!authInfo?.circleId) {
      // event_admin で circleId がない場合はサークル選択に誘導せずダッシュボードを表示
      if (authInfo?.isEventAdmin || authInfo?.role === "event_manager" || authInfo?.role === "super_admin") {
        setCircleId(null);
      } else {
        navigate("/login");
      }
    } else {
      setCircleId(authInfo.circleId);
    }
    setIsLoading(false);
  }, [navigate]);

  return { circleId, isLoading };
}

// ロール対応の認証フック
export function useAuth() {
  const navigate = useNavigate();
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const info = getAuthInfo();
    setAuthInfo(info);
    setIsLoading(false);

    const handleAuthChange = () => {
      setAuthInfo(getAuthInfo());
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === AUTH_STORAGE_KEY || e.key === "circleName") {
        handleAuthChange();
      }
    };

    window.addEventListener("authChange", handleAuthChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("authChange", handleAuthChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const login = useCallback((info: AuthInfo) => {
    saveAuthInfo(info);
    setAuthInfo(info);
  }, []);

  const logout = useCallback(() => {
    clearAuthInfo();
    setAuthInfo(null);
    navigate("/login");
  }, [navigate]);

  // event_manager / super_admin はイベント管理者扱い
  const effectiveIsEventAdmin =
    authInfo?.isEventAdmin ||
    authInfo?.role === "event_manager" ||
    authInfo?.role === "super_admin";

  const checkPermission = useCallback(
    (permission: Permission) => {
      return hasPermission(authInfo?.role ?? null, permission, effectiveIsEventAdmin);
    },
    [authInfo?.role, effectiveIsEventAdmin]
  );

  const checkAnyPermission = useCallback(
    (permissions: Permission[]) => {
      return hasAnyPermission(authInfo?.role ?? null, permissions, effectiveIsEventAdmin);
    },
    [authInfo?.role, effectiveIsEventAdmin]
  );

  // 表示用のロール名: event_manager + circle_manager の場合は両方表示
  let displayRoleName: string | null = null;
  if (authInfo?.role) {
    displayRoleName = ROLE_NAMES[authInfo.role];
    if (authInfo.isEventAdmin && authInfo.role !== "event_manager") {
      displayRoleName = `${ROLE_NAMES["event_manager"]} / ${displayRoleName}`;
    }
  }

  return {
    ...authInfo,
    isAuthenticated: !!authInfo?.circleId || !!authInfo?.role || !!authInfo?.isEventAdmin,
    isEventAdmin: effectiveIsEventAdmin,
    isLoading,
    login,
    logout,
    checkPermission,
    checkAnyPermission,
    roleName: displayRoleName,
  };
}

// 権限ガードコンポーネント
export function PermissionGuard({
  children,
  permission,
  permissions,
  requireAll = false,
  fallback = null,
}: {
  children: React.ReactNode;
  permission?: string;
  permissions?: string[];
  requireAll?: boolean;
  fallback?: React.ReactNode;
}) {
  const { role, isLoading, isEventAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader />
      </div>
    );
  }

  let hasAccess = false;

  if (permission) {
    hasAccess = hasPermission(role, permission, isEventAdmin);
  } else if (permissions) {
    hasAccess = requireAll
      ? hasAllPermissions(role, permissions, isEventAdmin)
      : hasAnyPermission(role, permissions, isEventAdmin);
  }

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// 認証ガードコンポーネント (2026-07-04 SaaS簡素化)
export function CircleAuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [circleId, setCircleId] = useState<string | null>(null);
  const [isBypassAdmin, setIsBypassAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const authInfo = getAuthInfo();
    const isBypass = authInfo?.role === "super_admin" || authInfo?.role === "event_manager";

    if (authInfo?.circleId) {
      setCircleId(authInfo.circleId);
      setIsBypassAdmin(isBypass);
    } else if (isBypass) {
      // 管理者はサークル選択がなくてもバイパス可能にする
      setCircleId(null);
      setIsBypassAdmin(true);
    } else {
      navigate("/login");
    }
    setIsLoading(false);
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (!circleId && !isBypassAdmin) {
    return null;
  }

  return <>{children}</>;
}

// ロール別のアクセス制御ガード
export function RoleGuard({
  children,
  allowedRoles,
  fallback = null,
}: {
  children: React.ReactNode;
  allowedRoles: RoleType[];
  fallback?: React.ReactNode;
}) {
  const { role, isLoading, isEventAdmin } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader />
      </div>
    );
  }

  // event_admin は全ロールガードを通過
  if (isEventAdmin) {
    return <>{children}</>;
  }

  if (!role || !allowedRoles.includes(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// システム最高管理者専用ガード (2026-07-04 SaaS権限分離)
export function SystemAdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { role, isLoading, isAuthenticated } = useAuth();

  // 未認証のときだけ /login へ送る。認証済みでロールが合わない場合は下の
  // インラインの「権限がありません」を表示し、リダイレクトしない。権限スイッチの
  // 過渡状態で誤って /login に飛ぶのを防ぐ (2026-07-04 権限切替時のログイン画面表示を修正)
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (!isAuthenticated || role !== "super_admin") {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-center p-4">
        <h2 className="text-[32px] font-headline uppercase tracking-tight leading-[1.1]">
          アクセス権限がありません
        </h2>
        <p className="font-body text-[14px] leading-[1.5]">
          システム管理機能を利用するには、システム最高管理者（super_admin）アカウントでログインする必要があります。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

// イベント管理者専用ガード (2026-07-04 SaaS権限分離)
export function EventAdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { role, isLoading, isAuthenticated } = useAuth();

  // 未認証のときだけ /login へ送る (SystemAdminGuard と同じ理由)
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  const isAllowed = role === "event_manager" || role === "super_admin";
  if (!isAuthenticated || !isAllowed) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-center p-4">
        <h2 className="text-[32px] font-headline uppercase tracking-tight leading-[1.1]">
          アクセス権限がありません
        </h2>
        <p className="font-body text-[14px] leading-[1.5]">
          イベント管理機能を利用するには、イベント管理者（event_manager）アカウントでログインする必要があります。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

// 所属スペース一覧取得用フック (2026-07-04)
// 2026-07-09: クエリの有効化条件を localStorage(circleAuth) の userEmail から
// better-auth セッションの email に変更した。旧実装はアクティブスペース未確定時
// (サインアップ直後・ログアウト直後) に circleAuth が無く email=undefined となり、
// スペース選択画面がまさにその状態を扱う画面であるにもかかわらず所属一覧を取得できず
// 「所属していません」と誤表示していた。サーバの /my は元々クエリの userEmail を無視して
// セッションの email で判定するため、セッション基準に揃えるのが正しい。
export function useMySpaces() {
  const { data: session } = authClient.useSession();
  const email = session?.user?.email ?? null;

  return useQuery({
    queryKey: ["mySpaces", email],
    queryFn: async () => {
      if (!email) return [];
      return await membershipApi.listMy(email);
    },
    enabled: !!email,
  });
}

// サインイン/サインアップ直後に所属(memberships)を解決し、アクティブスペースを
// localStorage(circleAuth)へ確定保存した上で遷移先パスを返す共通処理 (2026-07-09)。
// 以前は sign-in-form にしか同等ロジックが無く、sign-up-form では所属解決も
// saveAuthInfo も行わずに /circle/dashboard へ直行していたため、super_admin で
// サインアップしても circleAuth 未設定のまま CircleAuthGuard に弾かれ、/login の
// スペース選択で所属未確定状態に落ちていた。両フォームでこの関数を共有する。
export type ResolvedSpaceKind = "system" | "event" | "circle" | "none";
export interface ResolvedActiveSpace {
  path: string;
  kind: ResolvedSpaceKind;
  membership: any | null;
}

export async function resolveActiveSpaceAfterAuth(
  email: string
): Promise<ResolvedActiveSpace> {
  const memberships = await membershipApi.listMy(email);
  const systemMembership = memberships.find((m: any) => m.role === "super_admin");
  const eventMembership = memberships.find((m: any) => m.role === "event_manager");
  const circleMembership = memberships.find((m: any) => m.circleId);

  if (systemMembership) {
    saveAuthInfo({
      circleId: null,
      eventId: null,
      userEmail: systemMembership.userEmail,
      userName: systemMembership.userName,
      role: systemMembership.role,
      membershipId: systemMembership.id,
      circleName: null,
      isEventAdmin: true,
    });
    return { path: "/sys/dashboard", kind: "system", membership: systemMembership };
  }

  if (eventMembership) {
    saveAuthInfo({
      circleId: null,
      eventId: eventMembership.eventId,
      userEmail: eventMembership.userEmail,
      userName: eventMembership.userName,
      role: eventMembership.role,
      membershipId: eventMembership.id,
      circleName: null,
      isEventAdmin: true,
    });
    return { path: "/event/dashboard", kind: "event", membership: eventMembership };
  }

  if (circleMembership) {
    saveAuthInfo({
      circleId: circleMembership.circleId,
      eventId: circleMembership.eventId,
      userEmail: circleMembership.userEmail,
      userName: circleMembership.userName,
      role: circleMembership.role,
      membershipId: circleMembership.id,
      circleName: circleMembership.circle?.name || null,
    });
    if (circleMembership.circle) {
      localStorage.setItem("circleName", circleMembership.circle.name);
    }
    return { path: "/circle/dashboard", kind: "circle", membership: circleMembership };
  }

  // 所属スペースが無いアカウント (来場者相当) は来場者マイページへ (2026-07-11 /visitor 集約)
  return { path: "/visitor/mypage", kind: "none", membership: null };
}

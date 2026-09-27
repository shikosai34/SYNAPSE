
import { useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import Loader from "@/components/loader";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, membershipApi } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { hasRolePermission, permissionsForRole, PERMISSION_NAMES, ROLES, type Permission, type RoleType } from "@fesflow/config";
import { ROLE_LABELS } from "@/lib/roles";
import { isUnauthorizedSessionError } from "@/lib/session-error";

// ロールの日本語名
export const ROLE_NAMES: Record<RoleType, string> = {
  [ROLES.SUPER_ADMIN]: ROLE_LABELS.super_admin,
  [ROLES.EVENT_MANAGER]: ROLE_LABELS.event_manager,
  [ROLES.CIRCLE_MANAGER]: ROLE_LABELS.circle_manager,
  [ROLES.CIRCLE_STAFF]: ROLE_LABELS.circle_staff,
};
export { ROLES, PERMISSION_NAMES, type Permission, type RoleType };

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
  _isEventAdmin?: boolean
): boolean {
  // isEventAdmin は表示/導線用の互換値。ドメイン横断の許可根拠にはしない (2026-09-27)。
  // super_admin のテナント操作は監査付き impersonation の有効ロールでのみ判定する。
  if (role === ROLES.SUPER_ADMIN) return permission.startsWith("system:");
  return hasRolePermission(role, permission);
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
  const queryClient = useQueryClient();
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authInfoLoaded, setAuthInfoLoaded] = useState(false);
  const [activeSpaceChecked, setActiveSpaceChecked] = useState(false);
  const { data: spaces, isLoading: spacesLoading, isError: spacesError, sessionPending, sessionError, sessionFetchError, retrySession } = useMySpaces();

  useEffect(() => {
    const info = getAuthInfo();
    setAuthInfo(info);
    setIsLoading(false);
    setAuthInfoLoaded(true);

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

  // サーバー側の所属一覧をスペース選択と照合する。停止/削除された所属や
  // ロール変更を、再読み込みなしで現在の画面にも反映する (2026-09-27)。
  useEffect(() => {
    if (!authInfoLoaded) return;
    if (!authInfo?.membershipId) {
      setActiveSpaceChecked(true);
      return;
    }
    if (spacesLoading || sessionPending) {
      setActiveSpaceChecked(false);
      return;
    }
    if (isUnauthorizedSessionError(sessionFetchError)) {
      if (getAuthInfo()?.membershipId === authInfo.membershipId) clearAuthInfo();
      setAuthInfo(null);
      setActiveSpaceChecked(true);
      navigate("/login", { replace: true });
      return;
    }
    // 一覧取得エラーは所属失効の証拠ではない。保存済み選択を維持し、権限UIは閉じて再試行を出す。
    if (spacesError || sessionError) {
      setActiveSpaceChecked(true);
      return;
    }

    const selected = spaces?.find((space: any) => space.id === authInfo.membershipId);
    if (!selected) {
      if (getAuthInfo()?.membershipId === authInfo.membershipId) {
        clearAuthInfo();
      }
      setAuthInfo(null);
      setActiveSpaceChecked(true);
      navigate("/login", { replace: true });
      return;
    }

    // super_admin が監査付き impersonation 中は membership はシステム所属のまま。
    // 対象ロール/イベントは下のサーバー状態から別に解決する。
    const impersonating = authInfo.role === ROLES.SUPER_ADMIN && authInfo.isEventAdmin && !!authInfo.eventId;
    if (!impersonating) {
      // イベント管理者がイベント画面から特定サークルへ移る場合、実際の所属は
      // event_manager のまま circleId だけを子イベント内の対象にする。サーバー側も
      // eventId と circleId の親子関係で許可するため、この選択中サークルを保つ (2026-09-27)。
      const selectedCircleId = selected.role === ROLES.EVENT_MANAGER && authInfo.eventId === selected.eventId
        ? authInfo.circleId
        : selected.circleId ?? null;
      const selectedCircleName = selected.role === ROLES.EVENT_MANAGER && authInfo.eventId === selected.eventId
        ? authInfo.circleName
        : selected.circle?.name ?? null;
      const nextInfo = {
        ...authInfo,
        role: selected.role as RoleType,
        circleId: selectedCircleId,
        eventId: selected.eventId ?? null,
        circleName: selectedCircleName,
      };
      if (
        authInfo.role !== nextInfo.role || authInfo.circleId !== nextInfo.circleId ||
        authInfo.eventId !== nextInfo.eventId || authInfo.circleName !== nextInfo.circleName
      ) {
        saveAuthInfo(nextInfo);
        setAuthInfo(nextInfo);
      }
    }
    setActiveSpaceChecked(true);
  }, [authInfo, authInfoLoaded, navigate, sessionError, sessionFetchError, sessionPending, spaces, spacesError, spacesLoading]);

  const impersonationQuery = useQuery({
    queryKey: ["impersonation-status"],
    queryFn: async () => {
      try {
        return await adminApi.impersonateStatus();
      } catch (error) {
        // 通信失敗を「なりすまし終了」と解釈すると権限表示と画面遷移が誤るため、失敗状態を保つ。
        throw error;
      }
    },
    enabled: authInfo?.role === ROLES.SUPER_ADMIN && authInfo.isEventAdmin === true && !!authInfo.eventId,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const isLocalImpersonation = authInfo?.role === ROLES.SUPER_ADMIN && authInfo.isEventAdmin && !!authInfo.eventId;
    if (!isLocalImpersonation || !impersonationQuery.isFetched || impersonationQuery.isFetching || impersonationQuery.isError || impersonationQuery.data?.active) return;
    const current = getAuthInfo();
    if (current?.membershipId !== authInfo?.membershipId || current.eventId !== authInfo?.eventId) return;
    const restored = { ...authInfo!, eventId: null, circleId: null, isEventAdmin: false };
    saveAuthInfo(restored);
    setAuthInfo(restored);
    queryClient.invalidateQueries();
    navigate("/sys/dashboard", { replace: true });
  }, [authInfo, impersonationQuery.data, impersonationQuery.isError, impersonationQuery.isFetched, impersonationQuery.isFetching, navigate, queryClient]);

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
  const isLocalImpersonation =
    authInfo?.role === ROLES.SUPER_ADMIN && authInfo.isEventAdmin === true && !!authInfo.eventId;
  // disabled query は直前の data を保持するため、現在の選択が system に戻ったら
  // 過去の active 状態を実効ロール/スコープに流用しない (2026-09-27)。
  const impersonation = isLocalImpersonation && impersonationQuery.data?.active ? impersonationQuery.data : null;
  const impersonationVerificationFailed =
    isLocalImpersonation && impersonationQuery.isError;
  const sessionIsUnauthorized = isUnauthorizedSessionError(sessionFetchError);
  const authorityUnverified = spacesError || (Boolean(authInfo?.membershipId) && sessionError && !sessionIsUnauthorized) || impersonationVerificationFailed;
  const effectiveRole = authorityUnverified
    ? null
    : (impersonation?.role as RoleType | null) ?? authInfo?.role ?? null;
  const effectiveIsEventAdmin = effectiveRole === ROLES.EVENT_MANAGER;

  const checkPermission = useCallback(
    (permission: Permission) => {
      if (authorityUnverified) return false;
      return hasPermission(effectiveRole, permission);
    },
    [effectiveRole, authorityUnverified]
  );

  const checkAnyPermission = useCallback(
    (permissions: Permission[]) => {
      if (authorityUnverified) return false;
      return hasAnyPermission(effectiveRole, permissions);
    },
    [effectiveRole, authorityUnverified]
  );

  // 表示用の実効ロール名。旧 isEventAdmin フラグからロールを合成しない。
  let displayRoleName: string | null = null;
  if (effectiveRole) {
    displayRoleName = ROLE_NAMES[effectiveRole];
    if (impersonation && effectiveRole !== ROLES.EVENT_MANAGER) {
      displayRoleName = `${ROLE_NAMES["event_manager"]} / ${displayRoleName}`;
    }
  }

  return {
    ...authInfo,
    role: effectiveRole,
    eventId: impersonation?.eventId ?? authInfo?.eventId ?? null,
    circleId: impersonation?.circleId ?? authInfo?.circleId ?? null,
    isAuthenticated: !!authInfo?.circleId || !!authInfo?.role || !!authInfo?.isEventAdmin,
    isEventAdmin: effectiveIsEventAdmin,
    permissions: authorityUnverified ? [] : permissionsForRole(effectiveRole),
    membershipAuthorityError: authorityUnverified ? "権限情報を確認できません。再試行してください。" : null,
    retryAuthorization: () => {
      void queryClient.invalidateQueries({ queryKey: ["mySpaces"] });
      void queryClient.invalidateQueries({ queryKey: ["impersonation-status"] });
      void retrySession();
    },
    isLoading: isLoading || !activeSpaceChecked,
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
  showDenied = false,
}: {
  children: React.ReactNode;
  permission?: string;
  permissions?: string[];
  requireAll?: boolean;
  fallback?: React.ReactNode;
  showDenied?: boolean;
}) {
  const { role, isLoading, isEventAdmin, membershipAuthorityError, retryAuthorization } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader />
      </div>
    );
  }

  let hasAccess = false;

  if (membershipAuthorityError) {
    hasAccess = false;
  } else if (permission) {
    hasAccess = hasPermission(role, permission, isEventAdmin);
  } else if (permissions) {
    hasAccess = requireAll
      ? hasAllPermissions(role, permissions, isEventAdmin)
      : hasAnyPermission(role, permissions, isEventAdmin);
  }

  if (!hasAccess) {
    if (membershipAuthorityError) {
      return <AuthorizationUnavailable onRetry={retryAuthorization} />;
    }
    if (!showDenied) return <>{fallback}</>;
    const needed = permission
      ? [permission]
      : permissions ?? [];
    return (
      <section role="alert" className="mx-auto my-6 max-w-2xl border-thick border-border bg-muted p-5 font-mono">
        <h2 className="text-lg font-black">アクセス権限がありません</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          この画面を利用するには、次の権限が必要です。
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {needed.map((item) => <li key={item}>{PERMISSION_NAMES[item] ?? item}</li>)}
        </ul>
      </section>
    );
  }

  return <>{children}</>;
}

function AuthorizationUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <section role="alert" className="mx-auto my-6 max-w-xl border-thick border-border bg-muted p-5 text-center font-mono">
      <h2 className="text-lg font-black">権限情報を確認できません</h2>
      <p className="my-2 text-sm">接続を確認してから、もう一度お試しください。</p>
      <button className="underline" onClick={onRetry}>再試行</button>
    </section>
  );
}

// 認証ガードコンポーネント (2026-07-04 SaaS簡素化)
// 2026-07-16: 従来は mount 時 (useEffect の依存配列が [navigate] のみ) にしか
// localStorage を読み直しておらず、circleId/isBypassAdmin を自前の state に固定していた。
// ヘッダーのスペース切り替えは同じパス (例: /circle/dashboard に留まったまま別サークルへ
// 切り替え) の場合ルート遷移が起きずこのコンポーネントは再マウントされないため、
// 古いサークルの判定のままリロードするまで反映されない不具合があった。
// useAuth() は saveAuthInfo が dispatch する "authChange" イベントを購読して常に最新の
// localStorage 値を返すため、これに乗り換えて再マウントに依存せず反映されるようにする。
export function CircleAuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { circleId, isAuthenticated, isLoading, membershipAuthorityError, retryAuthorization } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
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

  if (!isAuthenticated) {
    return null;
  }

  if (membershipAuthorityError) {
    return <AuthorizationUnavailable onRetry={retryAuthorization} />;
  }

  if (!circleId) {
    return (
      <div role="status" className="mx-auto my-8 max-w-xl border-thick border-border bg-muted p-6 text-center font-mono">
        <h2 className="text-lg font-black">サークルスペースが選択されていません</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          ヘッダーのスペース切り替えから、操作するサークルを選択してください。
        </p>
      </div>
    );
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
  const { role, isLoading, membershipAuthorityError, retryAuthorization } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (membershipAuthorityError || !role || !allowedRoles.includes(role)) {
    if (fallback !== null) return <>{fallback}</>;
    if (membershipAuthorityError) return <AuthorizationUnavailable onRetry={retryAuthorization} />;
    return (
      <section role="alert" className="mx-auto my-6 max-w-2xl border-thick border-border bg-muted p-5 font-mono">
        <h2 className="text-lg font-black">アクセス権限がありません</h2>
        <p className="mt-2 text-sm text-muted-foreground">選択中のスペースではこの機能を利用できません。</p>
      </section>
    );
  }

  return <>{children}</>;
}

// システム最高管理者専用ガード (2026-07-04 SaaS権限分離)
export function SystemAdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { role, isLoading, isAuthenticated, membershipAuthorityError, retryAuthorization } = useAuth();

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

  if (membershipAuthorityError) return <AuthorizationUnavailable onRetry={retryAuthorization} />;

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

// イベント管理者ガード。super_admin は有効な impersonation 中だけ event_manager として通す (2026-09-27)。
export function EventAdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { role, isLoading, isAuthenticated, membershipAuthorityError, retryAuthorization } = useAuth();

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

  if (membershipAuthorityError) return <AuthorizationUnavailable onRetry={retryAuthorization} />;

  const isAllowed = role === ROLES.EVENT_MANAGER;
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
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending, error: sessionError, refetch: retrySession } = authClient.useSession();
  const email = session?.user?.email ?? null;

  useEffect(() => {
    const refreshMemberships = () => {
      void queryClient.invalidateQueries({ queryKey: ["mySpaces"] }, { cancelRefetch: false });
    };
    window.addEventListener("membershipsChanged", refreshMemberships);
    return () => window.removeEventListener("membershipsChanged", refreshMemberships);
  }, [queryClient]);

  const query = useQuery({
    queryKey: ["mySpaces", email],
    queryFn: async () => {
      if (!email) return [];
      return await membershipApi.listMy(email);
    },
    enabled: !!email,
    refetchOnWindowFocus: true,
  });
  return { ...query, sessionPending, sessionError: !!sessionError, sessionFetchError: sessionError, retrySession };
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

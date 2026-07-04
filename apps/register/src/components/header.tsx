import { useState, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { Menu, X, ChevronDown, User, Bell } from "lucide-react";
import AccountModal from "./account-modal";
import { PRODUCT_NAME } from "@fesflow/config";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventApi, notificationApi } from "@/lib/api";
import {
  useAuth,
  clearAuthInfo,
  hasPermission,
  useMySpaces,
  saveAuthInfo,
} from "@/hooks/useCircleAuth";

// register はスタッフ/管理で別サブドメイン配信 (staff. / admin.)。権限スイッチで
// スペース種別に応じて正しいドメインへ移動する。未設定(ローカル単一ポート)なら現オリジン。
// (2026-07-04 ドメイン分離対応)
const STAFF_URL = (import.meta.env.VITE_STAFF_URL as string) || "";
const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL as string) || "";

/** URL文字列からオリジンを取り出す。空/不正なら現在のオリジンを返す。 */
function toOrigin(url: string): string {
  if (!url) return window.location.origin;
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

export default function Header() {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const queryClient = useQueryClient();
  const { role, userName, circleName, isLoading, isAuthenticated, isEventAdmin, userEmail } =
    useAuth();
  const { data: spaces } = useMySpaces();

  // アカウント自体が super_admin かどうかは「現在アクティブなロール(role)」ではなく
  // 所属(spaces)から判定する。role を基準にすると、super_admin がサークルに切り替えた
  // 瞬間に role=circle_manager となり、システム管理/全イベントのスペースが一覧から
  // 消えて元に戻れなくなる不具合が出るため (2026-07-04 スペース表示の不安定を修正)
  const isAccountSuperAdmin = useMemo(
    () => (spaces ?? []).some((m: any) => m.role === "super_admin"),
    [spaces]
  );

  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [notifPopoverOpen, setNotifPopoverOpen] = useState(false);

  // 通知一覧取得 (2026-07-04 SaaS通知機能)
  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationApi.list(),
    enabled: isAuthenticated && !!userEmail,
    refetchInterval: 15000, // 15秒おきに自動更新
  });

  // 全イベント取得 (super_admin用)
  const { data: allEvents } = useQuery({
    queryKey: ["allEvents"],
    queryFn: () => eventApi.list(),
    enabled: isAuthenticated && isAccountSuperAdmin,
  });

  // 招待回答ミューテーション
  const respondMutation = useMutation({
    mutationFn: async ({ notifId, action }: { notifId: string; action: "accept" | "decline" }) => {
      return await notificationApi.respond(notifId, { action });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["mySpaces"] });
      if (variables.action === "accept") {
        toast.success("招待を承認しました。スペース一覧から切り替えられます。");
      } else {
        toast.success("招待を辞退しました");
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "処理に失敗しました");
    },
  });

  const handleLogout = () => {
    clearAuthInfo();
    localStorage.removeItem("circleName");
    localStorage.removeItem("eventName");
    toast.success("ログアウトしました");
    setProfileModalOpen(false);
    setNotifPopoverOpen(false);
    setMobileOpen(false);
    navigate("/login");
  };

  // 切り替え可能なスペース一覧。現在アクティブなロールに依存させず、ユーザーの所属
  // (spaces) と super_admin 判定だけから算出することで、どのスペースにいても一覧が
  // 安定する (2026-07-04 スペース表示の不安定を修正)
  const availableSpaces = useMemo(() => {
    const list: Array<{
      id: string;
      type: "system" | "event" | "circle";
      name: string;
      role: string;
      circleId?: string | null;
      eventId?: string | null;
    }> = [];

    // 1. システム管理 (アカウントが super_admin の場合)
    if (isAccountSuperAdmin) {
      list.push({
        id: "super_admin_system",
        type: "system",
        name: "システム管理",
        role: "super_admin",
      });
    }

    // 2. 所属スペースを走査 (super_admin メンバーシップ行は type=system で別扱い済み)
    (spaces ?? []).forEach((m: any) => {
      if (m.role === "super_admin") return;
      if (m.eventId && !m.circleId) {
        if (!list.some(x => x.type === "event" && x.eventId === m.eventId)) {
          list.push({
            id: m.id,
            type: "event",
            name: m.event?.eventName || `イベント: ${m.eventId}`,
            role: m.role,
            eventId: m.eventId,
          });
        }
      } else if (m.circleId) {
        if (!list.some(x => x.type === "circle" && x.circleId === m.circleId)) {
          list.push({
            id: m.id,
            type: "circle",
            name: m.circle?.name || `サークル: ${m.circleId}`,
            role: m.role,
            circleId: m.circleId,
            eventId: m.eventId,
          });
        }
      }
    });

    // 3. 全イベントを管理 (super_admin の場合の特別追加)
    if (isAccountSuperAdmin && allEvents) {
      allEvents.forEach((evt: any) => {
        if (!list.some(x => x.type === "event" && x.eventId === evt.id)) {
          list.push({
            id: `super_event_${evt.id}`,
            type: "event",
            name: evt.eventName,
            role: "event_manager",
            eventId: evt.id,
          });
        }
      });
    }

    return list;
  }, [spaces, allEvents, isAccountSuperAdmin]);

  const handleSwitchSpace = (space: any) => {
    const email = userEmail || "";
    const name = userName || null;

    // 遷移先とロールを先に確定させ、navigate → saveAuthInfo の順で呼ぶ。
    // saveAuthInfo 内の dispatchEvent("authChange") は同期的に状態更新をフラッシュする
    // ため、先に save すると「旧ルートのまま role だけ切り替わった」中間状態が生まれ、
    // 旧ルートのガード(EventAdminGuard 等)が不一致とみなして /login へ飛ばしてしまう。
    // navigate を先に呼ぶことで location 変更も同じフラッシュに含まれ、旧ガードは
    // アンマウントされ誤リダイレクトしない (2026-07-04 権限切替時のログイン画面表示を修正)
    let target = "/";
    let payload: Parameters<typeof saveAuthInfo>[0] | null = null;
    let message = "";

    if (space.type === "system") {
      target = "/admin/dashboard";
      message = "システム管理へ切り替えました";
      payload = {
        circleId: null,
        eventId: null,
        userEmail: email,
        userName: name,
        role: space.role,
        membershipId: space.id,
        circleName: null,
        isEventAdmin: true,
      };
    } else if (space.type === "event") {
      target = "/event/dashboard";
      message = `イベント [${space.name}] の管理者へ切り替えました`;
      payload = {
        circleId: null,
        eventId: space.eventId,
        userEmail: email,
        userName: name,
        role: space.role,
        membershipId: space.id,
        circleName: null,
        isEventAdmin: true,
      };
    } else if (space.type === "circle") {
      target = "/circle/dashboard";
      message = `店舗 [${space.name}] へ切り替えました`;
      payload = {
        circleId: space.circleId,
        eventId: space.eventId,
        userEmail: email,
        userName: name,
        role: space.role,
        membershipId: space.id,
        circleName: space.name,
        isEventAdmin: false,
      };
    }

    setProfileModalOpen(false);
    setNotifPopoverOpen(false);
    setMobileOpen(false);

    if (!payload) return;

    // スペース種別ごとの遷移先ドメイン: サークル=staff、イベント/システム=admin。
    const base = space.type === "circle" ? STAFF_URL : ADMIN_URL;

    if (toOrigin(base) === window.location.origin) {
      // 同一オリジン (ローカル or 既に該当ドメイン) はクライアント遷移
      navigate(target);
      saveAuthInfo(payload);
      toast.success(message);
    } else {
      // 別ドメインへ移動。localStorage はオリジン単位で共有されないため、アクティブ
      // スペース(payload)を URL の _sw で引き継ぎ、遷移先の main.tsx で復元する。
      // 認証セッション自体は api の Cookie 経由で全サブドメイン共通なので持ち越し不要。
      // btoa は Latin1 のみのため encodeURIComponent で UTF-8(日本語名)を退避する。
      const token = btoa(encodeURIComponent(JSON.stringify(payload)));
      window.location.href = `${base}${target}?_sw=${token}`;
    }
  };

  // 来場者機能は apps/visitor に分離したため register の管理ヘッダーには来場者リンクを持たない (2026-07-04)
  const isCircleView = pathname.startsWith("/circle");
  const isEventView = pathname.startsWith("/event");
  const isAdminView = pathname.startsWith("/admin");

  let links: Array<{ to: string; label: string }> = [];

  if (isAdminView && role === "super_admin") {
    links = [
      { to: "/admin/dashboard", label: "システム管理" },
    ];
  } else if (isEventView && (role === "event_manager" || role === "super_admin")) {
    links = [
      { to: "/event/dashboard", label: "イベント管理" },
    ];
  } else if (isCircleView && (role === "circle_manager" || role === "circle_staff" || role === "super_admin" || role === "event_manager")) {
    links = [
      { to: "/circle/dashboard", label: "ダッシュボード" },
      ...(hasPermission(role, "order:write", isEventAdmin) ? [{ to: "/circle/register", label: "レジ" }] : []),
      ...(hasPermission(role, "order:read", isEventAdmin) ? [{ to: "/circle/backyard", label: "厨房" }] : []),
    ];
  }

  const isActive = (to: string) => {
    return pathname.startsWith(to);
  };

  const getRoleTag = () => {
    if (!role) return "VISITOR";
    switch (role) {
      case "super_admin": return "SUPER ADMIN";
      case "event_manager": return "EVENT MGR";
      case "circle_manager": return "CIRCLE MGR";
      case "circle_staff": return "STAFF";
      default: return "USER";
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-background border-b-[3px] border-border text-foreground font-mono">
      <div className="flex items-center justify-between px-4 py-2 max-w-7xl mx-auto gap-4">
        {/* ロゴ / ブランド */}
        <Link
          to="/"
          className="font-headline text-base sm:text-lg md:text-xl uppercase tracking-[2px] leading-none select-none hover:opacity-80 flex items-center gap-2 shrink-0"
        >
          <span className="font-black border-[2px] border-border px-2 py-1 bg-primary text-primary-foreground text-sm sm:text-base">
            {PRODUCT_NAME.toUpperCase()}
            {isCircleView && " // BOOTH"}
            {isEventView && " // EVENT"}
            {isAdminView && " // SYSTEM"}
          </span>
        </Link>

        {/* デスクトップナビゲーション */}
        <nav className="hidden md:flex items-center gap-1 font-headline text-[13px] uppercase tracking-[1px]">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`px-3 py-1.5 border-[2px] border-border transition-all whitespace-nowrap ${
                isActive(to)
                  ? "bg-primary text-primary-foreground font-bold"
                  : "bg-background text-foreground hover:bg-muted"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* アカウント制御セクション */}
        <div className="flex items-center gap-2 shrink-0">
          {isAuthenticated && !isLoading ? (
            <div className="flex items-center gap-2 relative">
              {/* 通知ベルアイコン */}
              <div className="relative">
                <button
                  onClick={() => {
                    setNotifPopoverOpen(!notifPopoverOpen);
                    setProfileModalOpen(false);
                  }}
                  className="p-2 border-[2.5px] border-border bg-background hover:bg-muted select-none cursor-pointer flex items-center justify-center relative h-9 w-9 rounded-none"
                >
                  <Bell className="h-4 w-4" />
                  {notifications && notifications.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-none" />
                  )}
                </button>

                {/* 通知ポップオーバー (StudioBlank デザインルール準拠のフラットスタイル) */}
                {notifPopoverOpen && (
                  <div className="absolute right-0 top-11 z-50 w-72 sm:w-80 border-[1px] border-border bg-background p-4 shadow-none rounded-none text-left">
                    <div className="flex items-center justify-between border-b border-border/20 pb-2 mb-3">
                      <span className="text-[11px] font-black uppercase tracking-wider">[お知らせ・通知]</span>
                      <button
                        onClick={() => setNotifPopoverOpen(false)}
                        className="text-[10px] underline hover:text-primary cursor-pointer"
                      >
                        閉じる
                      </button>
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-3">
                      {notifications && notifications.length > 0 ? (
                        notifications.map((notif: any) => (
                          <div key={notif.id} className="text-xs border-[1px] border-border p-3 bg-muted/10 space-y-2">
                            <div className="font-bold flex items-center justify-between">
                              <span className="font-headline font-bold">{notif.title}</span>
                              <span className="text-[9px] text-muted-foreground">
                                {new Date(notif.createdAt).toLocaleDateString("ja-JP")}
                              </span>
                            </div>
                            <p className="text-[11px] leading-[1.4] text-foreground/80">{notif.message}</p>
                            {notif.type === "invite" && (
                              <div className="flex gap-2 pt-1.5">
                                <Button
                                  size="sm"
                                  className="h-7 text-[10px] flex-1 rounded-none border-[1px] border-border bg-primary text-primary-foreground hover:bg-background hover:text-foreground"
                                  onClick={() => respondMutation.mutate({ notifId: notif.id, action: "accept" })}
                                  disabled={respondMutation.isPending}
                                >
                                  承認
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 text-[10px] flex-1 rounded-none bg-destructive text-destructive-foreground hover:bg-background hover:text-foreground"
                                  onClick={() => respondMutation.mutate({ notifId: notif.id, action: "decline" })}
                                  disabled={respondMutation.isPending}
                                >
                                  辞退
                                </Button>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-6 text-muted-foreground text-xs">
                          通知はありません
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* プロフィールボタン */}
              <button
                onClick={() => {
                  setProfileModalOpen(!profileModalOpen);
                  setNotifPopoverOpen(false);
                }}
                className="flex items-center gap-2 bg-muted border-[2.5px] border-border px-3 py-1.5 font-mono text-[11px] font-bold hover:bg-muted/80 select-none cursor-pointer h-9 rounded-none"
              >
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline truncate max-w-[80px]">
                  {circleName || userName || "スタッフ"}
                </span>
                <span className="bg-primary text-primary-foreground px-1 py-0.5 text-[8px] font-black scale-90">
                  {getRoleTag()}
                </span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/login")}
              className="h-8 text-xs font-mono px-3 rounded-none"
            >
              ログイン
            </Button>
          )}

          {/* ハンバーガーメニュー (モバイルのみ) */}
          {links.length > 0 && (
            <button
              className="md:hidden flex items-center justify-center w-10 h-10 border-[3px] border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground transition-all rounded-none"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={mobileOpen ? "メニューを閉じる" : "メニューを開く"}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {/* モバイルドロワー */}
      {mobileOpen && links.length > 0 && (
        <div className="md:hidden bg-background border-t-[3px] border-border">
          <nav className="flex flex-col">
            {links.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`px-4 py-4 border-b-[2px] border-border font-headline text-[14px] uppercase tracking-[1px] transition-all ${
                  isActive(to)
                    ? "bg-primary text-primary-foreground font-bold"
                    : "bg-background text-foreground hover:bg-muted"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* ===== アカウント管理モーダル (プロフィール編集/メール変更/スペース切替・退出/削除) ===== */}
      <AccountModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        availableSpaces={availableSpaces}
        onSwitch={handleSwitchSpace}
        onLogout={handleLogout}
      />
    </header>
  );
}

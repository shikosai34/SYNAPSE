import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { Menu, X, ChevronDown } from "lucide-react";
import { PRODUCT_NAME } from "@fesflow/config";
import {
  useAuth,
  clearAuthInfo,
  hasPermission,
  useMySpaces,
  saveAuthInfo,
} from "@/hooks/useCircleAuth";

export default function Header() {
  const navigate = useNavigate();
  const pathname = useLocation().pathname;
  const { role, userName, circleName, isLoading, isAuthenticated, isEventAdmin, userEmail } =
    useAuth();
  const { data: spaces } = useMySpaces();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    clearAuthInfo();
    localStorage.removeItem("circleName");
    localStorage.removeItem("eventName");
    toast.success("ログアウトしました");
    navigate("/login");
    setMobileOpen(false);
  };

  const getAvailableSpaces = () => {
    if (!spaces) return [];
    const list: Array<{
      id: string;
      type: "system" | "event" | "circle";
      name: string;
      role: string;
      circleId?: string | null;
      eventId?: string | null;
    }> = [];

    spaces.forEach((m: any) => {
      if (["super_admin", "system_manager", "system_staff"].includes(m.role)) {
        list.push({
          id: m.id,
          type: "system",
          name: "システム管理",
          role: m.role,
        });
      } else if (m.eventId && !m.circleId) {
        list.push({
          id: m.id,
          type: "event",
          name: m.event?.eventName || `イベント: ${m.eventId}`,
          role: m.role,
          eventId: m.eventId,
        });
      } else if (m.circleId) {
        list.push({
          id: m.id,
          type: "circle",
          name: m.circle?.name || `サークル: ${m.circleId}`,
          role: m.role,
          circleId: m.circleId,
          eventId: m.eventId,
        });
      }
    });
    return list;
  };

  const handleSwitchSpace = (space: any) => {
    const email = userEmail || "";
    const name = userName || null;

    if (space.type === "system") {
      saveAuthInfo({
        circleId: null,
        eventId: null,
        userEmail: email,
        userName: name,
        role: space.role,
        membershipId: space.id,
        circleName: null,
        isEventAdmin: true,
      });
      toast.success(`システム管理者権限へ切り替えました`);
      navigate("/admin");
    } else if (space.type === "event") {
      saveAuthInfo({
        circleId: null,
        eventId: space.eventId,
        userEmail: email,
        userName: name,
        role: space.role,
        membershipId: space.id,
        circleName: null,
        isEventAdmin: true,
      });
      toast.success(`イベント [${space.name}] の管理者へ切り替えました`);
      navigate("/admin");
    } else if (space.type === "circle") {
      saveAuthInfo({
        circleId: space.circleId,
        eventId: space.eventId,
        userEmail: email,
        userName: name,
        role: space.role,
        membershipId: space.id,
        circleName: space.name,
        isEventAdmin: false,
      });
      toast.success(`店舗 [${space.name}] へ切り替えました`);
      navigate("/dashboard");
    }
    setSwitcherOpen(false);
  };

  const allLinks: Array<{
    to: "/" | "/menu" | "/my-order" | "/register" | "/backyard" | "/dashboard" | "/admin";
    label: string;
    permission: string | null;
  }> = [
    { to: "/menu", label: "メニュー", permission: null },
    { to: "/my-order", label: "マイQR", permission: null },
    { to: "/register", label: "レジ", permission: "order:write" },
    { to: "/backyard", label: "厨房", permission: "order:read" },
    { to: "/dashboard", label: "ダッシュボード", permission: "circle:read" },
    { to: "/admin", label: "管理", permission: "event:write" },
  ];

  const isClientView = pathname.startsWith("/menu") || pathname.startsWith("/my-order");

  const links = isClientView
    ? [
        { to: "/menu" as const, label: "メニュー" },
        { to: "/my-order" as const, label: "マイQR" },
      ]
    : allLinks.filter(
        (link) => link.permission === null || hasPermission(role, link.permission, isEventAdmin)
      );

  const isActive = (to: string) => {
    if (to === "/") return pathname === "/";
    return pathname.startsWith(to);
  };

  return (
    <header className="sticky top-0 z-50 bg-background border-b-[3px] border-border text-foreground">
      {/* メインバー */}
      <div className="flex items-center justify-between px-4 py-2 max-w-7xl mx-auto gap-4">
        {/* ロゴ */}
        <Link
          to={isClientView ? "/menu" : "/"}
          className="font-headline text-base sm:text-lg md:text-xl uppercase tracking-[2px] leading-none select-none hover:opacity-80 flex items-center gap-2 shrink-0"
          onClick={() => setMobileOpen(false)}
        >
          <span className="font-black border-[2px] border-border px-2 py-1 bg-primary text-primary-foreground text-sm sm:text-base">
            {isClientView
              ? `${PRODUCT_NAME.toUpperCase()} // CLIENT`
              : PRODUCT_NAME.toUpperCase()}
          </span>
        </Link>

        {/* デスクトップナビ */}
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

        {/* 右サイド */}
        <div className="flex items-center gap-2 shrink-0">
          {/* ユーザー名/スペース切り替え器（デスクトップのみ） */}
          {!isClientView && isAuthenticated && !isLoading && (
            <div className="relative hidden md:block">
              <button
                onClick={() => setSwitcherOpen(!switcherOpen)}
                className="flex items-center gap-1.5 bg-muted border-[2.5px] border-border px-3 py-1.5 font-mono text-[11px] font-bold hover:bg-muted/80 select-none cursor-pointer"
              >
                <span>
                  {circleName
                    ? `店舗: ${circleName}`
                    : (role === "super_admin" || role === "system_manager")
                    ? "システム管理"
                    : "イベント管理"}
                </span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              {switcherOpen && (
                <div className="absolute right-0 mt-1.5 w-64 bg-background border-[2.5px] border-border shadow-none py-1 z-50 text-left">
                  <div className="px-3 py-1 border-b border-border bg-muted/50 font-headline text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
                    スペースを切り替える
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {getAvailableSpaces().map((space) => (
                      <button
                        key={space.id}
                        onClick={() => handleSwitchSpace(space)}
                        className="w-full px-3 py-2 text-left hover:bg-primary hover:text-primary-foreground font-mono text-[11px] font-bold block border-b border-border/10 last:border-b-0 cursor-pointer"
                      >
                        <div className="uppercase text-[9px] text-muted-foreground font-black tracking-widest hover:text-primary-foreground/70">
                          {space.type.toUpperCase()} | {space.role}
                        </div>
                        <div className="truncate">{space.name}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ログイン/ログアウトボタン（デスクトップのみ） */}
          {!isClientView && (
            <div className="hidden md:block">
              {isAuthenticated ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="h-8 text-xs font-mono px-3"
                >
                  ログアウト
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/login")}
                  className="h-8 text-xs font-mono px-3"
                >
                  ログイン
                </Button>
              )}
            </div>
          )}

          {/* ハンバーガーボタン（モバイルのみ） */}
          <button
            className="md:hidden flex items-center justify-center w-10 h-10 border-[3px] border-border bg-background text-foreground hover:bg-primary hover:text-primary-foreground transition-all"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? "メニューを閉じる" : "メニューを開く"}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* モバイルドロワー */}
      {mobileOpen && (
        <div className="md:hidden bg-background border-t-[3px] border-border">
          {/* ユーザー情報とスペース選択（モバイル） */}
          {!isClientView && isAuthenticated && !isLoading && (
            <div className="px-4 py-3 border-b-[2px] border-border bg-muted space-y-2">
              <div className="font-mono text-[12px] uppercase tracking-[1px] font-bold">
                現在のスペース: {circleName ? `店舗: ${circleName}` : (role === "super_admin" || role === "system_manager") ? "システム管理" : "イベント管理"}
              </div>
              
              {/* スペース切り替えリスト */}
              {getAvailableSpaces().length > 1 && (
                <div className="space-y-1 pt-1.5 border-t border-border/20">
                  <div className="font-headline text-[9px] text-muted-foreground uppercase font-black tracking-widest">
                    スペース切り替え:
                  </div>
                  <div className="flex flex-col gap-1">
                    {getAvailableSpaces().map((space) => (
                      <button
                        key={space.id}
                        onClick={() => {
                          handleSwitchSpace(space);
                          setMobileOpen(false);
                        }}
                        className="text-left px-2 py-1.5 bg-background border border-border text-[11px] font-mono font-bold truncate hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
                      >
                        [{space.type.toUpperCase()}] {space.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ナビリンク */}
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

          {/* ログイン/ログアウト */}
          {!isClientView && (
            <div className="p-4">
              {isAuthenticated ? (
                <button
                  onClick={handleLogout}
                  className="w-full py-3 border-[3px] border-border bg-background text-foreground font-mono text-sm uppercase tracking-widest font-bold hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  ログアウト
                </button>
              ) : (
                <button
                  onClick={() => {
                    navigate("/circle-login");
                    setMobileOpen(false);
                  }}
                  className="w-full py-3 border-[3px] border-border bg-primary text-primary-foreground font-mono text-sm uppercase tracking-widest font-bold hover:bg-background hover:text-foreground transition-all"
                >
                  ログイン
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

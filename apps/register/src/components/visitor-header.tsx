import { Link, useLocation } from "react-router-dom";
import { PRODUCT_NAME } from "@fesflow/config";
import { QrCode, UtensilsCrossed } from "lucide-react";
import { useVisitor } from "@/hooks/useVisitor";

/**
 * 来場者向けヘッダー (2026-07-04)。
 * register の管理者ヘッダー(権限スイッチ/通知/アカウント管理)とは完全に切り離し、
 * 来場者に必要な「メニュー」「マイQR/マイページ」だけを置く。
 */
export default function VisitorHeader() {
  const pathname = useLocation().pathname;
  const { isEntered, session } = useVisitor();

  const links = [
    { to: "/menu", label: "メニュー", icon: UtensilsCrossed },
    { to: "/mypage", label: "マイページ", icon: QrCode },
  ];

  const isActive = (to: string) => pathname.startsWith(to);

  return (
    <header className="sticky top-0 z-50 bg-background border-b-[3px] border-border text-foreground font-mono">
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 max-w-3xl mx-auto gap-2 sm:gap-4">
        <Link
          to="/"
          className="font-headline text-base sm:text-lg uppercase tracking-[2px] leading-none select-none hover:opacity-80 flex items-center gap-2 shrink-0"
        >
          <span className="font-black border-[2px] border-border px-2 py-1 bg-primary text-primary-foreground text-sm">
            {PRODUCT_NAME.toUpperCase()} <span className="hidden sm:inline">// VISITOR</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 font-headline text-[12px] uppercase tracking-[1px] shrink-0">
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`px-2 sm:px-2.5 py-1 sm:py-1.5 border-[2px] border-border transition-all whitespace-nowrap flex items-center gap-1 ${
                isActive(to)
                  ? "bg-primary text-primary-foreground font-bold"
                  : "bg-background text-foreground hover:bg-muted"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
          {isEntered && session?.displayId != null && (
            <span className="ml-0.5 sm:ml-1 px-1.5 sm:px-2 py-1 border-[2px] border-border bg-muted text-[10px] sm:text-[11px] font-black">
              #{session.displayId}
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}

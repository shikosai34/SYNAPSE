import { Link, useLocation } from "react-router-dom";
import { PRODUCT_NAME } from "@fesflow/config";
import { QrCode, UtensilsCrossed, Receipt } from "lucide-react";
import { useVisitor } from "@/hooks/useVisitor";

/**
 * 来場者向けヘッダー (2026-07-04)。
 * register の管理者ヘッダー(権限スイッチ/通知/アカウント管理)とは完全に切り離し、
 * 来場者に必要な「メニュー」「マイQR/マイページ」だけを置く。
 */
export default function VisitorHeader() {
  const pathname = useLocation().pathname;
  const { isEntered, session } = useVisitor();

  // 2026-07-11: 来場者パスは /visitor 配下に集約。「メニュー」は出店未選択の案内が出る
  // /visitor/menu ではなく、実際に出店を選べる /visitor/events (出店ブラウズ) へ直結。
  const links = [
    { to: "/visitor/events", label: "メニュー", icon: UtensilsCrossed, match: ["/visitor/events", "/visitor/menu"] },
    { to: "/visitor/mypage", label: "マイQR", icon: QrCode, match: ["/visitor/mypage"] },
    { to: "/visitor/orders", label: "注文履歴", icon: Receipt, match: ["/visitor/orders"] },
  ];

  // メニューは /visitor/events・/visitor/menu どちらにいてもアクティブ表示にする
  const isActive = (matchPaths: string[]) =>
    matchPaths.some((p) => pathname.startsWith(p));

  return (
    <header className="sticky top-0 z-50 bg-background border-b-[3px] border-border text-foreground font-mono">
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 max-w-3xl mx-auto gap-2 sm:gap-4">
        <Link
          to="/visitor"
          className="font-headline text-base sm:text-lg uppercase tracking-[2px] leading-none select-none hover:opacity-80 flex items-center gap-2 shrink-0"
        >
          <span className="font-black border-[2px] border-border px-2 py-1 bg-primary text-primary-foreground text-sm">
            {PRODUCT_NAME.toUpperCase()} <span className="hidden sm:inline">// VISITOR</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 font-headline text-[12px] uppercase tracking-[1px] shrink-0">
          {links.map(({ to, label, icon: Icon, match }) => (
            <Link
              key={to}
              to={to}
              className={`px-2 sm:px-2.5 py-1 sm:py-1.5 border-[2px] border-border transition-all whitespace-nowrap flex items-center gap-1 ${
                isActive(match)
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

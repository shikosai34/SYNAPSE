import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

/**
 * 未移植ルートの暫定ページ (2026-07-04)。
 * Phase3 で各画面を移植したら App.tsx の Route を差し替えて解消する。
 */
export default function Placeholder() {
	const { pathname } = useLocation();
	return (
		<div className="max-w-3xl mx-auto px-sp-4 py-sp-7 text-center space-y-sp-4">
			<div className="inline-block bg-accent text-accent-foreground font-headline uppercase text-[12px] tracking-[3px] px-sp-3 py-sp-2 border-thick border-accent">
				MIGRATION IN PROGRESS
			</div>
			<h1 className="text-[28px] sm:text-[40px] font-headline uppercase leading-[1.05]">
				この画面は移植中です
			</h1>
			<p className="font-mono text-[13px] break-all">
				<span className="font-bold">{pathname}</span> は Vite 移行 (Phase3) で順次対応します。
			</p>
			<Link to="/" className="inline-block">
				<Button variant="outline" size="lg">
					トップへ戻る
				</Button>
			</Link>
		</div>
	);
}

import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

/** 2026-10-01: 未定義URLと移植中画面を区別し、行き先を見失わない404を表示する。 */
export default function NotFound() {
	const { pathname } = useLocation();

	return (
		<main
			className="flex min-h-svh items-center justify-center bg-muted px-sp-3 py-sp-6 text-foreground"
			aria-labelledby="not-found-title"
		>
			<section className="w-full max-w-2xl border-heavy border-border bg-background p-sp-4 text-center sm:p-sp-6">
				<p className="font-mono text-xs font-bold uppercase tracking-[3px] text-muted-foreground">
					PAGE NOT FOUND
				</p>
				<p className="mt-3 font-headline text-[72px] leading-none sm:text-[112px]" aria-hidden="true">
					404
				</p>
				<h1 id="not-found-title" className="mt-4 font-headline text-[24px] leading-tight sm:text-[32px]">
					ページが見つかりません
				</h1>
				<p className="mx-auto mt-3 max-w-xl font-mono text-sm leading-relaxed text-muted-foreground">
					URLが変更されたか、ページが存在しない可能性があります。
				</p>
				<p className="mt-4 break-all border-t-thin border-border pt-3 font-mono text-xs text-muted-foreground">
					{pathname}
				</p>
				<Link to="/" className="mt-6 inline-flex">
					<Button size="lg">トップページへ戻る</Button>
				</Link>
			</section>
		</main>
	);
}

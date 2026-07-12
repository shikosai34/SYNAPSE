import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import SignInForm from "@/components/sign-in-form";
import { authClient } from "@/lib/auth-client";
import { useMySpaces, getAuthInfo, resolveActiveSpaceAfterAuth } from "@/hooks/useCircleAuth";
import { roleLabel } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import Loader from "@/components/loader";

// Next.js app/login/page.tsx から移植 (2026-07-04)。
// Next の useSearchParams 用 Suspense 境界は不要なので除去。
// 2026-07-07 (Phase 3b): 独自PIN認証タブ (CircleLoginOnlyForm) を撤去し、
// better-auth ログイン一本にした。
// 2026-07-12: メール/パスワードのログイン・サインアップを廃止し、Google + パスキーのみに。
// アカウント作成は Google 初回ログインが担うため、サインアップ画面(SignUpForm)も撤去した。
export default function Login() {
	const navigate = useNavigate();

	// better-auth のセッションは有効だが、ローカルのアクティブスペース
	// (circleAuth) が未設定 = ログインし直しても行き先が決まらない状態がありうる
	// (例: 別端末でのログイン、localStorage クリア後の再訪問)。この場合に
	// SignInForm を再度出しても仕方ないため、所属一覧から選ばせる導線を出す
	// (項目4: スペース未選択ガード)。
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const authInfo = getAuthInfo();
	const hasActiveSpace = !!(authInfo?.circleId || authInfo?.isEventAdmin || authInfo?.role);
	const { data: spaces, isLoading: spacesLoading } = useMySpaces();

	// Google ログインは OAuth リダイレクト方式のため、フォーム内の onSuccess で
	// スペース解決ができない。リダイレクト後この画面に着地するので、ここで一度だけ
	// 所属解決を試み、スタッフスペース(システム/イベント/サークル)が見つかれば
	// そこへ自動遷移する。見つからなければ下のスペース選択案内にフォールバックする。
	// (メール/パスキーは各フォームで解決済みなので、この経路に来るのは主に Google 着地時)
	const autoResolvedRef = useRef(false);
	useEffect(() => {
		if (autoResolvedRef.current) return;
		if (!session?.user?.email || hasActiveSpace) return;
		autoResolvedRef.current = true;
		resolveActiveSpaceAfterAuth(session.user.email)
			.then((resolved) => {
				// 所属ゼロ (kind: "none") のときは自動遷移せず、案内画面を出す
				if (resolved.kind !== "none") {
					navigate(resolved.path);
				}
			})
			.catch(() => {
				// 解決に失敗しても致命的でない: 下のスペース選択案内にフォールバック
			});
	}, [session?.user?.email, hasActiveSpace, navigate]);

	if (sessionPending) {
		return <Loader />;
	}

	// ログイン済みだがアクティブスペース未設定 → スペース選択を案内する
	if (session && !hasActiveSpace) {
		return (
			<div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-sp-3 md:p-sp-5 bg-muted">
				<div className="w-full max-w-lg p-sp-5 bg-background border-heavy border-border text-foreground space-y-4">
					<h2 className="text-center text-[22px] font-headline uppercase tracking-tight leading-[1.1]">
						スペースを選択してください
					</h2>
					{spacesLoading ? (
						<Loader />
					) : spaces && spaces.length > 0 ? (
						<>
							<p className="font-mono text-[13px] text-center text-muted-foreground">
								ログインは完了しています。右上のスペース切り替えメニューから
								作業するサークル/イベントを選択してください。
							</p>
							<div className="space-y-2">
								{spaces.map((m: any) => (
									<div
										key={m.id}
										className="border-thin border-border p-3 font-mono text-[12px] flex items-center justify-between"
									>
										<span>{m.circle?.name || m.event?.eventName || "システム"}</span>
										<span className="text-muted-foreground">{roleLabel(m.role)}</span>
									</div>
								))}
							</div>
						</>
					) : (
						<p className="font-mono text-[13px] text-center text-muted-foreground">
							まだどのサークル/イベントにも所属していません。
							サークルを新規作成するか、管理者から招待リンクを受け取ってください。
						</p>
					)}
					<div className="flex flex-col gap-2 pt-2">
						<Button className="w-full" onClick={() => navigate("/")}>
							トップへ戻る
						</Button>
						<Button
							variant="outline"
							className="w-full"
							onClick={() => {
								authClient.signOut({
									fetchOptions: {
										onSuccess: () => navigate(0),
									},
								});
							}}
						>
							別のアカウントでログイン
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-sp-3 md:p-sp-5 bg-muted">
			<div className="w-full max-w-lg p-sp-5 bg-background border-heavy border-border text-foreground">
				<SignInForm />
			</div>
		</div>
	);
}

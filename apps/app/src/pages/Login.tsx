import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import SignInForm from "@/components/sign-in-form";
import { authClient } from "@/lib/auth-client";
import { useMySpaces, getAuthInfo, resolveActiveSpaceAfterAuth } from "@/hooks/useCircleAuth";
import { roleLabel } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/FormField";
import Loader from "@/components/loader";

// Next.js app/login/page.tsx から移植 (2026-07-04)。
// Next の useSearchParams 用 Suspense 境界は不要なので除去。
// 2026-07-07 (Phase 3b): 独自PIN認証タブ (CircleLoginOnlyForm) を撤去し、
// better-auth ログイン一本にした。
// 2026-07-12: 通常のログイン・サインアップは Google + パスキーに限定。
// 2026-09-27: ローカル確認用途だけ、開発環境と明示フラグの両方が有効な時に
// email/password controls を追加する (本番のログイン手段は増やさない)。
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
				if (resolved.kind !== "none") {
					navigate(resolved.path);
				} else {
					// 所属ゼロ → 行き止まりにせずオンボーディング(サークル作成)へ送る
					navigate("/onboarding", { replace: true });
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
						// 所属ゼロは上の useEffect が /onboarding へリダイレクトするため、
						// ここは遷移待ちの一瞬だけ表示される。行き止まり文言は出さない。
						<Loader />
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
				{import.meta.env.DEV && import.meta.env.VITE_ENABLE_LOCAL_AUTH === "true" && (
					<LocalPasswordAuth />
				)}
			</div>
		</div>
	);
}

// 2026-09-27: email/password は開発用の明示フラグが両方有効な時だけ表示する。
// 本番のログイン導線を増やさず、ローカル seed アカウントの確認を可能にする。
function LocalPasswordAuth() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const requestedCallback = searchParams.get("callbackUrl") ?? searchParams.get("url");
	// Local auth can only return to an app-local path; reject protocol-relative and backslash paths.
	const callbackUrl = requestedCallback?.startsWith("/") && !requestedCallback.startsWith("//") && !requestedCallback.includes("\\")
		? requestedCallback
		: null;
	const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const submitLockRef = useRef(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (submitLockRef.current) return;
		setError("");
		setSuccess("");
		const normalizedEmail = email.trim().toLowerCase();
		if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
			setError("有効なメールアドレスを入力してください。");
			return;
		}
		if (mode === "sign-up" && !name.trim()) {
			setError("名前を入力してください。");
			return;
		}
		if (password.length < 8) {
			setError("パスワードは8文字以上で入力してください。");
			return;
		}

		submitLockRef.current = true;
		setPending(true);
		try {
			const result = mode === "sign-in"
				? await authClient.signIn.email({ email: normalizedEmail, password, callbackURL: callbackUrl ?? undefined })
				: await authClient.signUp.email({ name: name.trim(), email: normalizedEmail, password, callbackURL: callbackUrl ?? undefined });
			if (result.error) {
				setError(result.error.message || (mode === "sign-in" ? "ログインできませんでした。" : "アカウントを作成できませんでした。"));
				return;
			}

			const current = await authClient.getSession();
			if (!current.data?.user?.email) {
				setSuccess("アカウントを作成しました。続けてログインしてください。");
				setMode("sign-in");
				setPassword("");
				return;
			}
			const resolved = await resolveActiveSpaceAfterAuth(current.data.user.email);
			navigate(callbackUrl || (resolved.kind === "none" ? "/onboarding" : resolved.path), { replace: true });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "認証に失敗しました。入力内容を確認して再試行してください。");
		} finally {
			submitLockRef.current = false;
			setPending(false);
		}
	};

	return (
		<section className="mt-6 border-t-thick border-border pt-4 font-mono">
			<h3 className="text-xs font-bold uppercase tracking-wide">ローカル開発用のメール認証</h3>
			<p className="mt-1 text-[11px] text-muted-foreground">この欄は開発環境で明示的に有効化した場合のみ表示されます。</p>
			<form className="mt-4 space-y-3" onSubmit={submit}>
				{mode === "sign-up" && (
					<FormField id="local-auth-name" label="名前" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} disabled={pending} required />
				)}
				<FormField id="local-auth-email" label="メールアドレス" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} required />
				<FormField id="local-auth-password" label="パスワード" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} minLength={8} required />
				{error && <p role="alert" className="border-thin border-destructive bg-destructive/5 p-2 text-[11px] text-destructive">{error}</p>}
				{success && <p role="status" className="border-thin border-success bg-success/5 p-2 text-[11px] text-success">{success}</p>}
				<Button type="submit" disabled={pending} className="w-full border-thick border-primary bg-primary font-mono text-xs font-bold uppercase text-primary-foreground hover:bg-background hover:text-foreground">
					{pending ? "処理中…" : mode === "sign-in" ? "ローカルログイン" : "ローカルアカウントを作成"}
				</Button>
			</form>
			<button
				type="button"
				disabled={pending}
				onClick={() => { setMode((current) => current === "sign-in" ? "sign-up" : "sign-in"); setError(""); setSuccess(""); }}
				className="mt-3 w-full text-center text-[11px] underline underline-offset-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
			>
				{mode === "sign-in" ? "ローカルアカウントを新規作成" : "ログインに戻る"}
			</button>
		</section>
	);
}

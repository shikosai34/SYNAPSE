import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { eventApi, circleApi, membershipApi, type InviteLookupResult } from "@/lib/api";
import { resolveActiveSpaceAfterAuth, useMySpaces } from "@/hooks/useCircleAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Loader from "@/components/loader";

// スタッフ用オンボーディング (2026-07-12 SaaS 分岐版)
// 所属ゼロの新規アカウントに「イベントを主催する / サークルで出店する(招待コード)」を選ばせる。
// - イベント主催: 無料枠(1サークル)のイベントを作成し event_manager になる → イベント管理へ。
// - サークル出店: イベントの招待コード/リンクを要求し、
//   - circle_host 招待 → そのイベント配下にサークルを新規作成して circle_manager に。
//   - circle_member / event_manager 招待 → その場で受諾して適切な権限で参加。
// URL ?inviteToken= が付いていれば join モードで自動照会する(招待リンク着地時に使う)。
type Mode = "choose" | "host" | "join";

export default function StaffOnboarding() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const presetToken = searchParams.get("inviteToken");
	const { data: session, isPending: sessionPending } = authClient.useSession();

	// 既に所属があるアカウントはオンボーディング不要。所属を解決して送り返す。
	const { data: spaces } = useMySpaces();
	useEffect(() => {
		if (spaces && spaces.length > 0 && session?.user?.email) {
			resolveActiveSpaceAfterAuth(session.user.email)
				.then((r) => {
					if (r.kind !== "none") navigate(r.path, { replace: true });
				})
				.catch(() => {});
		}
	}, [spaces, session?.user?.email, navigate]);

	const [mode, setMode] = useState<Mode>(presetToken ? "join" : "choose");

	// ── イベント主催 ───────────────────────────────────────────────
	const [eventName, setEventName] = useState("");
	const createEvent = useMutation({
		mutationFn: () => eventApi.create({ eventName: eventName.trim() }),
		onSuccess: async () => {
			toast.success("イベントを作成しました");
			await goToResolvedSpace();
		},
		onError: (e: any) => toast.error(e?.message || "イベントの作成に失敗しました"),
	});

	// ── 招待経由 ───────────────────────────────────────────────────
	const [codeInput, setCodeInput] = useState("");
	const [lookup, setLookup] = useState<InviteLookupResult | null>(null);
	const [circleName, setCircleName] = useState("");

	const doLookup = useMutation({
		mutationFn: (params: { token?: string; code?: string }) => membershipApi.inviteLookup(params),
		onSuccess: (res) => {
			if (!res.valid) {
				toast.error(res.reason || "この招待は使用できません");
				return;
			}
			setLookup(res);
		},
		onError: (e: any) => toast.error(e?.message || "招待の照会に失敗しました"),
	});

	// URL に inviteToken があれば自動照会
	useEffect(() => {
		if (presetToken && !lookup && !doLookup.isPending) {
			doLookup.mutate({ token: presetToken });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [presetToken]);

	// circle_member / event_manager 招待をその場で受諾
	const acceptInvite = useMutation({
		mutationFn: () =>
			membershipApi.acceptInvite({
				token: lookup!.token,
				userName: session?.user?.name || session?.user?.email || "メンバー",
			}),
		onSuccess: async () => {
			toast.success("参加しました");
			await goToResolvedSpace();
		},
		onError: (e: any) => toast.error(e?.message || "参加に失敗しました"),
	});

	// circle_host 招待でサークルを新規作成
	const createCircle = useMutation({
		mutationFn: () =>
			circleApi.create({
				eventId: lookup!.eventId!,
				name: circleName.trim(),
				inviteToken: lookup!.token,
			}),
		onSuccess: async () => {
			toast.success("サークルを作成しました");
			await goToResolvedSpace();
		},
		onError: (e: any) => toast.error(e?.message || "サークルの作成に失敗しました"),
	});

	async function goToResolvedSpace() {
		try {
			const email = session?.user?.email;
			if (email) {
				const resolved = await resolveActiveSpaceAfterAuth(email);
				navigate(resolved.path, { replace: true });
				return;
			}
		} catch {
			/* fall through */
		}
		navigate("/login", { replace: true });
	}

	if (sessionPending) return <Loader />;
	if (!session?.user) {
		navigate("/login", { replace: true });
		return <Loader />;
	}

	const displayName = session.user.name || session.user.email;

	return (
		<div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-sp-3 md:p-sp-5 bg-muted">
			<div className="w-full max-w-2xl p-sp-5 bg-background border-heavy border-border text-foreground space-y-5">
				<div className="space-y-2">
					<h1 className="text-[26px] font-headline uppercase tracking-tight leading-[1.1]">
						ようこそ、{displayName} さん
					</h1>
					<p className="font-mono text-[13px] text-muted-foreground leading-[1.6]">
						FesFlow をどう使い始めるか選んでください。
					</p>
				</div>

				{/* ── 選択画面 ── */}
				{mode === "choose" && (
					<div className="grid grid-cols-1 gap-3">
						<button
							type="button"
							onClick={() => setMode("host")}
							className="text-left p-4 border-thick border-border hover:border-foreground transition-colors"
						>
							<div className="font-headline text-[18px] uppercase">イベントを主催する</div>
							<div className="font-mono text-[12px] text-muted-foreground mt-1 leading-[1.6]">
								学園祭やイベントの主催者はこちら。無料プランで始められます(サークルは1つまで。
								上限はあとから拡張できます)。あなたがイベント管理者になります。
							</div>
						</button>
						<button
							type="button"
							onClick={() => setMode("join")}
							className="text-left p-4 border-thick border-border hover:border-foreground transition-colors"
						>
							<div className="font-headline text-[18px] uppercase">サークルで出店する</div>
							<div className="font-mono text-[12px] text-muted-foreground mt-1 leading-[1.6]">
								出店するサークルの方はこちら。主催者から受け取った<strong className="text-foreground">招待コード</strong>
								または招待リンクが必要です。
							</div>
						</button>
					</div>
				)}

				{/* ── イベント主催 ── */}
				{mode === "host" && (
					<div className="space-y-4">
						<div className="space-y-1">
							<Label htmlFor="eventName">イベント名</Label>
							<Input
								id="eventName"
								value={eventName}
								onChange={(e) => setEventName(e.target.value)}
								placeholder="例: 第50回 志功祭"
							/>
						</div>
						<div className="border-thin border-border bg-muted/30 p-3 font-mono text-[12px] text-muted-foreground leading-[1.6]">
							無料プランで作成されます(サークル1つまで)。作成後、イベント管理画面から
							サークルの招待や設定ができます。プランのアップグレードは運営にお問い合わせください。
						</div>
						<div className="flex gap-2">
							<Button variant="outline" onClick={() => setMode("choose")}>
								戻る
							</Button>
							<Button
								className="flex-1"
								disabled={!eventName.trim() || createEvent.isPending}
								onClick={() => createEvent.mutate()}
							>
								{createEvent.isPending ? "作成中..." : "イベントを作成する"}
							</Button>
						</div>
					</div>
				)}

				{/* ── 招待経由 ── */}
				{mode === "join" && (
					<div className="space-y-4">
						{!lookup ? (
							<>
								<div className="space-y-1">
									<Label htmlFor="code">招待コード</Label>
									<Input
										id="code"
										value={codeInput}
										onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
										placeholder="例: ABCD2345"
										autoCapitalize="characters"
									/>
									<p className="font-mono text-[11px] text-muted-foreground">
										主催者から受け取った招待リンクをお持ちの場合は、そのリンクを直接開いてください。
									</p>
								</div>
								<div className="flex gap-2">
									<Button variant="outline" onClick={() => setMode("choose")}>
										戻る
									</Button>
									<Button
										className="flex-1"
										disabled={!codeInput.trim() || doLookup.isPending}
										onClick={() => doLookup.mutate({ code: codeInput.trim() })}
									>
										{doLookup.isPending ? "確認中..." : "招待を確認する"}
									</Button>
								</div>
							</>
						) : lookup.kind === "circle_host" ? (
							// circle_host: そのイベント配下にサークルを作成
							<div className="space-y-4">
								<div className="border-thin border-border bg-muted/30 p-3 font-mono text-[12px] leading-[1.6]">
									<strong className="text-foreground">{lookup.eventName || "イベント"}</strong>{" "}
									への出店招待です。サークルを作成するとあなたがサークル管理者になります。
								</div>
								<div className="space-y-1">
									<Label htmlFor="circleName">サークル名</Label>
									<Input
										id="circleName"
										value={circleName}
										onChange={(e) => setCircleName(e.target.value)}
										placeholder="例: たこ焼き 茨香庵"
									/>
								</div>
								<div className="flex gap-2">
									<Button variant="outline" onClick={() => setLookup(null)}>
										戻る
									</Button>
									<Button
										className="flex-1"
										disabled={!circleName.trim() || createCircle.isPending}
										onClick={() => createCircle.mutate()}
									>
										{createCircle.isPending ? "作成中..." : "サークルを作成して始める"}
									</Button>
								</div>
							</div>
						) : (
							// circle_member / event_manager: その場で受諾
							<div className="space-y-4">
								<div className="border-thin border-border bg-muted/30 p-3 font-mono text-[12px] leading-[1.6]">
									<strong className="text-foreground">
										{lookup.circleName || lookup.eventName || "スペース"}
									</strong>{" "}
									への招待です({roleLabel(lookup.kind)}として参加)。
								</div>
								<div className="flex gap-2">
									<Button variant="outline" onClick={() => setLookup(null)}>
										戻る
									</Button>
									<Button
										className="flex-1"
										disabled={acceptInvite.isPending}
										onClick={() => acceptInvite.mutate()}
									>
										{acceptInvite.isPending ? "参加中..." : "参加する"}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				<div className="pt-2 border-t border-border">
					<button
						type="button"
						onClick={() =>
							authClient.signOut({
								fetchOptions: { onSuccess: () => navigate("/login", { replace: true }) },
							})
						}
						className="text-accent underline font-mono text-[12px] uppercase tracking-[1px] hover:text-foreground"
					>
						別のアカウントでログイン
					</button>
				</div>
			</div>
		</div>
	);
}

function roleLabel(kind: string): string {
	switch (kind) {
		case "event_manager":
			return "イベント管理者";
		case "circle_member":
			return "サークルスタッフ";
		default:
			return "メンバー";
	}
}

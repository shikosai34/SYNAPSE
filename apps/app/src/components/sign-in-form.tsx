import { authClient } from "@/lib/auth-client";
import { visitorUrl } from "@/lib/visitor-url";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import z from "zod";
import Loader from "./loader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useSearchParams, useNavigate } from "react-router-dom";
import { resolveActiveSpaceAfterAuth } from "@/hooks/useCircleAuth";

export default function SignInForm({
	onSwitchToSignUp,
}: {
	onSwitchToSignUp: () => void;
}) {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const callbackUrl = searchParams.get("url");
	const { isPending } = authClient.useSession();

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.signIn.email(
				{
					email: value.email,
					password: value.password,
				},
				{
					onSuccess: async () => {
						try {
							// 所属解決とアクティブスペース確定は sign-up-form と共通化した
							// (2026-07-09 サインアップ後にスペース未所属表示になる不具合の修正に伴い集約)
							const resolved = await resolveActiveSpaceAfterAuth(value.email);
							const m = resolved.membership;
							switch (resolved.kind) {
								case "system":
									toast.success(`システム管理スペースにログインしました (${m.role})`);
									break;
								case "event":
									toast.success(`イベント管理スペースにログインしました (${m.role})`);
									break;
								case "circle":
									toast.success(`${m.userName}さんとして [${m.circle?.name || "サークル"}] にログインしました`);
									break;
								default:
									// 所属が無いアカウントはスタッフ画面に居場所が無いため来場者アプリへ
									toast.success("ログインしました");
							}
							navigate((callbackUrl as any) || resolved.path);
						} catch (error) {
							toast.success("ログインしました");
							navigate((callbackUrl as any) || "/mypage");
						}
					},
					onError: (error) => {
						toast.error(error.error.message || error.error.statusText);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				email: z.email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
	});

	if (isPending) {
		return <Loader />;
	}

	return (
		<div className="mx-auto w-full mt-sp-3">
			<h2 className="mb-sp-4 text-center text-[24px] font-headline uppercase tracking-tight leading-[1.1]">
				Welcome Back
			</h2>

			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="space-y-5"
			>
				<div>
					<form.Field name="email">
						{(field) => (
							<div className="space-y-1">
								<Label htmlFor={field.name}>Email</Label>
								<Input
									id={field.name}
									name={field.name}
									type="email"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-error font-mono text-[12px] font-bold mt-[4px]">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<div>
					<form.Field name="password">
						{(field) => (
							<div className="space-y-1">
								<Label htmlFor={field.name}>Password</Label>
								<Input
									id={field.name}
									name={field.name}
									type="password"
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
								{field.state.meta.errors.map((error) => (
									<p key={error?.message} className="text-error font-mono text-[12px] font-bold mt-[4px]">
										{error?.message}
									</p>
								))}
							</div>
						)}
					</form.Field>
				</div>

				<form.Subscribe>
					{(state) => (
						<Button
							type="submit"
							className="w-full"
							size="lg"
							disabled={!state.canSubmit || state.isSubmitting}
						>
							{state.isSubmitting ? "Submitting..." : "Sign In"}
						</Button>
					)}
				</form.Subscribe>
			</form>

			<div className="mt-6 flex flex-col gap-3">
				<div className="relative">
					<div className="absolute inset-0 flex items-center">
						<span className="w-full border-t border-border" />
					</div>
					<div className="relative flex justify-center text-xs uppercase">
						<span className="bg-background px-2 text-muted-foreground font-mono font-bold tracking-widest">or</span>
					</div>
				</div>
				<Button
					type="button"
					variant="outline"
					className="w-full font-mono text-sm uppercase tracking-widest flex items-center justify-center gap-2"
					onClick={async () => {
						try {
							await authClient.signIn.passkey({
								fetchOptions: {
									onSuccess: async () => {
										// login success handler will be triggered by session state change or we can manually route
										navigate((callbackUrl as any) || "/circle/dashboard"); // wait, maybe better to just use URL or let Login.tsx handle space selection
									},
									onError: (error) => {
										toast.error(error.error.message || error.error.statusText);
									},
								}
							});
						} catch (e: any) {
							toast.error(e.message || "パスキーでのログインに失敗しました");
						}
					}}
				>
					Sign in with Passkey
				</Button>
			</div>

			<div className="mt-sp-4 text-center">
				<button
					type="button"
					onClick={onSwitchToSignUp}
					className="text-accent underline font-mono text-[12px] uppercase tracking-[1px] hover:text-foreground"
				>
					Need an account? Sign Up
				</button>
			</div>
		</div>
	);
}

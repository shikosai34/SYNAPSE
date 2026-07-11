import { authClient } from "@/lib/auth-client";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import z from "zod";
import { useState } from "react";
import Loader from "./loader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useSearchParams, useNavigate } from "react-router-dom";
import { resolveActiveSpaceAfterAuth } from "@/hooks/useCircleAuth";

export default function SignUpForm({
	onSwitchToSignIn,
}: {
	onSwitchToSignIn: () => void;
}) {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const callbackUrl = searchParams.get("url");
	const { isPending } = authClient.useSession();

	// サインアップ直後は「メール認証→パスキー作成」の理想フローに沿って、
	// すぐ次の画面へ遷移させず一旦パスキー登録を促す画面を挟む
	// (2026-07-07 Phase 3b パスキー導線)。
	const [justSignedUp, setJustSignedUp] = useState(false);
	// goNext で所属解決するためにサインアップしたメールを保持する
	const [signedUpEmail, setSignedUpEmail] = useState("");

	// 2026-07-09: 以前は無条件で /circle/dashboard へ直行していたため、super_admin 等
	// でサインアップしても circleAuth 未設定のまま CircleAuthGuard に弾かれ、/login の
	// スペース選択で所属未確定状態に落ちていた。sign-in と同じ所属解決を通して、
	// アクティブスペースを確定してから適切な遷移先へ送る。
	const goNext = async () => {
		try {
			const resolved = await resolveActiveSpaceAfterAuth(signedUpEmail);
			navigate((callbackUrl as any) || resolved.path);
		} catch {
			navigate((callbackUrl as any) || "/visitor/mypage");
		}
	};

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
			name: "",
		},
		onSubmit: async ({ value }) => {
			await authClient.signUp.email(
				{
					email: value.email,
					password: value.password,
					name: value.name,
				},
				{
					onSuccess: () => {
						toast.success("Sign up successful");
						setSignedUpEmail(value.email);
						setJustSignedUp(true);
					},
					onError: (error) => {
						toast.error(error.error.message || error.error.statusText);
					},
				},
			);
		},
		validators: {
			onSubmit: z.object({
				name: z.string().min(2, "Name must be at least 2 characters"),
				email: z.email("Invalid email address"),
				password: z.string().min(8, "Password must be at least 8 characters"),
			}),
		},
	});

	if (isPending) {
		return <Loader />;
	}

	if (justSignedUp) {
		return (
			<div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-sp-4 md:p-sp-5 bg-muted">
				<div className="w-full max-w-lg p-sp-5 bg-background border-heavy border-border text-foreground space-y-5">
					<h1 className="text-center text-[28px] font-headline uppercase tracking-tight leading-[1.1]">
						パスキーを登録しますか？
					</h1>
					<p className="font-mono text-[13px] text-center text-muted-foreground leading-[1.6]">
						パスキーを登録すると、次回からパスワード無しで素早くログインできます。
						後からアカウント画面でも登録できます。
					</p>
					<Button
						type="button"
						className="w-full"
						size="lg"
						onClick={async () => {
							try {
								const res = await authClient.passkey.addPasskey({
									fetchOptions: {
										onError(ctx) {
											toast.error(ctx.error.message || "パスキーの追加に失敗しました");
										},
									},
								});
								if (res?.data) {
									toast.success("パスキーを登録しました");
								}
							} catch (e: any) {
								toast.error(e.message || "予期せぬエラーが発生しました");
							} finally {
								goNext();
							}
						}}
					>
						パスキーを登録する
					</Button>
					<button
						type="button"
						onClick={goNext}
						className="w-full text-center text-accent underline font-mono text-[12px] uppercase tracking-[1px] hover:text-foreground"
					>
						後で登録する (スキップ)
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-sp-4 md:p-sp-5 bg-muted">
			<div className="w-full max-w-lg p-sp-5 bg-background border-heavy border-border text-foreground">
				<h1 className="mb-sp-4 text-center text-[32px] font-headline uppercase tracking-tight leading-[1.1]">
					Create Account
				</h1>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
					className="space-y-5"
				>
					<div>
						<form.Field name="name">
							{(field) => (
								<div className="space-y-1">
									<Label htmlFor={field.name}>Name</Label>
									<Input
										id={field.name}
										name={field.name}
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
								{state.isSubmitting ? "Submitting..." : "Sign Up"}
							</Button>
						)}
					</form.Subscribe>
				</form>

				<div className="mt-sp-4 text-center">
					<button
						type="button"
						onClick={onSwitchToSignIn}
						className="text-accent underline font-mono text-[12px] uppercase tracking-[1px] hover:text-foreground"
					>
						Already have an account? Sign In
					</button>
				</div>
			</div>
		</div>
	);
}

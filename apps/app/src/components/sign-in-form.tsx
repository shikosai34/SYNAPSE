import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import Loader from "./loader";
import { Button } from "./ui/button";
import { useSearchParams, useNavigate } from "react-router-dom";
import { resolveActiveSpaceAfterAuth } from "@/hooks/useCircleAuth";
import { GoogleSignInButton } from "./social-sign-in";

// 2026-07-12: メール/パスワードによるログインを廃止し、Google + パスキーのみに絞った。
// 背景: メールサインアップ/ログインを段階的に廃し、Google(/将来 Apple) + パスキーへ寄せる方針。
// - メールは送信基盤が無く確認/リセットも回らないため、資格情報としての価値が薄い。
// - 認可(membership)は email をキーに解決されるので、同じメールの Google ログインで
//   既存スタッフ/super_admin の所属はそのまま引き継がれる(better-auth 側の account linking で
//   既存アカウントにも Google が紐付く)。
// これに伴い旧サインアップフォーム(sign-up-form)も撤去し、アカウント作成は Google 初回ログインが担う。
export default function SignInForm() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const callbackUrl = searchParams.get("url");
	const { isPending } = authClient.useSession();

	if (isPending) {
		return <Loader />;
	}

	return (
		<div className="mx-auto w-full mt-sp-3">
			<h2 className="mb-sp-4 text-center text-[24px] font-headline uppercase tracking-tight leading-[1.1]">
				Welcome Back
			</h2>

			<p className="mb-sp-4 font-mono text-[12px] text-center text-muted-foreground leading-[1.6]">
				Google またはパスキーでログインしてください。
				<br />
				初めての方は Google ログインでアカウントが作成されます。
			</p>

			<div className="flex flex-col gap-3">
				<GoogleSignInButton deepLink={callbackUrl} />
				<Button
					type="button"
					variant="outline"
					className="w-full font-mono text-sm uppercase tracking-widest flex items-center justify-center gap-2"
					onClick={async () => {
						try {
							await authClient.signIn.passkey({
								fetchOptions: {
									onSuccess: async () => {
										// パスキーは主要ログイン手段になったので、メール導線と同様に
										// 所属解決してスペースへ送る(旧: /circle/dashboard 固定だった)。
										try {
											const s = await authClient.getSession();
											const email = s?.data?.user?.email;
											if (email) {
												const resolved = await resolveActiveSpaceAfterAuth(email);
												navigate((callbackUrl as any) || resolved.path);
												return;
											}
										} catch {
											// 解決失敗時は /login に戻し、Login.tsx 側の自動解決/案内に委ねる
										}
										navigate((callbackUrl as any) || "/login");
									},
									onError: (error) => {
										toast.error(error.error.message || error.error.statusText);
									},
								},
							});
						} catch (e: any) {
							toast.error(e.message || "パスキーでのログインに失敗しました");
						}
					}}
				>
					Sign in with Passkey
				</Button>
			</div>
		</div>
	);
}

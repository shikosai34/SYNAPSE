import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { membershipApi } from "@/lib/api";
import { resolveActiveSpaceAfterAuth } from "@/hooks/useCircleAuth";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Loader from "@/components/loader";
import { CheckCircle, XCircle, UserPlus, LogIn } from "lucide-react";

// 招待受諾ページ (/circle/invite/:token, /event/invite/:token 共通)。
// 2026-07-12 (SaaS): 招待種別を lookup で判定して分岐する。
// - circle_host 招待 → サークル作成が必要なのでオンボーディングへ委譲。
// - circle_member / event_manager 招待 → その場で受諾し、所属を解決して適切なスペースへ。
// 未ログインなら better-auth ログインへ誘導し、callbackUrl でこのページに戻す
// (Google ログインは callbackUrl をそのまま OAuth の戻り先にするため招待が引き継がれる)。
export default function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [userName, setUserName] = useState("");

  useEffect(() => {
    if (session?.user?.name) setUserName((prev) => prev || session.user.name);
  }, [session]);

  // ログイン済みなら招待を照会して種別を判定する
  const lookup = useQuery({
    queryKey: ["invite-lookup", token],
    queryFn: () => membershipApi.inviteLookup({ token }),
    enabled: !!session?.user && !!token,
    retry: false,
  });

  // circle_host はサークル作成が必要 → オンボーディングへ (token を引き継ぐ)
  useEffect(() => {
    if (lookup.data?.kind === "circle_host") {
      navigate(`/onboarding?inviteToken=${encodeURIComponent(token)}`, { replace: true });
    }
  }, [lookup.data?.kind, navigate, token]);

  const acceptInviteMutation = useMutation({
    mutationFn: () => membershipApi.acceptInvite({ token, userName: userName.trim() }),
    onSuccess: async () => {
      setSuccess(true);
      // 実際の所属を解決してスペースへ (旧: /circle/dashboard 固定)
      try {
        const email = session?.user?.email;
        if (email) {
          const resolved = await resolveActiveSpaceAfterAuth(email);
          setTimeout(() => navigate(resolved.path, { replace: true }), 1200);
          return;
        }
      } catch {
        /* fall through */
      }
      setTimeout(() => navigate("/login", { replace: true }), 1200);
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    acceptInviteMutation.mutate();
  };

  if (sessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  // 未ログイン: better-auth ログインへ。callbackUrl でこのページへ戻す。
  if (!session) {
    const callbackUrl = encodeURIComponent(`/circle/invite/${token}`);
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <UserPlus className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>スペースへの招待</CardTitle>
            <CardDescription>
              招待を受け取るには、まずログイン（またはアカウント作成）してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate(`/login?callbackUrl=${callbackUrl}`)}>
              <LogIn className="h-4 w-4 mr-2" />
              ログイン / アカウント作成へ進む
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 mx-auto text-success" />
              <h2 className="text-2xl font-bold">参加完了！</h2>
              <p className="text-muted-foreground">参加が完了しました。移動します...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // circle_host は上の effect でリダイレクト中
  if (lookup.isLoading || lookup.data?.kind === "circle_host") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (lookup.isError || (lookup.data && !lookup.data.valid)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <XCircle className="h-14 w-14 mx-auto text-destructive" />
            <p className="text-muted-foreground">
              {/* サーバの具体的なエラー文言をそのまま表示する (P2-8)。原因(未存在/期限切れ/上限)が分かるように。 */}
              {lookup.data?.reason ||
                (lookup.error as Error | undefined)?.message ||
                "無効または期限切れの招待です。"}
            </p>
            <Button variant="outline" onClick={() => navigate("/onboarding")}>
              オンボーディングへ
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const spaceName = lookup.data?.circleName || lookup.data?.eventName || "スペース";

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <UserPlus className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{spaceName} への招待</CardTitle>
          <CardDescription>{session.user.email} として参加します</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">お名前（表示名）</Label>
              <Input
                id="name"
                placeholder="山田太郎"
                required
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
                <XCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={acceptInviteMutation.isPending || !userName.trim()}
            >
              {acceptInviteMutation.isPending ? "参加中..." : "参加する"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

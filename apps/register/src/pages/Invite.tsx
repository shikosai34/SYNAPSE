
import { useState, useEffect } from "react";
import { useRouter, useParams } from "@/lib/next-navigation";
import { useMutation } from "@tanstack/react-query";
import { membershipApi } from "@/lib/api";
import { saveAuthInfo, type RoleType } from "@/hooks/useCircleAuth";
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
import { CheckCircle, XCircle, UserPlus } from "lucide-react";

export default function InvitePage() {
  // react-router の動的セグメント /invite/:token から取得 (旧 Next の use(params) を置換)
  const { token = "" } = useParams();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    userEmail: "",
    userName: "",
    userId: "",
    pin: "",
  });

  const acceptInviteMutation = useMutation({
    mutationFn: async (input: {
      token: string;
      userEmail: string;
      userName: string;
      pin?: string;
    }) => {
      return await membershipApi.acceptInvite(input);
    },
    onSuccess: (data) => {
      // 認証情報を保存
      saveAuthInfo({
        circleId: null, // 後で取得する
        eventId: null,
        userEmail: formData.userEmail,
        userName: formData.userName,
        role: "viewer" as RoleType, // デフォルト
        membershipId: data.membershipId,
      });
      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  useEffect(() => {
    // トークンの検証は実際にはサーバー側で行う
    // ここでは単純にUIを表示
    setIsLoading(false);
  }, [token]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    acceptInviteMutation.mutate({
      token,
      userEmail: formData.userEmail,
      userName: formData.userName,
      pin: formData.pin || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
              <h2 className="text-2xl font-bold">参加完了！</h2>
              <p className="text-muted-foreground">
                サークルへの参加が完了しました。 ダッシュボードへ移動します...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <UserPlus className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>サークルへの招待</CardTitle>
          <CardDescription>招待リンクからサークルに参加します</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                placeholder="example@email.com"
                required
                value={formData.userEmail}
                onChange={(e) =>
                  setFormData({ ...formData, userEmail: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">お名前</Label>
              <Input
                id="name"
                placeholder="山田太郎"
                required
                value={formData.userName}
                onChange={(e) =>
                  setFormData({ ...formData, userName: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pin">PIN（オプション）</Label>
              <Input
                id="pin"
                type="password"
                placeholder="簡易ログイン用の4-6桁の数字"
                value={formData.pin}
                onChange={(e) =>
                  setFormData({ ...formData, pin: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                PINを設定すると、次回から簡単にログインできます
              </p>
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
              disabled={acceptInviteMutation.isPending}
            >
              {acceptInviteMutation.isPending ? (
                <>
                  <Loader />
                  <span className="ml-2">参加中...</span>
                </>
              ) : (
                "参加する"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

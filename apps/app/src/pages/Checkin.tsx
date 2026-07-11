
import { useEffect, useState, Suspense } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { visitorUrl } from "@/lib/visitor-url";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { wristbandApi } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { QrCode, ShieldCheck, ArrowRight, UserCheck } from "lucide-react";

function CheckinContent() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const wristbandIdParam = searchParams.get("wb");
  
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const userId = session?.user?.id;
  
  const [isSuccess, setIsSuccess] = useState(false);

  // 未ログインの場合は強制的にログイン画面へリダイレクト
  useEffect(() => {
    if (!isSessionPending && !session) {
      const currentUrl = `${pathname}?${searchParams.toString()}`;
      navigate(`/login?callbackUrl=${encodeURIComponent(currentUrl)}`);
    }
  }, [session, isSessionPending, navigate, pathname, searchParams]);

  const registerMutation = useMutation({
    mutationFn: async (wbId: string) => {
      if (!userId) throw new Error("ユーザーが認証されていません");
      return await wristbandApi.register(userId, wbId);
    },
    onSuccess: () => {
      toast.success("来場チェックインが完了しました！");
      setIsSuccess(true);
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["userWristbandStatus", userId] });
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "チェックインに失敗しました");
    },
  });

  // リストバンドパラメーターがあり、正式ユーザーIDが読み込まれたら自動紐付け試行
  useEffect(() => {
    if (wristbandIdParam && userId && !isSuccess && !registerMutation.isPending && !registerMutation.isSuccess) {
      registerMutation.mutate(wristbandIdParam);
    }
  }, [wristbandIdParam, userId]);

  if (isSessionPending || !session || (wristbandIdParam && registerMutation.isPending)) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4 font-mono text-center pt-20">
        <Skeleton className="h-16 w-16 rounded-full mx-auto" />
        <Skeleton className="h-8 w-64 mx-auto" />
        <p className="text-sm text-gray-500 uppercase tracking-widest animate-pulse">
          {isSessionPending || !session ? "アカウント認証を確認中..." : "チェックイン認証＆リストバンド連携中..."}
        </p>
      </div>
    );
  }

  if (!wristbandIdParam) {
    return (
      <div className="max-w-md mx-auto p-4 pt-16 font-mono text-center space-y-6">
        <div className="border-heavy border-border bg-background p-8 space-y-4">
          <QrCode className="h-16 w-16 mx-auto text-foreground" />
          <h1 className="text-2xl font-black uppercase">[来場時チェックイン]</h1>
          <p className="text-xs text-muted-foreground">
            リストバンドのQRコードをスマートフォンでスキャンしてアクセスしてください。
          </p>
          <Button
            onClick={() => { window.location.href = visitorUrl("/visitor/mypage"); }}
            className="w-full h-12 border-thick border-border bg-primary text-primary-foreground font-bold uppercase rounded-none hover:bg-background hover:text-foreground"
          >
            マイページ（マイQR）へ移動
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 pt-12 font-mono text-center space-y-6">
      <div className="border-heavy border-border bg-primary text-primary-foreground p-8 space-y-6 shadow-[8px_8px_0px_0px_var(--border)]">
        <div className="bg-background text-foreground p-4 inline-block border-thick border-border">
          <UserCheck className="h-16 w-16 text-foreground" />
        </div>

        <div className="space-y-2">
          <span className="bg-background text-foreground px-3 py-1 text-xs font-black uppercase tracking-widest inline-block">
            CHECK-IN SUCCESSFUL
          </span>
          <h1 className="text-3xl font-black uppercase tracking-wider">
            来場チェックイン完了！
          </h1>
          <p className="text-xs text-primary-foreground/80">
            リストバンド (ID: <span className="text-primary-foreground font-bold">{wristbandIdParam}</span>) がアカウントに正常に紐付けられました。
          </p>
        </div>

        <div className="bg-background/10 p-4 border-thin border-border/20 text-xs text-left space-y-2">
          <div className="flex items-center gap-2 text-primary-foreground font-bold">
            <ShieldCheck className="h-4 w-4 text-success" />
            セキュリティ保護有効
          </div>
          <p className="text-primary-foreground/80">
            万が一リストバンドを紛失した場合でも、マイページからいつでもロック・即時無効化が可能です。
          </p>
        </div>

        <Button
          onClick={() => { window.location.href = visitorUrl("/visitor/mypage"); }}
          className="w-full h-14 border-thick border-border bg-background text-foreground text-lg font-black uppercase rounded-none hover:bg-success hover:text-primary-foreground transition-all"
        >
          マイページ（マイQR）へ進む
          <ArrowRight className="ml-2 h-6 w-6" />
        </Button>
      </div>
    </div>
  );
}

export default function CheckinPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto p-4 font-mono text-center pt-20 uppercase">
          読み込み中...
        </div>
      }
    >
      <CheckinContent />
    </Suspense>
  );
}

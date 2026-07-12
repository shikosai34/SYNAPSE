import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { adminApi, type ImpersonationStatus } from "@/lib/api";
import { getAuthInfo, saveAuthInfo } from "@/hooks/useCircleAuth";
import { Eye, X } from "lucide-react";

// なりすまし中の常時バナー (2026-07-12 Phase E)。
// アプリ最上部に固定表示し、誰として表示中か・残り時間・終了ボタンを出す。
// サーバの impersonate/status を唯一の真実として参照する (端末=ログインセッション単位)。
const INACTIVE: ImpersonationStatus = {
  active: false,
  role: null,
  eventId: null,
  circleId: null,
  label: null,
  expiresAt: null,
};

export function ImpersonationBanner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  const { data } = useQuery({
    queryKey: ["impersonation-status"],
    // super_admin 以外は 403 になるため、例外は握りつぶして非表示 (inactive) 扱いにする
    // (グローバル QueryCache.onError のトースト誤発火も防ぐ)。
    queryFn: async () => {
      try {
        return await adminApi.impersonateStatus();
      } catch {
        return INACTIVE;
      }
    },
    enabled: !!session?.user,
    refetchInterval: 30_000,
  });

  const stop = useMutation({
    mutationFn: () => adminApi.impersonateStop(),
    onSuccess: () => {
      // クライアント側のアクティブスペースを super_admin 素の状態へ戻す
      const info = getAuthInfo();
      if (info) {
        saveAuthInfo({ ...info, eventId: null, circleId: null });
      }
      queryClient.invalidateQueries();
      toast.success("なりすましを終了しました");
      navigate("/sys/dashboard", { replace: true });
    },
    onError: (e: any) => toast.error(e?.message || "終了に失敗しました"),
  });

  if (!data?.active) return null;

  const remainMin = data.expiresAt
    ? Math.max(0, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 60000))
    : null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-accent text-accent-foreground px-4 py-2 font-mono text-[12px] border-b-thick border-border">
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="truncate">
          なりすまし表示中: <strong>{data.label || data.role}</strong>
          {data.role ? `（${data.role}）` : ""}
          {remainMin !== null ? ` — 残り約${remainMin}分` : ""}
        </span>
      </div>
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="flex items-center gap-1 border-thick border-current px-2 py-0.5 uppercase font-bold hover:bg-accent-foreground hover:text-accent transition-colors shrink-0"
      >
        <X className="h-3.5 w-3.5" />
        終了
      </button>
    </div>
  );
}

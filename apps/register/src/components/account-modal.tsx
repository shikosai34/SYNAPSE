import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  User,
  LogOut,
  Upload,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { accountApi, uploadImage } from "@/lib/api";
import {
  useAuth,
  getAuthInfo,
  saveAuthInfo,
  clearAuthInfo,
} from "@/hooks/useCircleAuth";
import { authClient } from "@/lib/auth-client";

export type Space = {
  id: string;
  type: "system" | "event" | "circle";
  name: string;
  role: string;
  circleId?: string | null;
  eventId?: string | null;
};

// 合成スペース(super_admin の暗黙アクセス)は退出不可。実メンバーシップのみ id が super_ 以外。
const isRealMembership = (id: string) => !id.startsWith("super_");

export default function AccountModal({
  open,
  onClose,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userName, userEmail } = useAuth();

  // 正本のアカウント情報 (localStorage は image を持たないため API から取得)
  const { data: me } = useQuery({
    queryKey: ["accountMe"],
    queryFn: () => accountApi.me(),
    enabled: open,
  });

  const [name, setName] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // モーダルを開いた/データ取得時にフォーム初期値を同期
  useEffect(() => {
    if (!open) return;
    setName(me?.name ?? userName ?? "");
    setImage(me?.image ?? null);
    setEmail(me?.email ?? userEmail ?? "");
    setConfirmDelete(false);
  }, [open, me, userName, userEmail]);

  // localStorage の authInfo を部分更新して authChange を発火 (ヘッダー表示を即時反映)
  const patchLocalAuth = (patch: { userName?: string | null; userEmail?: string }) => {
    const info = getAuthInfo();
    if (!info) return;
    saveAuthInfo({ ...info, ...patch });
  };

  const profileMutation = useMutation({
    mutationFn: () => accountApi.updateProfile({ name: name.trim(), image }),
    onSuccess: () => {
      patchLocalAuth({ userName: name.trim() });
      queryClient.invalidateQueries({ queryKey: ["accountMe"] });
      queryClient.invalidateQueries({ queryKey: ["mySpaces"] });
      toast.success("プロフィールを更新しました");
    },
    onError: (e: any) => toast.error(e.message || "更新に失敗しました"),
  });

  const emailMutation = useMutation({
    mutationFn: () => accountApi.changeEmail(email.trim()),
    onSuccess: (res) => {
      patchLocalAuth({ userEmail: res.email });
      queryClient.invalidateQueries({ queryKey: ["accountMe"] });
      queryClient.invalidateQueries({ queryKey: ["mySpaces"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("メールアドレスを変更しました");
    },
    onError: (e: any) => toast.error(e.message || "変更に失敗しました"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => accountApi.deleteAccount(),
    onSuccess: () => {
      clearAuthInfo();
      toast.success("アカウントを削除しました");
      onClose();
      navigate("/circle/login");
    },
    onError: (e: any) => toast.error(e.message || "削除に失敗しました"),
  });

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      setImage(res.path);
      toast.success("画像をアップロードしました。保存を押すと反映されます");
    } catch (err: any) {
      toast.error(err.message || "アップロードに失敗しました");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/75 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md border-thin border-border bg-background p-6 shadow-none font-mono rounded-none max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 w-8 h-8 border-thin border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all rounded-none cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-6 border-b-thin border-border pb-3 flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-black uppercase tracking-wider">[アカウント管理]</h2>
        </div>

        {/* プロフィール編集 (アイコン + 名前) */}
        <section className="space-y-3 mb-6">
          <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">[プロフィール]</h3>
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16 border-thin border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0">
              {image ? (
                <img src={image} alt="アイコン" className="w-full h-full object-cover" />
              ) : (
                <User className="h-7 w-7 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <input ref={fileRef} type="file" accept="image/*" onChange={handlePickFile} className="hidden" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[11px] rounded-none border-thin"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                アイコンを変更
              </Button>
              {image && (
                <button
                  type="button"
                  onClick={() => setImage(null)}
                  className="text-[10px] underline text-muted-foreground hover:text-destructive text-left cursor-pointer"
                >
                  アイコンを削除
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">ユーザー名</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-none border-thin h-9 text-sm"
              placeholder="表示名"
            />
          </div>
          <Button
            className="w-full h-9 rounded-none border-thin text-xs uppercase font-black"
            onClick={() => profileMutation.mutate()}
            disabled={profileMutation.isPending || !name.trim()}
          >
            {profileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "プロフィールを保存"}
          </Button>
        </section>

        {/* メールアドレス変更 */}
        <section className="space-y-2 mb-6">
          <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">[メールアドレス]</h3>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-none border-thin h-9 text-sm"
            placeholder="you@example.com"
          />
          <Button
            variant="outline"
            className="w-full h-9 rounded-none border-thin text-xs uppercase font-black"
            onClick={() => emailMutation.mutate()}
            disabled={emailMutation.isPending || !email.trim() || email.trim().toLowerCase() === (me?.email ?? userEmail ?? "").toLowerCase()}
          >
            {emailMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "メールアドレスを変更"}
          </Button>
        </section>

        {/* パスキー設定 */}
        <section className="space-y-2 mb-6">
          <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">[パスキー]</h3>
          <Button
            variant="outline"
            className="w-full h-9 rounded-none border-thin text-xs uppercase font-black flex items-center justify-center gap-2"
            onClick={async () => {
              try {
                const res = await authClient.passkey.addPasskey({
                  fetchOptions: {
                    onError(ctx) {
                      toast.error(ctx.error.message || "パスキーの追加に失敗しました");
                    }
                  }
                });
                if (res?.error) {
                  toast.error(res.error.message || "パスキーの追加に失敗しました");
                } else if (res?.data) {
                  toast.success("パスキーを追加しました");
                }
              } catch (e: any) {
                toast.error(e.message || "予期せぬエラーが発生しました");
              }
            }}
          >
            パスキーを追加する
          </Button>
        </section>

        {/* アクション */}
        <div className="space-y-2 border-t border-border/20 pt-4">
          <Button
            variant="outline"
            className="w-full h-11 border-thin border-border rounded-none flex items-center justify-center gap-2 uppercase font-black"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" />
            ログアウト
          </Button>

          {/* 危険な操作: アカウント削除 (破壊的操作のため独自インラインUIをやめ ConfirmDialog に統一) */}
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center justify-center gap-2 text-[11px] text-muted-foreground hover:text-destructive py-2 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            アカウントを削除
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        title="[確認: アカウントの削除]"
        description="本当に削除しますか？すべての所属・権限が失われ、元に戻せません。"
        confirmLabel="完全に削除する"
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

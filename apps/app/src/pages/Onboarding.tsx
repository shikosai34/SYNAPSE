import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { visitorApi, eventApi, wristbandApi } from "@/lib/api";
import { getVisitor, saveVisitor, useVisitor } from "@/hooks/useVisitor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 来場者オンボーディング / プロフィール編集 (2026-07-04, 2026-07-15 編集モード追加)。
 * 収集はニックネーム + お好きな日付(任意)のみ。日付はリストバンド紛失時の本人確認用。
 *
 * `?edit=1` で開くと同じフォームを「編集」として使う (マイページの[情報を編集]から遷移)。
 * 初回登録と編集で入力項目は同じなので、画面を分けずコピーと遷移先だけ切り替える。
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEdit = searchParams.get("edit") === "1";
  const { isLoaded, isEntered, session, userId } = useVisitor();
  const [nickname, setNickname] = useState("");
  const [favoriteDate, setFavoriteDate] = useState("");

  // 入場前(セッション無し)に直接来たら入場を促す
  useEffect(() => {
    if (isLoaded && !isEntered) {
      navigate("/visitor", { replace: true });
    }
  }, [isLoaded, isEntered, navigate]);

  // 編集モードでは現在のプロフィール(お好きな日付を含む)をサーバから取り出して初期表示する。
  // session はニックネームしか持たないため、日付は lookup から補完する。
  const { data: profile } = useQuery({
    queryKey: ["visitorProfile", userId],
    queryFn: () => wristbandApi.lookup(userId!),
    enabled: isEdit && !!userId,
  });

  useEffect(() => {
    if (profile?.user.nickname) setNickname(profile.user.nickname);
    else if (session?.nickname) setNickname(session.nickname);
  }, [profile?.user.nickname, session?.nickname]);

  useEffect(() => {
    if (profile?.user.favoriteDate) setFavoriteDate(profile.user.favoriteDate);
  }, [profile?.user.favoriteDate]);

  const mutation = useMutation({
    mutationFn: () => {
      const v = getVisitor();
      if (!v?.userId) throw new Error("セッションが見つかりません");
      return visitorApi.onboard({
        userId: v.userId,
        nickname: nickname.trim(),
        favoriteDate: favoriteDate || undefined,
      });
    },
    onSuccess: (result) => {
      const v = getVisitor();
      if (v) {
        saveVisitor({
          ...v,
          nickname: result.nickname,
          onboarded: !!result.onboardedAt,
        });
      }
      toast.success(isEdit ? "プロフィールを保存しました" : "ようこそ！マイページを開きます");
      navigate("/visitor/mypage", { replace: true });
    },
    onError: (e: any) => toast.error(e?.message || (isEdit ? "保存に失敗しました" : "登録に失敗しました")),
  });

  const v = getVisitor();
  const eventId = v?.eventId;

  // eventData はロゴ・イベント名の表示にのみ使う装飾的な値で、フォーム自体(ニックネーム登録)は
  // eventData 無しでも成立する。取得失敗時は `eventData ? ... : "ようこそ"` のフォールバックが
  // 効くため、isError/ErrorState は追加せず現状維持とする (判断: 2026-07-07)。
  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId!),
    enabled: !!eventId,
  });

  return (
    <div className="mx-auto max-w-md px-4 py-10 font-mono">
      {eventData?.logoUrl && (
        <div className="mb-6 border-[3px] border-border p-2 bg-background">
          <img
            src={eventData.logoUrl}
            alt={eventData.eventName}
            className="w-full h-auto max-h-32 object-contain mx-auto block"
          />
        </div>
      )}
      <div className="border-[3px] border-border p-6 space-y-6">
        {isEdit && (
          <button
            onClick={() => navigate("/visitor/mypage")}
            className="text-xs uppercase tracking-widest underline hover:text-info"
          >
            ← マイページに戻る
          </button>
        )}
        <div className="space-y-1">
          <h1 className="text-2xl font-black uppercase tracking-wider">
            {isEdit ? "プロフィール編集" : eventData ? `[${eventData.eventName}]` : "ようこそ"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? "ニックネームとお好きな日付を編集できます。"
              : "はじめにニックネームを登録してください。スタンプラリーや抽選に使います。"}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
            ニックネーム <span className="text-destructive">*</span>
          </label>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="例: たろう"
            maxLength={30}
            className="rounded-none border-[2px] h-11"
          />
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
            お好きな日付 (任意)
          </label>
          <Input
            type="date"
            value={favoriteDate}
            onChange={(e) => setFavoriteDate(e.target.value)}
            className="rounded-none border-[2px] h-11"
          />
          <p className="text-[10px] text-muted-foreground">
            リストバンドを紛失した際の本人確認に使います（誕生日や記念日など、ご自身が覚えられる日付を入力してください）。公開されません。
          </p>
        </div>

        <Button
          className="w-full h-12 rounded-none border-[2px] uppercase font-black"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !nickname.trim()}
        >
          {mutation.isPending ? "保存中..." : isEdit ? "保存する" : "はじめる"}
        </Button>
      </div>
    </div>
  );
}

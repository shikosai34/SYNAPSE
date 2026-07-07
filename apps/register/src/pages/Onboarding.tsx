import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { visitorApi, eventApi } from "@/lib/api";
import { getVisitor, saveVisitor, useVisitor } from "@/hooks/useVisitor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * 来場者オンボーディング (2026-07-04)。
 * 収集はニックネーム + 誕生日(任意)のみ。誕生日はリストバンド紛失時の本人確認用。
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const { isLoaded, isEntered, session } = useVisitor();
  const [nickname, setNickname] = useState("");
  const [birthday, setBirthday] = useState("");

  // 入場前(セッション無し)に直接来たら入場を促す
  useEffect(() => {
    if (isLoaded && !isEntered) {
      navigate("/", { replace: true });
    }
  }, [isLoaded, isEntered, navigate]);

  useEffect(() => {
    if (session?.nickname) setNickname(session.nickname);
  }, [session?.nickname]);

  const mutation = useMutation({
    mutationFn: () => {
      const v = getVisitor();
      if (!v?.userId) throw new Error("セッションが見つかりません");
      return visitorApi.onboard({
        userId: v.userId,
        nickname: nickname.trim(),
        birthday: birthday || undefined,
      });
    },
    onSuccess: (profile) => {
      const v = getVisitor();
      if (v) {
        saveVisitor({
          ...v,
          nickname: profile.nickname,
          onboarded: !!profile.onboardedAt,
        });
      }
      toast.success("ようこそ！マイページを開きます");
      navigate("/mypage", { replace: true });
    },
    onError: (e: any) => toast.error(e?.message || "登録に失敗しました"),
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
        <div className="space-y-1">
          <h1 className="text-2xl font-black uppercase tracking-wider">
            {eventData ? `[${eventData.eventName}]` : "ようこそ"}
          </h1>
          <p className="text-sm text-muted-foreground">
            はじめにニックネームを登録してください。スタンプラリーや抽選に使います。
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
            誕生日 (任意)
          </label>
          <Input
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            className="rounded-none border-[2px] h-11"
          />
          <p className="text-[10px] text-muted-foreground">
            リストバンドを紛失した際の本人確認に使います。公開されません。
          </p>
        </div>

        <Button
          className="w-full h-12 rounded-none border-[2px] uppercase font-black"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !nickname.trim()}
        >
          {mutation.isPending ? "登録中..." : "はじめる"}
        </Button>
      </div>
    </div>
  );
}

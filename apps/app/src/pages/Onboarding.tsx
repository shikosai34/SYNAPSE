import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { visitorApi, eventApi, wristbandApi } from "@/lib/api";
import { getVisitor, saveVisitor, useVisitor } from "@/hooks/useVisitor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveAssetUrl } from "@/lib/asset-url";

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
  const [birthdayMonth, setBirthdayMonth] = useState("");
  const [birthdayDay, setBirthdayDay] = useState("");
  const [age, setAge] = useState("");

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

  useEffect(() => {
    const [month = "", day = ""] = profile?.user.birthdayMonthDay?.split("-") ?? [];
    if (month) setBirthdayMonth(String(Number(month)));
    if (day) setBirthdayDay(String(Number(day)));
    if (profile?.user.age != null) setAge(String(profile.user.age));
  }, [profile?.user.birthdayMonthDay, profile?.user.age]);

  // 2026-10-08: 生年を集めない要件のため月日を別選択にし、2月29日も選べるよううるう年で日数を出す。
  const daysInBirthdayMonth = birthdayMonth
    ? new Date(Date.UTC(2000, Number(birthdayMonth), 0)).getUTCDate()
    : 31;
  const birthdayMonthDay = birthdayMonth && birthdayDay
    ? birthdayMonth.padStart(2, "0") + "-" + birthdayDay.padStart(2, "0")
    : "";
  const ageNumber = age === "" ? undefined : Number(age);
  const hasValidAge =
    ageNumber !== undefined && Number.isInteger(ageNumber) && ageNumber >= 0 && ageNumber <= 120;
  const hasBirthday = !!birthdayMonthDay && Number(birthdayDay) <= daysInBirthdayMonth;
  const hasRequiredAdmissionDetails = isEdit || (hasBirthday && hasValidAge);

  const mutation = useMutation({
    mutationFn: () => {
      const v = getVisitor();
      if (!v?.userId) throw new Error("セッションが見つかりません");
      return visitorApi.onboard({
        userId: v.userId,
        nickname: nickname.trim(),
        favoriteDate: favoriteDate || undefined,
        birthdayMonthDay: hasBirthday ? birthdayMonthDay : undefined,
        age: hasValidAge ? ageNumber : undefined,
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
            src={resolveAssetUrl(eventData.logoUrl)}
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
              ? "ニックネーム・誕生日・年齢・お好きな日付を編集できます。"
              : "ニックネーム・誕生日・年齢を登録してください。誕生日は月日だけで入力できます。"}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="visitor-birthday-month" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
            誕生日（月日） {!isEdit && <span className="text-destructive">*</span>}
          </label>
          <div className="flex items-center gap-3">
            <select
              id="visitor-birthday-month"
              value={birthdayMonth}
              onChange={(e) => {
                const month = e.target.value;
                setBirthdayMonth(month);
                if (!month || Number(birthdayDay) > new Date(Date.UTC(2000, Number(month), 0)).getUTCDate()) {
                  setBirthdayDay("");
                }
              }}
              aria-label="誕生日の月"
              required={!isEdit}
              className="h-11 min-w-0 flex-1 rounded-none border-[2px] bg-input px-3 font-mono"
            >
              <option value="">月を選択</option>
              {Array.from({ length: 12 }, (_, index) => String(index + 1)).map((month) => (
                <option key={month} value={month}>{month}月</option>
              ))}
            </select>
            <select
              id="visitor-birthday-day"
              value={birthdayDay}
              onChange={(e) => setBirthdayDay(e.target.value)}
              aria-label="誕生日の日"
              required={!isEdit}
              disabled={!birthdayMonth}
              className="h-11 min-w-0 flex-1 rounded-none border-[2px] bg-input px-3 font-mono disabled:opacity-50"
            >
              <option value="">日を選択</option>
              {Array.from({ length: daysInBirthdayMonth }, (_, index) => String(index + 1)).map((day) => (
                <option key={day} value={day}>{day}日</option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-muted-foreground">誕生日の年は入力しません。</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="visitor-age" className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
            年齢 {!isEdit && <span className="text-destructive">*</span>}
          </label>
          <Input
            id="visitor-age"
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            step={1}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="例: 16"
            required={!isEdit}
            aria-invalid={age !== "" && !hasValidAge}
            className="rounded-none border-[2px] h-11"
          />
          {age !== "" && !hasValidAge && (
            <p className="text-xs text-destructive">0〜120の整数を入力してください。</p>
          )}
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
          disabled={
            mutation.isPending ||
            !nickname.trim() ||
            !hasRequiredAdmissionDetails ||
            (age !== "" && !hasValidAge)
          }
        >
          {mutation.isPending ? "保存中..." : isEdit ? "保存する" : "はじめる"}
        </Button>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { wristbandApi, eventApi } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, QrCode, Receipt, ChevronRight } from "lucide-react";

/**
 * 来場者マイページ (2026-07-11 注文履歴を /orders に分離しマイQR/身分表示に専念)。
 *
 * 来場者は eventUser.id ベアラーのみ (旧 useAuth/useGuestUser シムは撤去済み)。
 * リストバンドの登録/再発行/紛失処理はスマホ側では行わず、本部(イベント管理)で行う。
 */
export default function MyPage() {
  const navigate = useNavigate();
  const { session, userId: visitorUserId, isLoaded } = useVisitor();
  const eventId = session?.eventId;
  const userId = visitorUserId ?? "";

  // eventData はヘッダーのロゴ表示のみに使う装飾的な値。取得失敗しても
  // ロゴが出ないだけで画面は成立するため ErrorState は出さない (判断: 2026-07-07)。
  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId!),
    enabled: !!eventId,
  });

  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  // ユーザー＆リストバンド状態取得 (マイQRの表示IDに使う)
  const {
    data: userStatus,
    isLoading: statusLoading,
    isError: statusError,
    error: statusErrorObj,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ["userWristbandStatus", userId],
    queryFn: () => wristbandApi.lookup(userId),
    enabled: !!userId,
  });

  if (!isLoaded || statusLoading) {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-4 font-mono">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  // userStatus はマイQR・リストバンド状態など画面全体の前提になるため取得失敗時はページ全体を止める。
  if (statusError) {
    return (
      <div className="max-w-3xl mx-auto p-4 font-mono">
        <ErrorState
          error={statusErrorObj}
          title="ユーザー情報の取得に失敗しました"
          onRetry={() => refetchStatus()}
        />
      </div>
    );
  }

  const activeWristband = userStatus?.wristband;
  const targetWbId = activeWristband?.id || userId;
  // 来場者アプリと register(模擬店POS)は別オリジンのため、店頭スキャン用QRは
  // register(スタッフ)側の /checkin を指すよう VITE_STAFF_URL を優先する (2026-07-04 アプリ分離)。
  // 単一ドメイン化 (2026-07-07): 店頭スキャンは /circle/checkin へ移設。
  const registerBase = (import.meta.env.VITE_STAFF_URL as string) || origin;
  const userCheckinUrl = registerBase ? `${registerBase}/circle/checkin?wb=${targetWbId}` : targetWbId;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(
    userCheckinUrl
  )}`;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-4 space-y-4 sm:space-y-6 pb-24 font-mono">
      {eventData?.logoUrl && (
        <div className="border-thick border-border p-2 bg-background mb-4">
          <img
            src={eventData.logoUrl}
            alt={eventData.eventName}
            className="w-full h-auto max-h-32 object-contain mx-auto block"
          />
        </div>
      )}

      <button
        onClick={() => navigate("/visitor/menu")}
        className="text-xs uppercase tracking-widest underline hover:text-info flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        メニュー選択に戻る
      </button>

      <div className="border-b-thick border-border pb-4">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tight leading-tight">
          [マイデジタルQR]
        </h1>
        <p className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground mt-1">
          店頭でこちらのQRまたはリストバンドをお見せください
        </p>
      </div>

      {/* リストバンド未登録の案内。
          2026-07-11: 登録/再発行/紛失処理はすべて本部(受付/イベント管理)で行う。
          物理リストバンドが未紐付けの場合のみ本部での登録を案内する。
          スマホ画面のQR(下のマイデジタルQR)はそのまま利用できる。 */}
      {!activeWristband && (
        <div className="border-thick border-border bg-muted p-4 flex items-start gap-3">
          <QrCode className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-sm">リストバンドが未登録です</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              リストバンドは受付・本部でお渡しします。受付で発行された来場登録QR（またはリストバンドのQR）を読み取ると登録できます。
              登録すると、なくしても本部で再発行できます。下の「マイデジタルQR」はそのままご利用いただけます。
            </p>
          </div>
        </div>
      )}

      {/* デジタルQRカード */}
      <Card className="border-heavy border-border bg-primary text-primary-foreground rounded-none p-4 sm:p-6 text-center shadow-none">
        <CardHeader className="p-0 mb-4">
          <div className="inline-block bg-background text-foreground px-3 py-1 text-xs font-black uppercase tracking-widest mx-auto">
            MEMBER DIGITAL QR
          </div>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          <div className="bg-background p-3 sm:p-4 inline-block border-thick border-background mx-auto">
            <img
              src={qrImageUrl}
              alt="My Digital QR"
              width={180}
              height={180}
              className="mx-auto block"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-primary-foreground/70 uppercase tracking-widest">
              USER ID (呼出しID: #{userStatus?.user.displayId || "---"})
            </p>
            <p className="text-base sm:text-xl font-bold tracking-wider break-all px-2">{userId}</p>
          </div>
        </CardContent>
      </Card>

      {/* 注文履歴への導線 (履歴は /orders に分離) */}
      <button
        onClick={() => navigate("/visitor/orders")}
        className="group w-full flex items-center justify-between gap-2 border-thick border-border bg-background hover:bg-muted transition-all p-4 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center border-thick border-border bg-primary text-primary-foreground shrink-0">
            <Receipt className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-black uppercase tracking-tight">注文履歴を見る</span>
            <span className="block text-[11px] text-muted-foreground">事前オーダー・店頭注文の状況を確認</span>
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  );
}

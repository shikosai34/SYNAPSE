import { useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { eventApi, circleApi } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { EventTheme } from "@/components/EventTheme";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Store, ArrowRight, QrCode, Calendar, ChevronRight } from "lucide-react";

/**
 * イベント メニュー横断閲覧 (2026-07-06)。
 *
 * リストバンドでイベントが特定できる前提で、そのイベントに紐づくサークル一覧と
 * 各サークルのメニューへの導線を提供する「下見」画面。閲覧は誰でも可。実際の注文は
 * 発行済みリストバンドが必要 (Menu 側でゲート)。
 *
 * - /events            … 入場済みなら自分のイベントへ、未入場ならイベント選択
 * - /events/:eventId   … 指定イベントのサークル一覧
 */
export default function EventMenu() {
  const { eventId: eventIdParam } = useParams();
  const navigate = useNavigate();
  const { session } = useVisitor();

  // ルート優先。無ければ入場中リストバンドのイベントを使う。
  const eventId = eventIdParam || session?.eventId || null;
  const isEntered = !!session?.userId;

  // イベント未特定: イベント選択画面
  if (!eventId) {
    return <EventPicker />;
  }

  return (
    <EventMenuContent
      eventId={eventId}
      isEntered={isEntered}
      onBrowseCircle={(circleId) => navigate(`/menu?circleId=${circleId}`)}
    />
  );
}

function EventMenuContent({
  eventId,
  isEntered,
  onBrowseCircle,
}: {
  eventId: string;
  isEntered: boolean;
  onBrowseCircle: (circleId: string) => void;
}) {
  const {
    data: event,
    isLoading: eventLoading,
    isError: eventError,
    error: eventErrorObj,
    refetch: refetchEvent,
  } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventApi.get(eventId),
  });

  const {
    data: circles,
    isLoading: circlesLoading,
    isError: circlesError,
    error: circlesErrorObj,
    refetch: refetchCircles,
  } = useQuery({
    queryKey: ["circles", eventId],
    queryFn: () => circleApi.list(eventId),
  });

  const theme = useMemo(() => event ?? null, [event]);

  return (
    <EventTheme theme={theme} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8 font-mono">
        {/* イベントヘッダー (ロゴ + 名称、テーマ配色) */}
        <div className="border-thick border-border bg-primary text-primary-foreground p-5 mb-6 flex items-center gap-4">
          {eventLoading ? (
            <Skeleton className="h-14 w-14" />
          ) : event?.logoUrl ? (
            <img
              src={event.logoUrl}
              alt={event.eventName}
              className="h-14 w-14 object-contain border-thick border-primary-foreground bg-background shrink-0"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center border-thick border-primary-foreground shrink-0">
              <Calendar className="h-6 w-6" />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest opacity-80">
              出店メニュー
            </div>
            <h1 className="font-headline text-2xl sm:text-3xl font-black uppercase tracking-tight truncate">
              {eventLoading ? "読み込み中…" : event?.eventName || "イベント"}
            </h1>
            {event?.description && (
              <p className="text-xs opacity-80 truncate">{event.description}</p>
            )}
          </div>
        </div>

        {/* イベント取得失敗: ヘッダーは上でフォールバック表示済みだが、
            テーマ/イベント名が欠けたまま気づかず進むのを避けるため明示的にエラーを出す */}
        {eventError && (
          <ErrorState
            error={eventErrorObj}
            title="イベント情報の取得に失敗しました"
            onRetry={() => refetchEvent()}
            className="mb-6"
          />
        )}

        {/* 未入場バナー: 閲覧は自由・利用は発行必須 */}
        {!isEntered && (
          <div className="border-thick border-border bg-muted/40 p-4 mb-6 flex items-start gap-3">
            <QrCode className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-black uppercase tracking-wide">閲覧モード</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                メニューの下見はどなたでもご覧いただけます。事前注文・スタンプ・抽選などを使うには、
                受付でリストバンドの発行を受けるか、お持ちのリストバンドの QR を読み取って入場してください。
              </p>
            </div>
          </div>
        )}

        {/* サークル一覧 */}
        <h2 className="text-sm font-black uppercase tracking-wider mb-3 flex items-center gap-2">
          <Store className="h-4 w-4" />
          出店一覧 {circles ? `(${circles.length})` : ""}
        </h2>

        {circlesLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : circlesError ? (
          <ErrorState error={circlesErrorObj} onRetry={() => refetchCircles()} />
        ) : circles && circles.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {circles.map((circle) => (
              <button
                key={circle.id}
                type="button"
                onClick={() => onBrowseCircle(circle.id)}
                className="group text-left border-thick border-border bg-background hover:bg-muted transition-all p-3 flex items-center gap-3 cursor-pointer"
              >
                {circle.iconImagePath ? (
                  <img
                    src={circle.iconImagePath}
                    alt={circle.name}
                    className="h-12 w-12 object-cover border-thick border-border shrink-0"
                  />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center border-thick border-border bg-muted shrink-0">
                    <Store className="h-5 w-5 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black uppercase tracking-tight truncate">
                    {circle.name}
                  </div>
                  {circle.description && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {circle.description}
                    </div>
                  )}
                  <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider">
                    メニューを見る
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={Store} message="このイベントにはまだ出店が登録されていません" />
        )}

        {/* マイページ導線 (入場済みのみ) */}
        {isEntered && (
          <div className="mt-8">
            <Link
              to="/mypage"
              className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider underline hover:text-accent"
            >
              マイページ (注文履歴・スタンプ)
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </EventTheme>
  );
}

/** 未入場でイベント未特定のとき: 公開イベントの一覧から選ばせる */
function EventPicker() {
  const navigate = useNavigate();
  const {
    data: events,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["events"],
    queryFn: () => eventApi.list(),
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 font-mono">
      <div className="space-y-2 mb-6">
        <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
          Browse
        </span>
        <h1 className="font-headline text-2xl sm:text-3xl font-black uppercase tracking-tight">
          イベントを選んでメニューを見る
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          下見したいイベントを選んでください。ご利用にはリストバンドの発行 (入場) が必要です。
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : events && events.length > 0 ? (
        <div className="grid gap-3">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => navigate(`/events/${event.id}`)}
              className="group text-left border-thick border-border bg-background hover:bg-muted transition-all p-4 flex items-center gap-3 cursor-pointer"
            >
              {event.logoUrl ? (
                <img
                  src={event.logoUrl}
                  alt={event.eventName}
                  className="h-12 w-12 object-contain border-thick border-border bg-background shrink-0"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center border-thick border-border shrink-0">
                  <Calendar className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-headline text-lg font-black uppercase tracking-tight truncate">
                  {event.eventName}
                </div>
                {event.description && (
                  <div className="text-[11px] text-muted-foreground truncate">
                    {event.description}
                  </div>
                )}
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={Calendar} message="公開中のイベントがありません" />
      )}
    </div>
  );
}

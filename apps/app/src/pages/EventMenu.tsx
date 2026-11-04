import { useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { eventApi, circleApi, reviewApi, activeWaitTimeReport, parseCircleSettings, parseStoreAreas, type VisitorReviewStoreSummary } from "@/lib/api";
import { useVisitor } from "@/hooks/useVisitor";
import { EventTheme } from "@/components/EventTheme";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Store, ArrowRight, QrCode, Calendar, ChevronRight, ShoppingCart, Star } from "lucide-react";
import { resolveAssetUrl } from "@/lib/asset-url";
import { findVisitorRouteItem } from "@/lib/visitor-route";
import { groupCirclesByStoreArea } from "@/lib/store-areas";

/**
 * イベント メニュー横断閲覧 (2026-07-06)。
 *
 * リストバンドでイベントが特定できる前提で、そのイベントに紐づくサークル一覧と
 * 各サークルのメニューへの導線を提供する「下見」画面。閲覧は誰でも可。実際の注文は
 * 2026-11-04: 注文は原則発行済みバンドが必要。双方opt-inの店舗のみ未発行注文を受け付ける。
 *
 * - /visitor/events            … 入場済みなら自分のイベントへ、未入場ならイベント選択
 * - /visitor/events/:eventId   … 指定イベントのサークル一覧
 */
export default function EventMenu() {
  const { eventId: eventIdParam, eventName: eventNameParam } = useParams();
  const navigate = useNavigate();
  const { session, isLoaded, isOnboarded } = useVisitor();
  const { data: events } = useQuery({
    queryKey: ["events"],
    queryFn: () => eventApi.list(),
    enabled: !!eventNameParam && !eventIdParam,
  });
  const namedEvent = eventNameParam
    ? findVisitorRouteItem(events ?? [], eventNameParam, (event) => event.id, (event) => event.eventName)
    : null;

  // ルート優先。無ければ入場中リストバンドのイベントを使う。
  const routeEventId = eventIdParam || namedEvent?.id || null;
  const eventId = routeEventId || (eventNameParam ? null : session?.eventId || null);

  if (!isLoaded) {
    return <div className="mx-auto max-w-4xl p-6 font-mono" role="status" aria-busy="true">読み込み中…</div>;
  }

  if (eventNameParam && !events) {
    return <div className="mx-auto max-w-4xl p-6 font-mono" role="status" aria-busy="true">読み込み中…</div>;
  }

  // 入場済み来場者は自身のイベント内で注文先を探す。未入場者の公開下見と、
  // リストバンド発行前のイベント選択は従来どおりイベント横断で利用できる (2026-09-27)。
  if (session?.userId && session.eventId && routeEventId && routeEventId !== session.eventId) {
    return (
      <main className="mx-auto max-w-xl p-6 font-mono" role="alert">
        <h1 className="text-xl font-bold">別のイベントは表示できません</h1>
        <p className="my-4">入場中のイベントの出店一覧へ戻ってください。</p>
        <button className="underline" onClick={() => navigate(`/visitor/events/${session.eventId}`)}>
          入場中のイベントへ戻る
        </button>
      </main>
    );
  }

  if (eventNameParam && events && !namedEvent) {
    return (
      <main className="mx-auto max-w-xl p-6 font-mono" role="alert">
        <h1 className="text-xl font-bold">イベントが見つかりません</h1>
        <p className="my-4">URLが変更されたか、イベントが存在しない可能性があります。</p>
        <button className="underline" onClick={() => navigate("/visitor/events")}>
          イベント一覧へ戻る
        </button>
      </main>
    );
  }

  // イベント未特定: イベント選択画面
  if (!eventId) {
    return <EventPicker />;
  }

  return (
    <EventMenuContent
      eventId={eventId}
      isOnboarded={isOnboarded}
      onBrowseCircle={(circleId) => navigate(`/visitor/menu?circleId=${circleId}`)}
    />
  );
}

function EventMenuContent({
  eventId,
  isOnboarded,
  onBrowseCircle,
}: {
  eventId: string;
  isOnboarded: boolean;
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
    // 2026-10-07 (#9): 表示したまま30分経過した報告も未報告へ更新する。
    refetchInterval: 60_000,
  });

  const { data: publicReviewSummaries } = useQuery({
    queryKey: ["public-review-summaries", eventId],
    queryFn: () => reviewApi.publicStores(eventId),
    staleTime: 30_000,
  });
  const reviewSummaryByCircle = useMemo(
    () => new Map((publicReviewSummaries ?? []).map((summary) => [summary.circleId, summary])),
    [publicReviewSummaries],
  );

  const theme = useMemo(() => event ?? null, [event]);
  const storeAreas = useMemo(() => parseStoreAreas(event?.storeAreas), [event?.storeAreas]);
  const safeOfficialWebsiteUrl = useMemo(() => {
    try {
      const url = new URL(event?.officialWebsiteUrl || "");
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch {
      return null;
    }
  }, [event?.officialWebsiteUrl]);

  const uniqueCircles = circles
    ? Array.from(new Map(circles.map(c => [c.id, c])).values())
    : undefined;
  const circleGroups = groupCirclesByStoreArea(uniqueCircles ?? [], event?.storeAreas)
    .filter((group) => group.circles.length > 0);

  return (
    <EventTheme theme={theme} className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8 font-mono">
        {/* イベントヘッダー (ロゴ + 名称、テーマ配色) */}
        <div className="border-thick border-border bg-primary text-primary-foreground p-5 mb-6 flex items-center gap-4">
          {eventLoading ? (
            <Skeleton className="h-14 w-14" />
          ) : event?.logoUrl ? (
            <img
              src={resolveAssetUrl(event.logoUrl)}
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
            <h1 className="break-words font-headline text-2xl leading-tight sm:text-3xl font-black uppercase tracking-tight">
              {eventLoading ? "読み込み中…" : event?.eventName || "イベント"}
            </h1>
            {event?.description && (
              <p className="text-xs opacity-80 truncate">{event.description}</p>
            )}
            {safeOfficialWebsiteUrl && (
              <a href={safeOfficialWebsiteUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-xs font-bold underline underline-offset-2">
                イベント公式サイト
              </a>
            )}
          </div>
        </div>

        {/* イベント取得失敗: ヘッダーは上でフォールバック表示済みだが、
            テーマ/イベント名が欠けたまま気づかず進むのを避けるため明示的にエラーを出す */}
        {eventError && !event && (
          <ErrorState
            error={eventErrorObj}
            title="イベント情報の取得に失敗しました"
            onRetry={() => refetchEvent()}
            className="mb-6"
          />
        )}
        {eventError && event && (
          <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-2 border-thick border-warning bg-warning/10 p-3 text-xs font-bold">
            <span>通信に失敗しました。前回取得したイベント情報を表示しています。</span>
            <button type="button" onClick={() => void refetchEvent()} className="min-h-10 border-thick border-border px-3 underline">再接続して更新</button>
          </div>
        )}

        {/* 未入場バナー: 閲覧は自由・利用は発行必須 */}
        {!isOnboarded && (
          <div className="border-thick border-border bg-muted/40 p-4 mb-6 flex items-start gap-3">
            <QrCode className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-black uppercase tracking-wide">閲覧モード</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {/* 2026-11-04: イベント許可だけで全店舗が受付可能と誤認させず、店舗側の許可も必要と伝える。 */}
                {event?.allowWristbandlessOrder
                  ? "リストバンドなし注文に対応した出店では、発行前でも事前注文できます。スタンプ・抽選などの利用には入場登録が必要です。"
                  : "メニューの下見はどなたでもご覧いただけます。事前注文・スタンプ・抽選などを使うには、受付でリストバンドの発行を受けるか、お持ちのリストバンドの QR を読み取って入場してください。"}
              </p>
            </div>
          </div>
        )}

        {/* サークル一覧 */}
        <h2 className="text-sm font-black uppercase tracking-wider mb-3 flex items-center gap-2">
          <Store className="h-4 w-4" />
          出店一覧 {uniqueCircles ? `(${uniqueCircles.length})` : ""}
        </h2>

        {circlesLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {/* 2026-10-16: 読み込み中の枠もスマートフォンでは2列に合わせる。 */}
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : circlesError && !circles ? (
          <ErrorState error={circlesErrorObj} onRetry={() => refetchCircles()} />
        ) : uniqueCircles && uniqueCircles.length > 0 ? (
          <div className="space-y-5">
            {circleGroups.map((group) => (
              <section key={group.area?.id ?? "unassigned"} className="space-y-2">
                <h3 className="flex items-center justify-between border-b-thin border-border pb-2 text-xs font-bold">
                  <span>{group.area?.name ?? "エリア未設定"}</span>
                  <span className="text-[10px] text-muted-foreground">{group.circles.length}店舗</span>
                </h3>
                {/* 2026-10-16: 画面を有効に使うため、スマートフォンでも店舗を2列で一覧できるようにする。 */}
                <div className="grid grid-cols-2 gap-2 sm:gap-3">
                  {group.circles.map((circle) => (
              <article
                key={circle.id}
                className="flex min-w-0 flex-col gap-2 border-thick border-border bg-background p-2 sm:p-3"
              >
                <button
                  type="button"
                  onClick={() => onBrowseCircle(circle.id)}
                  className="group flex min-h-16 min-w-0 w-full cursor-pointer items-center gap-2 text-left transition-colors hover:bg-muted sm:gap-3"
                >
                {circle.iconImagePath ? (
                  <img
                    src={resolveAssetUrl(circle.iconImagePath)}
                    alt={circle.name}
                    className="h-10 w-10 shrink-0 border-thick border-border object-cover sm:h-12 sm:w-12"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center border-thick border-border bg-muted sm:h-12 sm:w-12">
                    <Store className="h-5 w-5 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="break-words text-xs font-black uppercase leading-snug tracking-tight sm:text-sm">
                    {circle.name}
                  </div>
                  {circle.description && (
                    <div className="truncate text-[10px] text-muted-foreground sm:text-[11px]">
                      {circle.description}
                    </div>
                  )}
                  {(() => {
                    const areaId = parseCircleSettings(circle.settings).storeAreaId;
                    const areaName = storeAreas.find((area) => area.id === areaId)?.name;
                    return areaName ? <div className="mt-1 break-words text-[9px] font-bold sm:text-[10px]">出店場所: {areaName}</div> : null;
                  })()}
                  {(() => {
                    const report = activeWaitTimeReport(circle.settings);
                    return <div className="mt-1 break-words text-[9px] font-bold sm:text-[10px]">待ち時間: {report ? `約${report.minutes}分（${report.minutesAgo}分前）` : "未報告"}</div>;
                  })()}
                  {reviewSummaryByCircle.get(circle.id)?.showAverageRating && (
                    <PublicRatingSummary summary={reviewSummaryByCircle.get(circle.id)!} />
                  )}
                  <div className="mt-1 inline-flex flex-wrap items-center gap-1 text-[9px] font-black uppercase tracking-wider sm:text-[10px]">
                    {parseCircleSettings(circle.settings).preOrderEnabled ? "事前注文" : "メニューを見る"}
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
                </button>
                {parseCircleSettings(circle.settings).preOrderEnabled && parseCircleSettings(circle.settings).mobileOrderEnabled && (
                  <p className="border-t-thin border-border pt-1 text-center text-[9px] font-bold text-muted-foreground sm:text-[10px]">
                    事前注文とモバイル注文から選べます
                  </p>
                )}
                {parseCircleSettings(circle.settings).mobileOrderEnabled && (
                  <Link
                    to={`/visitor/order/${circle.id}`}
                    className="inline-flex min-h-11 items-center justify-center gap-2 border-thick border-primary bg-primary px-2 text-center text-[10px] font-black text-primary-foreground hover:bg-background hover:text-foreground sm:text-xs"
                  >
                    <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                    モバイル注文
                  </Link>
                )}
              </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState icon={Store} message="このイベントにはまだ出店が登録されていません" />
        )}

        {circlesError && circles && (
          <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 border-thick border-warning bg-warning/10 p-3 text-xs font-bold">
            <span>通信に失敗しました。前回取得した出店一覧を表示しています。</span>
            <button type="button" onClick={() => void refetchCircles()} className="min-h-10 border-thick border-border px-3 underline">再接続して更新</button>
          </div>
        )}

        {/* 2026-10-20: 下見中の未登録者へマイQR導線を出さず、入場登録完了後にだけ表示する。 */}
        {isOnboarded && (
          <div className="mt-8">
            <Link
              to="/visitor/mypage"
              className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wider underline hover:text-accent"
            >
              マイQRを見る
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </EventTheme>
  );
}

function PublicRatingSummary({ summary }: { summary: VisitorReviewStoreSummary }) {
  const average = summary.averageRating;

  return (
    <div className="mt-2 space-y-1.5 border-t-thin border-border pt-2" role="group" aria-label={
      average == null
        ? `公開レビュー、${summary.reviewCount}件、評価はまだありません`
        : `公開レビュー、平均${average.toFixed(1)}、${summary.reviewCount}件`
    }>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="text-sm font-black tabular-nums leading-none">{average == null ? "—" : average.toFixed(1)}</span>
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => {
            const fill = average == null ? 0 : Math.max(0, Math.min(1, average - index));
            return (
              <span key={index} className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center">
                <Star className="h-3.5 w-3.5 fill-current text-muted-foreground/30" />
                {fill > 0 && (
                  <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                    <Star className="h-3.5 w-3.5 max-w-none shrink-0 fill-current text-primary" />
                  </span>
                )}
              </span>
            );
          })}
        </span>
        <span className="text-[9px] text-muted-foreground">{summary.reviewCount}件</span>
      </div>
      {summary.reviewCount === 0 && (
        <p className="text-[9px] leading-snug text-muted-foreground">レビューはまだありません</p>
      )}
    </div>
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
          メニューの下見は入場登録前でも利用できます。注文やスタンプなどにはリストバンドの登録が必要です。
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
              onClick={() => navigate(`/visitor/events/${event.id}`)}
              className="group text-left border-thick border-border bg-background hover:bg-muted transition-all p-4 flex items-center gap-3 cursor-pointer"
            >
              {event.logoUrl ? (
                <img
                  src={resolveAssetUrl(event.logoUrl)}
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

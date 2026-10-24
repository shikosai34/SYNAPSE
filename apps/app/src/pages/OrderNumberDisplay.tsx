import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useCircleAuth";
import { circleApi, orderApi, parseCircleSettings, type OrderNumberDisplayMedia, type ProjectorOrder } from "@/lib/api";
import { displayOrderNumber } from "@/lib/order-number";
import { getLocalDisplayMedia } from "@/lib/local-display-media";

function NumberColumn({
  title,
  orders,
  tone,
  priority,
}: {
  title: string;
  orders: ProjectorOrder[];
  tone: "preparing" | "ready";
  priority: "latest" | "oldest";
}) {
  const ordered = [...orders].sort((left, right) => {
    const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return priority === "latest" ? -difference : difference;
  });
  return (
    <section className="flex min-h-0 min-w-0 flex-col border-thick border-foreground bg-background text-foreground">
      <header className={`flex items-baseline justify-between gap-3 border-b-thick border-foreground px-4 py-3 sm:px-6 sm:py-4 ${tone === "ready" ? "bg-success text-white" : "bg-primary text-primary-foreground"}`}>
        <h2 className="font-headline text-2xl uppercase tracking-wide sm:text-4xl">{title}</h2>
        <span className="shrink-0 font-mono text-xl font-black tabular-nums sm:text-3xl">{orders.length}</span>
      </header>
      <div className="grid min-h-0 flex-1 content-start grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2 overflow-y-auto p-3 sm:gap-3 sm:p-5">
        {ordered.length === 0 ? (
          <p className="col-span-full py-8 text-center font-mono text-lg font-bold text-muted-foreground sm:text-2xl">
            {tone === "ready" ? "完成した注文はありません" : "作成中の注文はありません"}
          </p>
        ) : ordered.map((order) => (
          <div key={order.orderNumber} className={`flex min-h-20 flex-col items-center justify-center border-thick border-foreground px-2 py-3 text-center ${tone === "ready" ? "bg-success text-white" : "bg-background"}`}>
            <span className="break-all font-mono text-2xl font-black leading-tight tabular-nums sm:text-4xl xl:text-5xl">{displayOrderNumber(order.orderNumber)}</span>
            {order.paymentStatus === "unpaid" && (
              <span className="mt-2 border-thick border-error bg-error px-2 py-1 font-mono text-sm font-bold text-white sm:text-base">未決済</span>
            )}
            {tone === "preparing" && (
              <span className="mt-2 font-mono text-xs font-bold uppercase sm:text-sm">
                {order.status === "pending" ? "受付" : "作成中"}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DisplayMedia({ media, onAspectRatioChange }: { media: OrderNumberDisplayMedia[]; onAspectRatioChange: (ratio: number) => void }) {
  const [index, setIndex] = useState(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaMissing, setMediaMissing] = useState(false);
  const current = media[index];
  useEffect(() => setIndex(0), [media]);
  useEffect(() => onAspectRatioChange(16 / 9), [current?.id, onAspectRatioChange]);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setMediaUrl(null);
    setMediaMissing(false);
    if (!current) return;
    void getLocalDisplayMedia(current.id).then((blob) => {
      if (!active) return;
      if (!blob) {
        setMediaMissing(true);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setMediaUrl(objectUrl);
    }).catch(() => {
      if (active) setMediaMissing(true);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [current?.id]);
  useEffect(() => {
    if (!current || current.kind === "video" || media.length < 2) return;
    const timer = window.setTimeout(() => setIndex((previous) => (previous + 1) % media.length), current.durationSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [current, media.length]);
  if (!current) return null;
  const next = () => setIndex((previous) => (previous + 1) % media.length);
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-thick border-foreground bg-background p-2 sm:p-3" aria-label="サークルの表示メディア">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
        {!mediaUrl || mediaMissing ? (
          <p className="max-w-sm p-4 text-center font-mono text-sm font-bold text-white">
            {mediaMissing ? "この端末にメディアがありません。再生する端末でファイルを選択してください。" : "メディアを読み込み中…"}
          </p>
        ) : current.kind === "video" ? (
          // 2026-10-21: 動画が1本だけの設定でも再生終了後にループする。
          <video key={current.id} src={mediaUrl} autoPlay muted playsInline loop={media.length === 1} onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget;
            if (videoWidth > 0 && videoHeight > 0) onAspectRatioChange(videoWidth / videoHeight);
          }} onEnded={next} onError={() => setMediaMissing(true)} className="h-full w-full object-contain" aria-label={current.name} />
        ) : (
          <img src={mediaUrl} alt={current.name} onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) onAspectRatioChange(naturalWidth / naturalHeight);
          }} onError={() => setMediaMissing(true)} className="h-full w-full object-contain" />
        )}
      </div>
      <p className="mt-2 truncate text-center font-mono text-[10px] font-bold sm:text-xs">{current.name}</p>
    </aside>
  );
}

export default function OrderNumberDisplay() {
  const { circleId: authCircleId } = useAuth();
  const circleId = authCircleId ?? "";
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [clock, setClock] = useState(() => new Date());
  const displayAreaRef = useRef<HTMLDivElement>(null);
  const [displayAreaSize, setDisplayAreaSize] = useState({ width: 0, height: 0 });
  const [mediaAspectRatio, setMediaAspectRatio] = useState(16 / 9);
  // 2026-10-21: 別端末の設定保存を投影画面へ反映するため、注文一覧と同じ間隔で設定も再取得する。
  const circleQuery = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: !!circleId,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });
  const displaySettings = useMemo(
    () => parseCircleSettings(circleQuery.data?.settings).orderNumberDisplay,
    [circleQuery.data?.settings],
  );
  const updateMediaAspectRatio = useCallback((ratio: number) => {
    if (Number.isFinite(ratio) && ratio > 0) setMediaAspectRatio(ratio);
  }, []);
  const ordersQuery = useQuery({
    queryKey: ["projector-orders", circleId],
    queryFn: () => orderApi.projector(circleId),
    enabled: !!circleId,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    const previousTitle = document.title;
    document.title = "注文番号表示 | FesFlow";
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      document.title = previousTitle;
    };
  }, []);

  // 2026-10-21: 実際の表示枠と再生中メディアの比率を測り、投影画面に合う配置を選ぶ。
  useEffect(() => {
    const element = displayAreaRef.current;
    if (!element) return;
    const updateSize = () => {
      const { width, height } = element.getBoundingClientRect();
      setDisplayAreaSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    updateSize();
    return () => observer.disconnect();
  }, []);

  const orders = ordersQuery.data ?? [];
  const mediaShare = displaySettings.mediaPercent / 100;
  const containedMediaArea = (width: number, height: number) => {
    const containedWidth = Math.min(width, height * mediaAspectRatio);
    const containedHeight = containedWidth / mediaAspectRatio;
    return containedWidth * containedHeight;
  };
  const sideBySideMediaArea = containedMediaArea(displayAreaSize.width * mediaShare, displayAreaSize.height);
  const stackedMediaArea = containedMediaArea(displayAreaSize.width, displayAreaSize.height * mediaShare);
  // 2026-10-21: メディアと番号の実分割枠で object-contain 時の表示面積を比べ、縦長素材でも向きを誤らない。
  const placeMediaBesideNumbers = displaySettings.media.length > 0 && sideBySideMediaArea >= stackedMediaArea;
  // 2026-10-21: 完成と受け渡しを分け、未受け渡しの完成注文を番号表示に残す。
  const preparingOrders = orders.filter((order) => order.status === "pending" || order.status === "preparing");
  const readyOrders = orders.filter((order) => (order.status === "ready" || order.status === "completed") && !order.receivedAt);
  const lastUpdated = ordersQuery.dataUpdatedAt
    ? new Date(ordersQuery.dataUpdatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : "接続中";

  // 2026-10-21: 表示専用画面をビューポートに固定し、見切れをページ全体のスクロールで補わない。
  return (
    <main className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 flex-col gap-2 border-b-heavy border-foreground bg-primary px-4 py-3 text-primary-foreground sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:py-5">
        <div className="min-w-0">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] sm:text-sm">{circleQuery.data?.name ?? "FesFlow"}</p>
          <h1 className="break-words font-headline text-2xl uppercase tracking-wide sm:text-4xl xl:text-5xl">注文番号のご案内</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3 font-mono text-sm font-bold sm:text-base">
        <span aria-live="polite" className={`px-2 py-1 ${isOnline && !ordersQuery.isError ? "bg-success text-white" : "bg-error text-white"}`}>
            {isOnline && !ordersQuery.isError ? "● 配信中" : "● 接続を確認中"}
          </span>
          <time dateTime={clock.toISOString()}>{clock.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
      </header>

      {ordersQuery.isError && (
        <p role="status" className="shrink-0 bg-error px-4 py-2 text-center font-mono text-sm font-bold text-white sm:text-base">
          番号を更新できません。最終取得 {lastUpdated} の表示です。
        </p>
      )}

      <div
        ref={displayAreaRef}
        className="grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden p-3 sm:gap-4 sm:p-5"
        style={{
          gridTemplateColumns: placeMediaBesideNumbers
            ? `minmax(0, ${100 - displaySettings.mediaPercent}fr) minmax(0, ${displaySettings.mediaPercent}fr)`
            : "minmax(0, 1fr)",
          gridTemplateRows: displaySettings.media.length > 0 && !placeMediaBesideNumbers
            ? `minmax(0, ${100 - displaySettings.mediaPercent}fr) minmax(0, ${displaySettings.mediaPercent}fr)`
            : "minmax(0, 1fr)",
        }}
      >
        <div className={`grid min-h-0 min-w-0 gap-3 ${displaySettings.showPreparingNumbers && displaySettings.showPickupNumbers ? "md:grid-cols-2" : "grid-cols-1"}`}>
          {displaySettings.showPreparingNumbers && <NumberColumn title="作成中" orders={preparingOrders} tone="preparing" priority={displaySettings.overflowPriority} />}
          {displaySettings.showPickupNumbers && <NumberColumn title="受け取り待ち" orders={readyOrders} tone="ready" priority={displaySettings.overflowPriority} />}
        </div>
        {displaySettings.media.length > 0 && <DisplayMedia media={displaySettings.media} onAspectRatioChange={updateMediaAspectRatio} />}
      </div>
      <footer className="shrink-0 border-t-thin border-foreground px-4 py-2 text-right font-mono text-xs text-muted-foreground sm:px-8">
        自動更新 · 最終更新 {lastUpdated} · {clock.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
      </footer>
    </main>
  );
}

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { circleApi, parseEventPaymentMethods, parseStoreAreas, uploadImage, type Event, type EventStoreArea, type OrderFlowMode, type OrderNumberDisplaySettings } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/asset-url";
import { useUnsavedChanges } from "@/components/UnsavedNavigationGuard";

const STEPS = ["基本情報", "画像", "運用設定", "確認"];

type CreatedCircleSettings = {
  orderFlowMode: OrderFlowMode;
  preOrderEnabled: boolean;
  mobileOrderEnabled: boolean;
  extensions: { stock: boolean; staff: boolean };
  acceptedPayments: string[];
  storeAreaId: string | null;
  // 2026-10-25: 新規サークルでも未登録バンドを警告し、例外注文は明示設定にする。
  warnOnUnregisteredWristband: boolean;
  allowUnregisteredWristbandOrder: boolean;
  // 2026-10-21: 新規店舗のレビューは、運用設定で明示されるまで非公開にする。
  reviewPublication: { publishReviews: boolean; showAverageRating: boolean; showStars: boolean; showComments: boolean };
  // 2026-10-21: 新規店舗には作成中・受取待ちの両番号を既定表示し、媒体は空で始める。
  orderNumberDisplay: OrderNumberDisplaySettings;
};

export function CircleCreateWizard({
  event,
  inviteToken,
  onCancel,
  onCreated,
}: {
  event: Event;
  inviteToken?: string;
  onCancel: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconImagePath, setIconImagePath] = useState("");
  const [backgroundImagePath, setBackgroundImagePath] = useState("");
  const [uploading, setUploading] = useState<"icon" | "background" | null>(null);
  const [orderFlowMode, setOrderFlowMode] = useState<OrderFlowMode>("pending");
  const [stockEnabled, setStockEnabled] = useState(false);
  const [staffEnabled, setStaffEnabled] = useState(false);
  const [acceptedPayments, setAcceptedPayments] = useState<string[]>(() => parseEventPaymentMethods(event.paymentMethods));
  const [storeAreaId, setStoreAreaId] = useState("");
  const [warnOnUnregisteredWristband, setWarnOnUnregisteredWristband] = useState(true);
  const [allowUnregisteredWristbandOrder, setAllowUnregisteredWristbandOrder] = useState(false);
  const [creating, setCreating] = useState(false);
  const hasCreatedRef = useRef(false);

  const storeAreas: EventStoreArea[] = parseStoreAreas(event.storeAreas);
  const eventPayments = parseEventPaymentMethods(event.paymentMethods);

  const upload = async (kind: "icon" | "background", file?: File) => {
    if (!file) return;
    setUploading(kind);
    try {
      const result = await uploadImage(file);
      if (kind === "icon") setIconImagePath(result.path);
      else setBackgroundImagePath(result.path);
      toast.success("画像をアップロードしました");
    } catch (error: any) {
      toast.error(error?.message || "画像のアップロードに失敗しました");
    } finally {
      setUploading(null);
    }
  };

  const create = async () => {
    if (!name.trim()) throw new Error("サークル名を入力してください。");
    if (!acceptedPayments.length) {
      toast.error("対応する支払い方法を1つ以上選択してください");
      setStep(2);
      throw new Error("対応する支払い方法を1つ以上選択してください。");
    }
    if (uploading) throw new Error("画像のアップロードが完了してから保存してください。");
    setCreating(true);
    const settings: CreatedCircleSettings = {
      orderFlowMode,
      // 2026-10-21: 新規サークルは事前注文も明示的に有効化するまで受け付けない。
      preOrderEnabled: false,
      // 2026-10-17: 新規サークルは来場者注文を明示的に有効化するまで受け付けない。
      mobileOrderEnabled: false,
      extensions: { stock: stockEnabled, staff: staffEnabled },
      acceptedPayments,
      storeAreaId: storeAreaId || null,
      warnOnUnregisteredWristband,
      allowUnregisteredWristbandOrder,
      reviewPublication: { publishReviews: false, showAverageRating: false, showStars: false, showComments: false },
      orderNumberDisplay: { showPreparingNumbers: true, showPickupNumbers: true, overflowPriority: "latest", mediaPercent: 35, media: [] },
    };
    try {
      const result = await circleApi.create({
        eventId: event.id,
        name: name.trim(),
        description: description.trim() || undefined,
        iconImagePath: iconImagePath || null,
        backgroundImagePath: backgroundImagePath || null,
        settings,
        inviteToken,
      });
      toast.success("サークルを作成しました");
      hasCreatedRef.current = true;
      onCreated(result.id, name.trim());
    } catch (error: any) {
      toast.error(error?.message || "サークルの作成に失敗しました");
      throw error instanceof Error ? error : new Error("サークルの作成に失敗しました。");
    } finally {
      setCreating(false);
    }
  };

  // 2026-10-16: サークル作成前のウィザード入力を遷移確認の保存/破棄対象にする。
  useUnsavedChanges({
    isDirty: () => !hasCreatedRef.current && (
      !!name.trim() || !!description.trim() || !!iconImagePath || !!backgroundImagePath ||
      orderFlowMode !== "pending" || stockEnabled || staffEnabled ||
      !warnOnUnregisteredWristband || allowUnregisteredWristbandOrder ||
      JSON.stringify(acceptedPayments) !== JSON.stringify(parseEventPaymentMethods(event.paymentMethods)) || !!storeAreaId
    ),
    onSave: create,
    onDiscard: onCancel,
  });

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5 border-thick border-border bg-background p-4 sm:p-6" aria-label="サークル作成ウィザード">
      <header className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{event.eventName}</p>
        <h2 className="font-headline text-xl">サークル作成</h2>
      </header>
      <div className="flex gap-2" aria-label="サークル作成の進行状況">
        {STEPS.map((title, index) => <div key={title} className={`flex-1 border-b-thick pb-2 text-center text-[10px] font-bold ${index === step ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}><span className="block">{index + 1}</span>{title}</div>)}
      </div>

      {step === 0 && <div className="space-y-3">
        <div><Label htmlFor="circleName">サークル名</Label><Input id="circleName" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: たこ焼き 茨香庵" /></div>
        <div><Label htmlFor="circleDescription">説明</Label><textarea id="circleDescription" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full border-thick border-border bg-input p-3 font-mono text-sm" placeholder="出店ジャンルや販売メニュー等の説明" /></div>
      </div>}

      {step === 1 && <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="circleIcon">アイコン画像</Label>{iconImagePath && <img src={resolveAssetUrl(iconImagePath)} alt="サークルアイコンのプレビュー" className="h-28 w-28 border-thick border-border object-cover" />}<Input id="circleIcon" type="file" accept="image/*" disabled={!!uploading} onChange={(e) => { void upload("icon", e.target.files?.[0]); e.currentTarget.value = ""; }} />{uploading === "icon" && <p className="text-xs text-muted-foreground">アップロード中…</p>}</div>
        <div className="space-y-2"><Label htmlFor="circleBackground">背景画像</Label>{backgroundImagePath && <img src={resolveAssetUrl(backgroundImagePath)} alt="サークル背景画像のプレビュー" className="h-28 w-full border-thick border-border object-cover" />}<Input id="circleBackground" type="file" accept="image/*" disabled={!!uploading} onChange={(e) => { void upload("background", e.target.files?.[0]); e.currentTarget.value = ""; }} />{uploading === "background" && <p className="text-xs text-muted-foreground">アップロード中…</p>}</div>
      </div>}

      {step === 2 && <div className="space-y-5">
        <div className="space-y-2"><Label htmlFor="orderFlowMode">注文モード</Label><select id="orderFlowMode" className="w-full border-thick border-border bg-input p-3 font-mono" value={orderFlowMode} onChange={(e) => setOrderFlowMode(e.target.value as OrderFlowMode)}><option value="pending">未着手で受付</option><option value="preparing">調理中から開始</option><option value="completed">即完成</option></select><p className="text-[10px] text-muted-foreground">新規注文が入ったときの初期状態を選びます。</p></div>
        <div className="space-y-2"><Label>オプション選択</Label>
          <label className="flex cursor-pointer items-center gap-2 border-thin border-border p-3 text-sm"><input type="checkbox" checked={stockEnabled} onChange={(e) => setStockEnabled(e.target.checked)} />在庫管理</label>
          <label className="flex cursor-pointer items-center gap-2 border-thin border-border p-3 text-sm"><input type="checkbox" checked={staffEnabled} onChange={(e) => setStaffEnabled(e.target.checked)} />スタッフ管理</label>
        </div>
        <div className="space-y-2"><Label>対応する支払い方法</Label><p className="text-[10px] text-muted-foreground">イベントで設定されている支払い方法から選択します。</p>
          {eventPayments.length ? eventPayments.map((method) => <label key={method} className="flex cursor-pointer items-center gap-2 border-thin border-border p-2 text-sm"><input type="checkbox" checked={acceptedPayments.includes(method)} onChange={(e) => setAcceptedPayments((items) => e.target.checked ? [...items, method] : items.filter((item) => item !== method))} />{method}</label>) : <p className="text-xs text-muted-foreground">イベント側に支払い方法がありません。</p>}
        </div>
        {/* 2026-10-25: 新規店舗も警告を初期表示し、注文許可は運用者が明示的に選ぶ。 */}
        <fieldset className="space-y-2 border-t-thin border-border pt-3">
          <legend className="text-xs font-bold">入場登録前のリストバンド</legend>
          <label className="flex cursor-pointer items-start gap-2 border-thin border-border p-3 text-xs">
            <input type="checkbox" checked={warnOnUnregisteredWristband} onChange={(e) => setWarnOnUnregisteredWristband(e.target.checked)} />
            <span>入場登録前のバンドを読み取ったとき警告を表示する</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 border-thin border-border p-3 text-xs">
            <input type="checkbox" checked={allowUnregisteredWristbandOrder} onChange={(e) => setAllowUnregisteredWristbandOrder(e.target.checked)} />
            <span>警告画面から注文を受け付けるボタンを表示する</span>
          </label>
        </fieldset>
        <div className="space-y-2"><Label htmlFor="storeArea">店舗エリア</Label><select id="storeArea" className="w-full border-thick border-border bg-input p-3 font-mono" value={storeAreaId} onChange={(e) => setStoreAreaId(e.target.value)}><option value="">未設定</option>{storeAreas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select><p className="text-[10px] text-muted-foreground">イベントが登録したエリアから選ぶと、来場者の出店一覧にも場所が表示されます。</p></div>
      </div>}

      {step === 3 && <div className="space-y-2 border-thin border-border bg-muted/30 p-4 text-sm">
        <h3 className="font-headline text-lg">作成内容の確認</h3><p><strong>サークル名:</strong> {name}</p><p><strong>説明:</strong> {description || "未設定"}</p>
        <p><strong>画像:</strong> アイコン {iconImagePath ? "あり" : "なし"} / 背景 {backgroundImagePath ? "あり" : "なし"}</p>
        <p><strong>注文モード:</strong> {orderFlowMode === "pending" ? "未着手で受付" : orderFlowMode === "preparing" ? "調理中から開始" : "即完成"}</p>
        <p><strong>オプション:</strong> {[stockEnabled && "在庫管理", staffEnabled && "スタッフ管理"].filter(Boolean).join("、") || "なし"}</p>
        <p><strong>支払い方法:</strong> {acceptedPayments.join("、") || "未選択"}</p>
        <p><strong>店舗エリア:</strong> {storeAreas.find((area) => area.id === storeAreaId)?.name || "未設定"}</p>
        <p><strong>未登録バンド:</strong> {warnOnUnregisteredWristband ? "警告を表示" : "警告なし"} / 注文ボタン {allowUnregisteredWristbandOrder ? "表示" : "非表示"}</p>
      </div>}

      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={creating} onClick={step === 0 ? onCancel : () => setStep((current) => current - 1)}>{step === 0 ? "キャンセル" : "前へ"}</Button>
        {step < STEPS.length - 1 ? <Button type="button" className="flex-1" disabled={!name.trim() && step === 0 || !!uploading} onClick={() => setStep((current) => current + 1)}>次へ</Button> : <Button type="button" className="flex-1" disabled={creating || !acceptedPayments.length} onClick={() => void create().catch(() => undefined)}>{creating ? "作成中…" : "作成してメニュー管理へ"}</Button>}
      </div>
    </section>
  );
}

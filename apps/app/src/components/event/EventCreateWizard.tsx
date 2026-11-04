import { useRef, useState } from "react";
import { toast } from "sonner";
import { useGuardedNavigation, useUnsavedChanges } from "@/components/UnsavedNavigationGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { eventApi, membershipApi, uploadImage, type EventStoreArea } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/asset-url";

const STEP_TITLES = ["基本情報", "開催情報", "デザイン", "運用設定", "確認"];

// 2026-10-16 (#126): 初回登録時に必要な情報を一つずつ入力し、作成後に主催スタッフ招待を続けて発行する。
export function EventCreateWizard({ onBack, onComplete }: { onBack: () => void; onComplete: (eventId: string, hasPhysicalWristband: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [eventName, setEventName] = useState("");
  const [description, setDescription] = useState("");
  const [officialWebsiteUrl, setOfficialWebsiteUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // 2026-11-04: 発行必須を既定にし、未発行注文は明示的に許可する。
  const [allowWristbandlessOrder, setAllowWristbandlessOrder] = useState(false);
  const [hasPhysicalWristband, setHasPhysicalWristband] = useState(true);
  const [fontFamily, setFontFamily] = useState<"mono" | "sans" | "serif">("mono");
  const [primaryColor, setPrimaryColor] = useState("#000000");
  const [accentColor, setAccentColor] = useState("#0000FF");
  const [backgroundColor, setBackgroundColor] = useState("#FFFFFF");
  const [paymentMethods, setPaymentMethods] = useState(["現金"]);
  const [newPayment, setNewPayment] = useState("");
  const [storeAreas, setStoreAreas] = useState<EventStoreArea[]>([]);
  const [newArea, setNewArea] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdEvent, setCreatedEvent] = useState<{ id: string; hasPhysicalWristband: boolean } | null>(null);
  const [invite, setInvite] = useState<{ token: string; code: string } | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const createdEventRef = useRef(false);
  const requestNavigation = useGuardedNavigation();

  const handleLogo = async (file?: File) => {
    if (!file) return;
    setUploadingLogo(true);
    try {
      const result = await uploadImage(file);
      setLogoUrl(result.path);
      toast.success("ロゴをアップロードしました");
    } catch (error: any) {
      toast.error(error?.message || "ロゴのアップロードに失敗しました");
    } finally {
      setUploadingLogo(false);
    }
  };

  const addPayment = () => {
    const name = newPayment.trim();
    if (!name || paymentMethods.some((method) => method.toLowerCase() === name.toLowerCase())) return;
    setPaymentMethods((methods) => [...methods, name]);
    setNewPayment("");
  };

  const addArea = () => {
    const name = newArea.trim();
    if (!name || storeAreas.length >= 50 || storeAreas.some((area) => area.name.toLowerCase() === name.toLowerCase())) return;
    setStoreAreas((areas) => [...areas, { id: crypto.randomUUID(), name }]);
    setNewArea("");
  };

  const createEvent = async () => {
    if (uploadingLogo) {
      const message = "ロゴのアップロードが完了してから保存してください";
      toast.error(message);
      throw new Error(message);
    }
    if (!eventName.trim()) {
      const message = "イベント名を入力してください";
      toast.error(message);
      setStep(0);
      throw new Error(message);
    }
    if (officialWebsiteUrl && !/^https?:\/\//i.test(officialWebsiteUrl)) {
      const message = "イベントURLは http:// または https:// から入力してください";
      toast.error(message);
      setStep(0);
      throw new Error(message);
    }
    if (startDate && endDate && startDate > endDate) {
      const message = "終了日は開始日以降にしてください";
      toast.error(message);
      setStep(1);
      throw new Error(message);
    }
    setCreating(true);
    try {
      const result = await eventApi.create({
        eventName: eventName.trim(),
        description: description.trim() || undefined,
        officialWebsiteUrl: officialWebsiteUrl.trim() || null,
        logoUrl: logoUrl || null,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        hasPhysicalWristband,
        allowWristbandlessOrder,
        fontFamily,
        primaryColor,
        accentColor,
        backgroundColor,
        paymentMethods,
        storeAreas,
      });
      setCreatedEvent({ id: result.id, hasPhysicalWristband });
      createdEventRef.current = true;
      toast.success("イベントを作成しました");
      await createStaffInvite(result.id);
    } catch (error: any) {
      toast.error(error?.message || "イベントの作成に失敗しました");
      throw error instanceof Error ? error : new Error("イベントの作成に失敗しました。");
    } finally {
      setCreating(false);
    }
  };

  const createStaffInvite = async (eventId: string) => {
    setCreatingInvite(true);
    try {
      const result = await membershipApi.createInvite({ eventId, role: "event_manager", maxUses: 10, expiresInHours: 168 });
      setInvite({ token: result.token, code: result.code });
    } catch (error: any) {
      toast.error(error?.message || "スタッフ招待リンクを発行できませんでした。スタッフ管理から再発行できます");
    } finally {
      setCreatingInvite(false);
    }
  };

  const invitationUrl = invite ? `${window.location.origin}/join?inviteToken=${encodeURIComponent(invite.token)}` : "";
  // 2026-10-17: イベント作成前の入力を未保存変更として扱い、作成成功後は遷移確認の対象から外す。
  useUnsavedChanges({
    isDirty: () => !createdEventRef.current && (
      !!eventName.trim() || !!description.trim() || !!officialWebsiteUrl.trim() || !!logoUrl || uploadingLogo ||
      !!startDate || !!endDate || !hasPhysicalWristband || allowWristbandlessOrder || fontFamily !== "mono" ||
      primaryColor !== "#000000" || accentColor !== "#0000FF" || backgroundColor !== "#FFFFFF" ||
      JSON.stringify(paymentMethods) !== JSON.stringify(["現金"]) || !!newPayment.trim() ||
      storeAreas.length > 0 || !!newArea.trim()
    ),
    onSave: createEvent,
    onDiscard: onBack,
  });

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(invitationUrl);
      toast.success("招待リンクをコピーしました");
    } catch {
      toast.error("リンクをコピーできませんでした");
    }
  };

  if (createdEvent) {
    return (
      <div className="space-y-4">
        <div className="border-thin border-border bg-muted/30 p-4 space-y-2">
          <h2 className="font-headline text-lg">イベント管理スタッフを招待</h2>
          {invite ? (
            <>
              <p className="text-xs text-muted-foreground">招待リンクまたはコードを共有してください（7日間有効・最大10人）。</p>
              <Input aria-label="スタッフ招待リンク" readOnly value={invitationUrl} />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={copyInvite}>リンクをコピー</Button>
                <span className="text-sm">招待コード: <strong>{invite.code}</strong></span>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">招待リンクはスタッフ管理からいつでも発行できます。</p>
          )}
        </div>
        <Button className="w-full" disabled={creatingInvite} onClick={() => onComplete(createdEvent.id, createdEvent.hasPhysicalWristband)}>
          {creatingInvite ? "招待リンクを発行中…" : createdEvent.hasPhysicalWristband ? "リストバンドIDの作成へ進む" : "イベント管理を始める"}
        </Button>
      </div>
    );
  }

  const canAdvance = step !== 0 || !!eventName.trim();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2" aria-label="イベント作成の進行状況">
        {STEP_TITLES.map((title, index) => (
          <div key={title} className={`flex-1 border-b-thick pb-2 text-center text-[10px] font-bold ${index === step ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}>
            <span className="block">{index + 1}</span>{title}
          </div>
        ))}
      </div>

      {step === 0 && <div className="space-y-3">
        <div><Label htmlFor="eventName">イベント名</Label><Input id="eventName" value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="例: 第50回 志功祭" /></div>
        <div><Label htmlFor="eventDescription">説明・概要</Label><textarea id="eventDescription" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full border-thick border-border bg-input p-3 font-mono text-sm" placeholder="開催内容や来場者への案内" /></div>
        <div><Label htmlFor="officialWebsiteUrl">イベント公式サイトURL</Label><Input id="officialWebsiteUrl" type="url" value={officialWebsiteUrl} onChange={(e) => setOfficialWebsiteUrl(e.target.value)} placeholder="https://example.jp" /><p className="mt-1 text-[10px] text-muted-foreground">登録したURLは来場者向けの出店一覧に表示されます。</p></div>
      </div>}

      {step === 1 && <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="startDate">開始日</Label><Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
          <div><Label htmlFor="endDate">終了日</Label><Input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        </div>
        <label className="flex cursor-pointer items-center gap-3 border-thin border-border p-3 text-sm">
          <input type="checkbox" checked={hasPhysicalWristband} onChange={(e) => setHasPhysicalWristband(e.target.checked)} />
          物理リストバンドを使用する
        </label>
        {/* 2026-11-04: サークル側で個別に受付を選ぶためのイベント全体の許可。 */}
        <label className="flex items-center gap-3 text-sm font-bold">
          <input type="checkbox" checked={allowWristbandlessOrder} onChange={(e) => setAllowWristbandlessOrder(e.target.checked)} />
          リストバンドなしでの注文を許可する
        </label>
        <p className="text-xs text-muted-foreground">使用する場合、作成後にリストバンドIDを一括作成する画面へ進みます。</p>
      </div>}

      {step === 2 && <div className="space-y-4">
        <div className="space-y-2"><Label htmlFor="eventLogo">イベントロゴ</Label>
          {logoUrl && <img src={resolveAssetUrl(logoUrl)} alt="イベントロゴ" className="h-24 w-24 border-thick border-border object-contain" />}
          <Input id="eventLogo" type="file" accept="image/*" disabled={uploadingLogo} onChange={(e) => { void handleLogo(e.target.files?.[0]); e.currentTarget.value = ""; }} />
          {uploadingLogo && <p className="text-xs text-muted-foreground">アップロード中…</p>}
        </div>
        <div><Label htmlFor="eventFont">フォント</Label><select id="eventFont" className="w-full border-thick border-border bg-input p-3 font-mono" value={fontFamily} onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}><option value="mono">等幅</option><option value="sans">ゴシック</option><option value="serif">明朝</option></select></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="primaryColor">メインカラー</Label><Input id="primaryColor" type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} /></div>
          <div><Label htmlFor="accentColor">アクセントカラー</Label><Input id="accentColor" type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} /></div>
          <div><Label htmlFor="backgroundColor">背景色</Label><Input id="backgroundColor" type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} /></div>
        </div>
      </div>}

      {step === 3 && <div className="space-y-5">
        <section className="space-y-2"><Label>使用する支払い方法</Label>
          <div className="flex flex-wrap gap-2">{paymentMethods.map((method) => <button key={method} type="button" className="border-thin border-border px-2 py-1 text-xs" onClick={() => paymentMethods.length > 1 && setPaymentMethods((items) => items.filter((item) => item !== method))}>{method} ×</button>)}</div>
          <div className="flex gap-2"><Input value={newPayment} onChange={(e) => setNewPayment(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPayment(); } }} placeholder="例: クレジットカード" /><Button type="button" variant="outline" onClick={addPayment}>追加</Button></div>
          <p className="text-[10px] text-muted-foreground">項目を押すと削除できます。最低1つ必要です。</p>
        </section>
        <section className="space-y-2"><Label>店舗エリア</Label>
          <div className="flex flex-wrap gap-2">{storeAreas.map((area) => <button key={area.id} type="button" className="border-thin border-border px-2 py-1 text-xs" onClick={() => setStoreAreas((items) => items.filter((item) => item.id !== area.id))}>{area.name} ×</button>)}</div>
          <div className="flex gap-2"><Input value={newArea} onChange={(e) => setNewArea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addArea(); } }} placeholder="例: 1号館前" /><Button type="button" variant="outline" onClick={addArea}>追加</Button></div>
          <p className="text-[10px] text-muted-foreground">登録した店舗エリアはサークルの出店場所として選択でき、来場者にも表示されます。</p>
        </section>
      </div>}

      {step === 4 && <div className="space-y-2 border-thin border-border bg-muted/30 p-4 text-sm">
        <h2 className="font-headline text-lg">イベント作成内容</h2>
        <p><strong>イベント名:</strong> {eventName}</p><p><strong>説明:</strong> {description || "未設定"}</p>
        <p><strong>公式サイト:</strong> {officialWebsiteUrl || "未設定"}</p><p><strong>開催日:</strong> {startDate || "未設定"} ～ {endDate || "未設定"}</p>
        <p><strong>リストバンドなし注文:</strong> {allowWristbandlessOrder ? "許可する" : "許可しない"}</p>
        <p><strong>物理リストバンド:</strong> {hasPhysicalWristband ? "使用する" : "使用しない"}</p>
        <p><strong>支払い方法:</strong> {paymentMethods.join("、")}</p><p><strong>店舗エリア:</strong> {storeAreas.map((area) => area.name).join("、") || "未設定"}</p>
      </div>}

      <div className="flex gap-2">
        {step === 0 ? <Button type="button" variant="outline" onClick={() => requestNavigation(onBack)}>戻る</Button> : <Button type="button" variant="outline" onClick={() => setStep((current) => current - 1)}>前へ</Button>}
        {step < STEP_TITLES.length - 1 ? <Button type="button" className="flex-1" disabled={!canAdvance || uploadingLogo} onClick={() => setStep((current) => current + 1)}>次へ</Button> : <Button type="button" className="flex-1" disabled={creating || !paymentMethods.length} onClick={() => void createEvent().catch(() => undefined)}>{creating ? "作成中…" : "イベントを作成"}</Button>}
      </div>
    </div>
  );
}

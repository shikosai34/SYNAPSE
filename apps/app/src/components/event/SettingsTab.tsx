import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eventApi, uploadImage, parseEventPaymentMethods } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save, Upload, Loader2, Palette, CreditCard, Plus, X, Ticket } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { toast } from "sonner";

interface SettingsTabProps {
  eventId: string;
  event: any; // イベント詳細情報
}

// テーマカラーの既定値 (event スキーマの default と一致させる)
const DEFAULT_THEME = {
  primaryColor: "#000000",
  primaryTextColor: "#FFFFFF",
  accentColor: "#0000FF",
  accentTextColor: "#FFFFFF",
  backgroundColor: "#FFFFFF",
  textColor: "#000000",
  fontFamily: "mono",
};

const FONT_OPTIONS = [
  { value: "mono", label: "等幅 (Mono)" },
  { value: "sans", label: "ゴシック (Sans)" },
  { value: "serif", label: "明朝 (Serif)" },
];

export function SettingsTab({ eventId, event }: SettingsTabProps) {
  const queryClient = useQueryClient();

  // 支払い方法 (2026-07-12): テーマ保存とは独立して管理・保存する。
  const [payments, setPayments] = useState<string[]>([]);
  const [newPayment, setNewPayment] = useState("");
  useEffect(() => {
    if (event) setPayments(parseEventPaymentMethods(event.paymentMethods));
  }, [event]);
  const savePayments = useMutation({
    mutationFn: () => eventApi.setPaymentMethods(eventId, payments),
    onSuccess: () => {
      toast.success("支払い方法を保存しました");
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
    onError: (e: any) => toast.error(e?.message || "保存に失敗しました"),
  });
  const addPayment = () => {
    const v = newPayment.trim();
    if (!v || payments.includes(v)) return;
    setPayments((p) => [...p, v]);
    setNewPayment("");
  };

  // 抽選機能(拡張)の有効化トグル (2026-07-12)。event.lotteryEnabled を更新する。
  const [lotteryEnabled, setLotteryEnabled] = useState(false);
  useEffect(() => {
    if (event) setLotteryEnabled(!!event.lotteryEnabled);
  }, [event]);
  const saveLottery = useMutation({
    mutationFn: (enabled: boolean) => eventApi.setLotteryEnabled(eventId, enabled),
    onSuccess: () => {
      toast.success("抽選機能の設定を保存しました");
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
    onError: (e: any) => toast.error(e?.message || "保存に失敗しました"),
  });

  const [form, setForm] = useState({
    eventName: "",
    description: "",
    startDate: "",
    endDate: "",
    logoUrl: "",
    hasPhysicalWristband: true,
    ...DEFAULT_THEME,
  });

  useEffect(() => {
    if (event) {
      setForm({
        // 2026-07-06: DB 上のフィールドは eventName。念のため name も許容する。
        eventName: event.eventName || event.name || "",
        description: event.description || "",
        startDate: event.startDate ? String(event.startDate).slice(0, 10) : "",
        endDate: event.endDate ? String(event.endDate).slice(0, 10) : "",
        logoUrl: event.logoUrl || "",
        hasPhysicalWristband: event.hasPhysicalWristband !== undefined ? event.hasPhysicalWristband : true,
        primaryColor: event.primaryColor || DEFAULT_THEME.primaryColor,
        primaryTextColor: event.primaryTextColor || DEFAULT_THEME.primaryTextColor,
        accentColor: event.accentColor || DEFAULT_THEME.accentColor,
        accentTextColor: event.accentTextColor || DEFAULT_THEME.accentTextColor,
        backgroundColor: event.backgroundColor || DEFAULT_THEME.backgroundColor,
        textColor: event.textColor || DEFAULT_THEME.textColor,
        fontFamily: event.fontFamily || DEFAULT_THEME.fontFamily,
      });
    }
  }, [event]);

  // 設定更新 API
  const updateEventMutation = useMutation({
    mutationFn: (data: typeof form) =>
      eventApi.updateTheme(eventId, {
        eventName: data.eventName,
        description: data.description,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        logoUrl: data.logoUrl || null,
        hasPhysicalWristband: data.hasPhysicalWristband,
        primaryColor: data.primaryColor,
        primaryTextColor: data.primaryTextColor,
        accentColor: data.accentColor,
        accentTextColor: data.accentTextColor,
        backgroundColor: data.backgroundColor,
        textColor: data.textColor,
        fontFamily: data.fontFamily,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      toast.success("イベント設定を更新しました");
    },
    onError: (err: any) => {
      toast.error(err.message || "設定の保存に失敗しました");
    },
  });

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      toast.loading("画像をアップロード中...", { id: "logo-upload" });
      const res = await uploadImage(file);
      const baseUrl = import.meta.env.VITE_API_URL || "http://localhost:8787";
      const fullUrl = res.path.startsWith("http") ? res.path : `${baseUrl}${res.path}`;

      setForm((prev) => ({ ...prev, logoUrl: fullUrl }));
      toast.success("画像をアップロードしました", { id: "logo-upload" });
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "アップロードに失敗しました", { id: "logo-upload" });
    }
  };

  const handleSaveSettings = () => {
    if (!form.eventName) {
      toast.error("イベント名は必須です");
      return;
    }
    updateEventMutation.mutate(form);
  };

  const setColor = (key: keyof typeof DEFAULT_THEME, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6 font-mono text-foreground">
      <div className="flex justify-between items-center border-b-thick border-border pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
          <Settings className="h-4 w-4" />
          イベント基本設定・テーマ
        </h2>
      </div>

      {/* 支払い方法 (2026-07-12) */}
      <Card className="rounded-none bg-background shadow-none">
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-2 border-b-thin border-border pb-2">
            <CreditCard className="h-4 w-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider">支払い方法</h3>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground leading-[1.6]">
            イベントで使える支払い方法を登録します。各サークルはこの中から対応する方法を選び、
            レジで選択して注文します(1つだけ対応のサークルは選択を省略)。
          </p>
          <div className="flex flex-wrap gap-2">
            {payments.map((p) => (
              <span key={p} className="flex items-center gap-1 border-thick border-border px-2 py-1 font-mono text-[12px]">
                {p}
                <button
                  type="button"
                  onClick={() => setPayments((prev) => prev.filter((x) => x !== p))}
                  disabled={payments.length <= 1}
                  className="text-muted-foreground hover:text-error disabled:opacity-30"
                  title={payments.length <= 1 ? "最低1つ必要です" : "削除"}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newPayment}
              onChange={(e) => setNewPayment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPayment())}
              placeholder="例: PayPay / 金券"
              maxLength={30}
              className="max-w-xs"
            />
            <Button type="button" variant="outline" onClick={addPayment}>
              <Plus className="h-4 w-4 mr-1" /> 追加
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => savePayments.mutate()} disabled={savePayments.isPending}>
              <Save className="h-4 w-4 mr-1.5" /> {savePayments.isPending ? "保存中..." : "支払い方法を保存"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 抽選 (拡張機能) */}
      <Card className="rounded-none bg-background shadow-none">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <Ticket className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-xs font-bold uppercase tracking-wider">抽選機能</h3>
                <p className="font-mono text-[11px] text-muted-foreground leading-[1.6] mt-0.5">
                  ONにすると「抽選」タブが有効になり、景品と口数(当選確率)を設定して抽選できます。
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={lotteryEnabled}
              onChange={(v) => { setLotteryEnabled(v); saveLottery.mutate(v); }}
              disabled={saveLottery.isPending}
              label="抽選機能"
            />
          </div>
        </CardContent>
      </Card>

      {/* 基本情報 + ロゴ */}
      <Card className="rounded-none bg-background shadow-none">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 設定項目 */}
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="settingsEventName" className="text-xs font-bold uppercase">イベント名 *</Label>
                <Input
                  id="settingsEventName"
                  value={form.eventName}
                  onChange={(e) => setForm({ ...form, eventName: e.target.value })}
                  className="border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="settingsDescription" className="text-xs font-bold uppercase">説明・概要</Label>
                <Input
                  id="settingsDescription"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="settingsStartDate" className="text-xs font-bold uppercase">開始日</Label>
                  <Input
                    id="settingsStartDate"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="settingsEndDate" className="text-xs font-bold uppercase">終了日</Label>
                  <Input
                    id="settingsEndDate"
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="border-thick border-border rounded-none focus-visible:ring-0 h-10 text-xs bg-background font-mono"
                  />
                </div>
              </div>

              {/* 物理リストバンド有無設定 */}
              <div className="flex items-center gap-3 border-thick border-border p-3 bg-muted/10">
                <input
                  id="hasPhysicalWristband"
                  type="checkbox"
                  checked={form.hasPhysicalWristband}
                  onChange={(e) => setForm({ ...form, hasPhysicalWristband: e.target.checked })}
                  className="h-4 w-4 border-thick border-border bg-background cursor-pointer focus:ring-0"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="hasPhysicalWristband" className="text-xs font-bold uppercase cursor-pointer">物理リストバンドを使用する</Label>
                  <p className="text-[9px] text-muted-foreground leading-normal">
                    OFFにすると、物理バンドの発行手順がスキップされ、来場者はスマホのデジタルQRのみで入場・注文ができます。
                  </p>
                </div>
              </div>
            </div>

            {/* ロゴ画像アップロード */}
            <div className="space-y-2 border-thick border-dashed border-border p-4 flex flex-col justify-center items-center bg-muted/20">
              <Label className="text-xs font-bold uppercase text-muted-foreground block text-center mb-2">イベント画像（ロゴ・背景用）</Label>

              {form.logoUrl ? (
                <div className="space-y-2 text-center w-full">
                  <img
                    src={form.logoUrl}
                    alt="Event logo"
                    className="max-h-24 mx-auto block border-thick border-border bg-background"
                  />
                  <button
                    onClick={() => setForm((prev) => ({ ...prev, logoUrl: "" }))}
                    className="text-[10px] font-bold text-destructive uppercase underline block mx-auto cursor-pointer"
                  >
                    画像を削除
                  </button>
                </div>
              ) : (
                <div className="text-center space-y-2">
                  <div className="bg-background border-thick border-border p-3 inline-block">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase">PNG, JPG (Max 5MB)</p>
                </div>
              )}

              <div className="pt-2">
                <input
                  type="file"
                  accept="image/*"
                  id="logo-file-input"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <Label
                  htmlFor="logo-file-input"
                  className="border-thick border-border bg-background hover:bg-muted text-[10px] font-bold uppercase px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5"
                >
                  画像ファイルを選択
                </Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* テーマカラー */}
      <Card className="rounded-none bg-background shadow-none">
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-center gap-2 border-b-thick border-border pb-3">
            <Palette className="h-4 w-4" />
            <h3 className="text-xs font-bold uppercase tracking-wider">テーマカラー</h3>
            <span className="text-[10px] text-muted-foreground normal-case">
              来場者のイベント画面に反映されます
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <ColorField label="メインカラー" value={form.primaryColor} onChange={(v) => setColor("primaryColor", v)} />
              <ColorField label="メイン文字色" value={form.primaryTextColor} onChange={(v) => setColor("primaryTextColor", v)} />
              <ColorField label="アクセントカラー" value={form.accentColor} onChange={(v) => setColor("accentColor", v)} />
              <ColorField label="アクセント文字色" value={form.accentTextColor} onChange={(v) => setColor("accentTextColor", v)} />
              <ColorField label="背景色" value={form.backgroundColor} onChange={(v) => setColor("backgroundColor", v)} />
              <ColorField label="本文文字色" value={form.textColor} onChange={(v) => setColor("textColor", v)} />
              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground">フォント</Label>
                <select
                  value={form.fontFamily}
                  onChange={(e) => setForm({ ...form, fontFamily: e.target.value })}
                  className="w-full border-thick border-border rounded-none h-9 text-xs bg-background px-2 focus-visible:ring-0 font-mono"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ライブプレビュー */}
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">プレビュー</Label>
              <div
                className="border-thick border-border p-4 space-y-3"
                style={{ backgroundColor: form.backgroundColor, color: form.textColor }}
              >
                {form.logoUrl && (
                  <img src={form.logoUrl} alt="" className="max-h-12 border-thick" style={{ borderColor: form.primaryColor }} />
                )}
                <div
                  className="p-3 font-bold uppercase text-sm"
                  style={{ backgroundColor: form.primaryColor, color: form.primaryTextColor }}
                >
                  {form.eventName || "イベント名"}
                </div>
                <p className="text-xs" style={{ color: form.textColor }}>
                  本文サンプル。来場者向けメニュー画面ではこの配色が使われます。
                </p>
                <button
                  type="button"
                  className="px-3 py-2 text-xs font-bold uppercase border-thick"
                  style={{
                    backgroundColor: form.accentColor,
                    color: form.accentTextColor,
                    borderColor: form.accentColor,
                  }}
                >
                  アクセントボタン
                </button>
              </div>
            </div>
          </div>

          <div className="border-t-thick border-border pt-4 flex justify-end">
            <Button
              onClick={handleSaveSettings}
              disabled={!form.eventName || updateEventMutation.isPending}
              className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-10 text-xs font-bold rounded-none shadow-none px-4 flex items-center gap-1.5"
            >
              {updateEventMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              設定を保存する
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// カラー入力行: カラーピッカー + hex テキストを同期
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-[11px] font-bold uppercase">{label}</Label>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 border-thick border-border rounded-none bg-background cursor-pointer p-0"
          aria-label={`${label} カラーピッカー`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-24 border-thick border-border rounded-none bg-background text-xs font-mono px-2 uppercase focus-visible:outline-none"
          aria-label={`${label} 16進数`}
        />
      </div>
    </div>
  );
}

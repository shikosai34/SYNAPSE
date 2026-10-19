import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, History, Loader2, Plus, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useUnsavedChanges } from "@/components/UnsavedNavigationGuard";
import { AllergenSelector } from "@/components/menu/AllergenSelector";
import { Button } from "@/components/ui/button";
import { FormField, FormSelect, formControlClassName } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/Modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import {
  wristbandApi,
  type VisitorAccountStatus,
  type VisitorAdminEditorData,
  type VisitorAdminEditorUpdate,
  type WristbandStatus,
} from "@/lib/api";

type EditorDraft = {
  profile: {
    displayId: number | "";
    status: VisitorAccountStatus;
    nickname: string;
    favoriteDate: string;
    birthdayMonthDay: string;
    age: number | "";
    allergies: VisitorAdminEditorUpdate["profile"]["allergies"];
    onboardedAt: string;
  };
  wristbands: Array<{
    draftKey: string;
    id: string;
    isNew: boolean;
    status: WristbandStatus;
    nickname: string;
    birthdayMonthDay: string;
    age: number | "";
    onboardedAt: string;
    assignedAt: string;
    deactivatedAt: string;
  }>;
  circleVisits: Array<{
    draftKey: string;
    id?: string;
    isNew: boolean;
    isDeleted: boolean;
    circleId: string;
    staffId: string;
    createdAt: string;
  }>;
};

const ACCOUNT_STATUS_HELP: Record<VisitorAccountStatus, string> = {
  available: "このイベントの来場者アカウントに利用禁止は設定されていない状態です。",
  banned: "注文やレビューなど、このイベントでの来場者操作を禁止する状態です。来場者データ自体は削除されません。",
};

const WRISTBAND_STATUS_HELP: Record<WristbandStatus, string> = {
  active: "物理リストバンドとして利用できる状態です。",
  smartphone: "スマートフォン用QRとして利用できる状態です。",
  lost: "紛失扱いで利用を停止した状態です。",
  replaced: "再発行により旧バンドの利用を停止した状態です。",
  revoked: "管理者が手動で利用を停止した状態です。",
};

const WRISTBAND_STATUS_LABEL: Record<WristbandStatus, string> = {
  active: "有効・物理リストバンド",
  smartphone: "有効・スマートフォンQR",
  lost: "停止・紛失",
  replaced: "停止・再発行済み",
  revoked: "停止・管理者が無効化",
};

function toLocalDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseAllergies(value: string | null): VisitorAdminEditorUpdate["profile"]["allergies"] {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as VisitorAdminEditorUpdate["profile"]["allergies"] : null;
  } catch {
    return null;
  }
}

function toDraft(data: VisitorAdminEditorData): EditorDraft {
  return {
    profile: {
      displayId: data.user.displayId,
      status: data.user.status,
      nickname: data.user.nickname ?? "",
      favoriteDate: data.user.favoriteDate ?? "",
      birthdayMonthDay: data.user.birthdayMonthDay ?? "",
      age: data.user.age ?? "",
      allergies: parseAllergies(data.user.allergies),
      onboardedAt: toLocalDateTime(data.user.onboardedAt),
    },
    wristbands: data.wristbands.map((band) => ({
      draftKey: band.id,
      id: band.id,
      isNew: false,
      status: band.status,
      nickname: band.nickname ?? "",
      birthdayMonthDay: band.birthdayMonthDay ?? "",
      age: band.age ?? "",
      onboardedAt: toLocalDateTime(band.onboardedAt),
      assignedAt: toLocalDateTime(band.assignedAt),
      deactivatedAt: toLocalDateTime(band.deactivatedAt),
    })),
    circleVisits: data.circleVisits.map((visit) => ({
      draftKey: visit.id,
      id: visit.id,
      isNew: false,
      isDeleted: false,
      circleId: visit.circleId,
      staffId: visit.staffId ?? "",
      createdAt: toLocalDateTime(visit.createdAt),
    })),
  };
}

export function VisitorRecordEditor({
  eventId,
  userId,
  onClose,
}: {
  eventId: string;
  userId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["visitorAdminEditor", eventId, userId],
    queryFn: () => wristbandApi.adminEditor(eventId, userId),
  });
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<EditorDraft | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (detailQuery.data && draft === null) {
      const next = toDraft(detailQuery.data);
      setDraft(next);
      setSavedDraft(next);
    }
  }, [detailQuery.data, draft]);

  const saveMutation = useMutation({
    mutationFn: (data: VisitorAdminEditorUpdate) => wristbandApi.updateAdminEditor(eventId, userId, data),
  });
  const isDirty = !!draft && !!savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  const buildUpdate = (): VisitorAdminEditorUpdate => {
    if (!draft || draft.profile.displayId === "") throw new Error("呼出IDを入力してください。");
    if (draft.wristbands.some((band) => !band.id.trim() || !fromLocalDateTime(band.assignedAt))) {
      throw new Error("各リストバンドのIDと割当日時を入力してください。");
    }
    if (draft.circleVisits.some((visit) => !visit.isDeleted && (!visit.circleId || !fromLocalDateTime(visit.createdAt)))) {
      throw new Error("サークルと利用日時を入力してください。");
    }

    return {
      profile: {
        displayId: Number(draft.profile.displayId),
        status: draft.profile.status,
        nickname: draft.profile.nickname.trim() || null,
        favoriteDate: draft.profile.favoriteDate.trim() || null,
        birthdayMonthDay: draft.profile.birthdayMonthDay.trim() || null,
        age: draft.profile.age === "" ? null : Number(draft.profile.age),
        allergies: draft.profile.allergies,
        onboardedAt: fromLocalDateTime(draft.profile.onboardedAt),
      },
      wristbands: draft.wristbands.map((band) => ({
        id: band.id.trim(),
        isNew: band.isNew,
        status: band.status,
        nickname: band.nickname.trim() || null,
        birthdayMonthDay: band.birthdayMonthDay.trim() || null,
        age: band.age === "" ? null : Number(band.age),
        onboardedAt: fromLocalDateTime(band.onboardedAt),
        assignedAt: fromLocalDateTime(band.assignedAt)!,
        deactivatedAt: fromLocalDateTime(band.deactivatedAt),
      })),
      circleVisits: draft.circleVisits.map((visit) => ({
        ...(visit.id ? { id: visit.id } : {}),
        isNew: visit.isNew,
        isDeleted: visit.isDeleted,
        circleId: visit.circleId,
        staffId: visit.staffId.trim() || null,
        createdAt: fromLocalDateTime(visit.createdAt) ?? new Date().toISOString(),
      })),
    };
  };

  const saveDraft = async () => {
    setSaveError(null);
    const payload = buildUpdate();
    const snapshot = structuredClone(draft);
    await saveMutation.mutateAsync(payload);
    // 保存中に追加入力された変更を消さず、送信した内容だけを保存済み基準にする。
    setSavedDraft(snapshot);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["eventVisitors"] }),
      queryClient.invalidateQueries({ queryKey: ["lostWristbands", eventId] }),
      queryClient.invalidateQueries({ queryKey: ["visitorAdminEditor", eventId, userId] }),
    ]);
    toast.success("来場者情報を保存しました");
  };

  useUnsavedChanges({
    isDirty: detailQuery.isSuccess && isDirty,
    onSave: saveDraft,
    onDiscard: () => {
      if (savedDraft) setDraft(savedDraft);
    },
  });

  const requestClose = () => {
    if (isDirty) {
      setSaveError(null);
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  const saveAndClose = async () => {
    try {
      await saveDraft();
      setConfirmClose(false);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存に失敗しました。");
    }
  };

  const editProfile = (value: Partial<EditorDraft["profile"]>) => {
    setDraft((current) => current ? { ...current, profile: { ...current.profile, ...value } } : current);
  };

  const editBand = (index: number, value: Partial<EditorDraft["wristbands"][number]>) => {
    setDraft((current) => current ? {
      ...current,
      wristbands: current.wristbands.map((band, bandIndex) => bandIndex === index ? { ...band, ...value } : band),
    } : current);
  };

  const removeBand = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const band = current.wristbands[index];
      if (!band) return current;
      // 既存バンドを物理削除すると使用履歴との対応が失われるため、無効化状態へ移し履歴を残す。
      if (!band.isNew) {
        return {
          ...current,
          wristbands: current.wristbands.map((item, bandIndex) => bandIndex === index
            ? { ...item, status: "revoked", deactivatedAt: toLocalDateTime(new Date()) }
            : item),
        };
      }
      return { ...current, wristbands: current.wristbands.filter((_, bandIndex) => bandIndex !== index) };
    });
  };

  const addWristband = () => {
    setDraft((current) => current ? {
      ...current,
      wristbands: [...current.wristbands, {
        draftKey: `new-band-${crypto.randomUUID()}`,
        id: "",
        isNew: true,
        status: "active",
        nickname: "",
        birthdayMonthDay: "",
        age: "",
        onboardedAt: "",
        assignedAt: toLocalDateTime(new Date()),
        deactivatedAt: "",
      }],
    } : current);
  };

  const editVisit = (index: number, value: Partial<EditorDraft["circleVisits"][number]>) => {
    setDraft((current) => current ? {
      ...current,
      circleVisits: current.circleVisits.map((visit, visitIndex) => visitIndex === index ? { ...visit, ...value } : visit),
    } : current);
  };

  const removeVisit = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const visit = current.circleVisits[index];
      if (!visit) return current;
      if (visit.isNew) return { ...current, circleVisits: current.circleVisits.filter((_, visitIndex) => visitIndex !== index) };
      return { ...current, circleVisits: current.circleVisits.map((item, visitIndex) => visitIndex === index ? { ...item, isDeleted: true } : item) };
    });
  };

  if (detailQuery.isLoading || !draft || !detailQuery.data) {
    return (
      <Modal isOpen title="[来場者情報を編集]" subtitle="アカウント、リストバンド、家族、サークル利用実績を編集します。" onClose={requestClose} maxWidth="xl">
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm" role="status">
          <Loader2 className="h-5 w-5 animate-spin" /> 来場者情報を読み込んでいます
        </div>
        {detailQuery.isError && <p role="alert" className="text-sm text-destructive">{detailQuery.error.message}</p>}
      </Modal>
    );
  }

  const { user, circles } = detailQuery.data;
  const validToSave = draft.profile.displayId !== "" &&
    draft.wristbands.every((band) => band.id.trim() && fromLocalDateTime(band.assignedAt)) &&
    draft.circleVisits.every((visit) => visit.isDeleted || (visit.circleId && fromLocalDateTime(visit.createdAt)));

  return (
    <>
      <Modal
        isOpen
        title="[来場者情報を編集]"
        subtitle="イベントアカウント、紐付く全バンド、サークル体験ログをまとめて編集します。"
        onClose={requestClose}
        maxWidth="xl"
      >
        {/* 2026-10-20: 2カラムの入力幅を抑えるため、編集内容に合わせた xl モーダルを使う。 */}
        <div className="w-full">
        <div className="mb-4 flex flex-col gap-2 border-b-thin border-border pb-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="break-all"><span className="font-bold">来場者ID:</span> {user.id}</p>
          <p className="text-[10px] text-muted-foreground">作成日時 {new Date(user.createdAt).toLocaleString("ja-JP")} · 更新日時 {new Date(user.updatedAt).toLocaleString("ja-JP")}</p>
        </div>

        <div className="mb-4 flex items-start gap-2 border-l-heavy border-info bg-info/5 p-3 text-xs leading-relaxed">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p>この画面の「アカウント」はイベント専用の来場者アカウントです。ログイン用メールアカウントとの紐付けはありません。システムIDは履歴との対応に使うため変更できません。</p>
        </div>

        {saveError && <p role="alert" className="mb-3 border-l-heavy border-error bg-error/5 p-3 text-xs text-error">{saveError}</p>}

        <Tabs defaultValue="account" className="w-full">
          <TabsList className="grid h-auto grid-cols-1 gap-1 sm:grid-cols-3">
            <TabsTrigger value="account" className="min-h-12 px-2">アカウント</TabsTrigger>
            <TabsTrigger value="wristbands" className="min-h-12 px-2">リストバンド・家族</TabsTrigger>
            <TabsTrigger value="visits" className="min-h-12 px-2">サークル利用実績</TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-4">
            <section className="space-y-1">
              <h3 className="flex items-center gap-2 border-b-thin border-border pb-2 text-sm font-bold"><Users className="h-4 w-4" />イベント来場者アカウント</h3>
              <p className="text-[11px] leading-relaxed text-muted-foreground">ここで変更する状態は、このイベント内で来場者アカウントを利用できるかどうかです。受付登録の完了状態とは別です。</p>
            </section>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                id="visitor-display-id"
                label="呼出ID（イベント内で一意）"
                type="number"
                min={1}
                value={draft.profile.displayId}
                onChange={(event) => editProfile({ displayId: event.target.value ? Number(event.target.value) : "" })}
              />
              <FormField id="visitor-nickname" label="ニックネーム" value={draft.profile.nickname} onChange={(event) => editProfile({ nickname: event.target.value })} />
              <FormField id="visitor-favorite-date" label="お好きな日付" type="date" value={draft.profile.favoriteDate} onChange={(event) => editProfile({ favoriteDate: event.target.value })} />
              <FormField id="visitor-birthday" label="誕生日（月日）" type="text" placeholder="MM-DD" maxLength={5} value={draft.profile.birthdayMonthDay} onChange={(event) => editProfile({ birthdayMonthDay: event.target.value })} />
              <FormField id="visitor-age" label="年齢" type="number" min={0} max={120} value={draft.profile.age} onChange={(event) => editProfile({ age: event.target.value ? Number(event.target.value) : "" })} />
              <FormSelect id="visitor-account-status" label="イベント来場者アカウントの利用状態" value={draft.profile.status} onChange={(event) => editProfile({ status: event.target.value as VisitorAccountStatus })}>
                <option value="available">利用可能</option>
                <option value="banned">利用禁止</option>
              </FormSelect>
            </div>
            <p className="-mt-2 text-[10px] leading-relaxed text-muted-foreground">{ACCOUNT_STATUS_HELP[draft.profile.status]}</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-xs font-bold uppercase" htmlFor="visitor-onboarded-at">
                <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />受付・プロフィール登録の完了日時</span>
                <Input id="visitor-onboarded-at" type="datetime-local" className={formControlClassName} value={draft.profile.onboardedAt} onChange={(event) => editProfile({ onboardedAt: event.target.value })} />
                <span className="block text-[10px] font-normal normal-case text-muted-foreground">空欄は未登録です。アカウントの利用状態とは別に記録されます。</span>
              </label>
            </div>

            <AllergenSelector
              value={draft.profile.allergies}
              onChange={(allergies) => editProfile({ allergies })}
              helpText="このイベント来場者アカウントに登録するアレルゲンです。家族共通の登録内容として保存されます。"
            />
          </TabsContent>

          <TabsContent value="wristbands" className="space-y-4">
            <div className="flex flex-col gap-3 border-b-thin border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4" />本人・家族のリストバンド</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">同じ来場者アカウントに紐付く全バンドです。バンドIDは履歴を保つため変更不可です。</p>
              </div>
              <Button onClick={addWristband} variant="outline" className="h-10 shrink-0 border-thick border-border text-xs font-bold">
                <Plus className="mr-1 h-4 w-4" />家族用バンドを追加
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-2 border-thin border-border bg-muted/10 p-3 text-[10px] sm:grid-cols-2">
              {(Object.keys(WRISTBAND_STATUS_HELP) as WristbandStatus[]).map((status) => (
                <p key={status}><span className="font-bold">{WRISTBAND_STATUS_LABEL[status]}:</span> {WRISTBAND_STATUS_HELP[status]}</p>
              ))}
            </div>

            {draft.wristbands.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">紐付くバンドはありません。「家族用バンドを追加」から登録できます。</p>}
            <div className="space-y-4">
              {draft.wristbands.map((band, index) => (
                <section key={band.draftKey} className="space-y-4 border-thick border-border p-3 sm:p-4">
                  <div className="flex flex-col gap-2 border-b-thin border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="text-xs font-bold">{band.isNew ? "新しい家族バンド" : `バンド ${index + 1}`}</h4>
                      <p className="mt-1 text-[10px] text-muted-foreground">{WRISTBAND_STATUS_HELP[band.status]}</p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => removeBand(index)} className="h-9 border-thick border-error text-xs text-error">
                      <Trash2 className="mr-1 h-3.5 w-3.5" />{band.isNew ? "入力を取り消す" : "無効化"}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField id={`band-id-${band.draftKey}`} label="リストバンドID" value={band.id} disabled={!band.isNew} onChange={(event) => editBand(index, { id: event.target.value })} />
                    <FormSelect id={`band-status-${band.draftKey}`} label="リストバンド・QRの利用状態" value={band.status} onChange={(event) => {
                      const nextStatus = event.target.value as WristbandStatus;
                      const isEnabled = nextStatus === "active" || nextStatus === "smartphone";
                      editBand(index, {
                        status: nextStatus,
                        deactivatedAt: isEnabled ? "" : band.deactivatedAt || toLocalDateTime(new Date()),
                      });
                    }}>
                      {(Object.keys(WRISTBAND_STATUS_LABEL) as WristbandStatus[]).map((status) => <option key={status} value={status}>{WRISTBAND_STATUS_LABEL[status]}</option>)}
                    </FormSelect>
                    <FormField id={`band-nickname-${band.draftKey}`} label="本人・家族のニックネーム" value={band.nickname} onChange={(event) => editBand(index, { nickname: event.target.value })} />
                    <FormField id={`band-birthday-${band.draftKey}`} label="誕生日（月日）" placeholder="MM-DD" maxLength={5} value={band.birthdayMonthDay} onChange={(event) => editBand(index, { birthdayMonthDay: event.target.value })} />
                    <FormField id={`band-age-${band.draftKey}`} label="年齢" type="number" min={0} max={120} value={band.age} onChange={(event) => editBand(index, { age: event.target.value ? Number(event.target.value) : "" })} />
                    <label className="block space-y-1 text-xs font-bold uppercase" htmlFor={`band-assigned-${band.draftKey}`}>
                      <span>割当日時</span>
                      <Input id={`band-assigned-${band.draftKey}`} type="datetime-local" className={formControlClassName} value={band.assignedAt} onChange={(event) => editBand(index, { assignedAt: event.target.value })} />
                    </label>
                    <label className="block space-y-1 text-xs font-bold uppercase" htmlFor={`band-onboarded-${band.draftKey}`}>
                      <span>このバンドの受付登録日時</span>
                      <Input id={`band-onboarded-${band.draftKey}`} type="datetime-local" className={formControlClassName} value={band.onboardedAt} onChange={(event) => editBand(index, { onboardedAt: event.target.value })} />
                    </label>
                    <label className="block space-y-1 text-xs font-bold uppercase" htmlFor={`band-deactivated-${band.draftKey}`}>
                      <span>利用停止日時</span>
                      <Input id={`band-deactivated-${band.draftKey}`} type="datetime-local" className={formControlClassName} value={band.deactivatedAt} onChange={(event) => editBand(index, { deactivatedAt: event.target.value })} />
                      <span className="block text-[10px] font-normal normal-case text-muted-foreground">有効状態に戻す場合は空欄にしてください。</span>
                    </label>
                  </div>
                </section>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="visits" className="space-y-4">
            <div className="flex flex-col gap-3 border-b-thin border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><History className="h-4 w-4" />サークル体験ログ</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">受付・レジで記録された体験実績です。注文履歴やスタンプとは別の記録です。</p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={circles.length === 0}
                onClick={() => setDraft((current) => current ? {
                  ...current,
                  circleVisits: [...current.circleVisits, {
                    draftKey: `new-visit-${crypto.randomUUID()}`,
                    isNew: true,
                    isDeleted: false,
                    circleId: circles[0]?.id ?? "",
                    staffId: "",
                    createdAt: toLocalDateTime(new Date()),
                  }],
                } : current)}
                className="h-10 shrink-0 border-thick border-border text-xs font-bold"
              >
                <Plus className="mr-1 h-4 w-4" />利用実績を追加
              </Button>
            </div>

            {circles.length === 0 && <p className="text-xs text-muted-foreground">このイベントには選択できるサークルがありません。</p>}
            {draft.circleVisits.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">サークル体験ログはありません。</p>}
            <div className="space-y-3">
              {draft.circleVisits.map((visit, index) => (
                <section key={visit.draftKey} className={`space-y-3 border-thick p-3 sm:p-4 ${visit.isDeleted ? "border-error bg-error/5 opacity-70" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-xs font-bold">{visit.isNew ? "新しい利用実績" : `利用実績 ${index + 1}`}{visit.isDeleted && "（保存時に削除）"}</h4>
                    {!visit.isDeleted && <Button type="button" variant="outline" onClick={() => removeVisit(index)} className="h-9 border-thick border-error text-xs text-error"><Trash2 className="mr-1 h-3.5 w-3.5" />削除</Button>}
                    {visit.isDeleted && <Button type="button" variant="outline" onClick={() => editVisit(index, { isDeleted: false })} className="h-9 border-thick border-border text-xs">取り消す</Button>}
                  </div>
                  {!visit.isDeleted && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormSelect id={`visit-circle-${visit.draftKey}`} label="利用サークル" value={visit.circleId} onChange={(event) => editVisit(index, { circleId: event.target.value })}>
                        {circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
                      </FormSelect>
                      <FormField id={`visit-staff-${visit.draftKey}`} label="対応スタッフID（任意）" value={visit.staffId} onChange={(event) => editVisit(index, { staffId: event.target.value })} />
                      <label className="block space-y-1 text-xs font-bold uppercase" htmlFor={`visit-created-${visit.draftKey}`}>
                        <span>利用日時</span>
                        <Input id={`visit-created-${visit.draftKey}`} type="datetime-local" className={formControlClassName} value={visit.createdAt} onChange={(event) => editVisit(index, { createdAt: event.target.value })} />
                      </label>
                    </div>
                  )}
                </section>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <div className="sticky bottom-0 mt-5 flex flex-col-reverse gap-2 border-t-thick border-border bg-background py-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={requestClose} className="h-10 border-thick border-border text-xs font-bold">閉じる</Button>
          <Button onClick={() => void saveDraft().catch((error) => setSaveError(error instanceof Error ? error.message : "保存に失敗しました。"))} disabled={!isDirty || !validToSave || saveMutation.isPending} className="h-10 border-thick border-primary bg-primary px-5 text-xs font-bold text-primary-foreground hover:bg-background hover:text-foreground">
            {saveMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}変更を保存
          </Button>
        </div>
        </div>
      </Modal>

      <UnsavedChangesDialog
        isOpen={confirmClose}
        title="未保存の変更があります"
        description="保存して閉じるか、変更を破棄して閉じてください。"
        confirmLabel="保存して閉じる"
        discardLabel="保存せず閉じる"
        cancelLabel="編集を続ける"
        isPending={saveMutation.isPending}
        errorMessage={saveError}
        onConfirm={() => void saveAndClose()}
        onDiscard={() => {
          if (savedDraft) setDraft(savedDraft);
          setConfirmClose(false);
          onClose();
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  );
}

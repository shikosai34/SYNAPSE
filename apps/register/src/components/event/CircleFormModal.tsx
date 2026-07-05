import { circleApi } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  FormField,
  FormSubmitButton,
  EditModeBanner,
} from "@/components/ui/FormField";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useEntityForm } from "@/hooks/useEntityForm";
import { Save } from "lucide-react";

interface CircleFormModalProps {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
  circle?: any | null; // 編集時は既存のCircleオブジェクトを渡す
}

type CircleForm = {
  name: string;
  managerPin: string;
  managerEmail: string;
  managerName: string;
  description: string;
};

export function CircleFormModal({ eventId, isOpen, onClose, circle }: CircleFormModalProps) {
  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<CircleForm, any>({
    isOpen,
    entity: circle,
    emptyForm: { name: "", managerPin: "", managerEmail: "", managerName: "", description: "" },
    // PIN はセキュリティ上、編集時も毎回空文字で初期化する
    toForm: (c) => ({
      name: c.name || "",
      managerPin: "",
      managerEmail: c.managerEmail || "",
      managerName: c.managerName || "",
      description: c.description || "",
    }),
    onClose,
    toastId: "circle-auto-save",
    invalidateKeys: [["circles", eventId]],
    create: (data) =>
      circleApi.create({
        eventId,
        name: data.name,
        managerPin: data.managerPin || undefined,
        managerEmail: data.managerEmail,
        managerName: data.managerName || undefined,
        description: data.description || undefined,
      }),
    update: (c, data) =>
      circleApi.update(c.id, {
        name: data.name,
        managerPin: data.managerPin || undefined, // 入力がある場合のみ更新
        managerEmail: data.managerEmail,
        managerName: data.managerName || undefined,
        description: data.description || undefined,
      }),
    // PIN は toForm で常に "" のため既定の JSON 比較では検知できない。個別に判定する。
    hasChanged: (data, c) =>
      data.name !== c.name ||
      data.managerPin !== "" ||
      data.managerEmail !== (c.managerEmail || "") ||
      data.managerName !== (c.managerName || "") ||
      data.description !== (c.description || ""),
    hasInput: (data) =>
      data.name.trim() !== "" ||
      data.managerPin.trim() !== "" ||
      data.managerEmail.trim() !== "" ||
      data.managerName.trim() !== "" ||
      data.description.trim() !== "",
    // 自動保存後は PIN 欄をクリアして何度も保存されるのを防ぐ
    onAfterAutoSave: (setF) => setF((prev) => ({ ...prev, managerPin: "" })),
    validate: (data) =>
      !data.name || !data.managerEmail
        ? "サークル名と代表者メールアドレスは必須入力です"
        : null,
    messages: {
      createSuccess: "サークルを新規登録しました",
      createError: "サークルの作成に失敗しました",
      updateSuccess: "サークル情報を自動保存しました",
    },
  });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleOverlayClose}
        title={isEdit ? `[サークル編集: ${circle?.name}]` : "[新規サークル登録]"}
      >
        {isEdit && <EditModeBanner saveStatus={saveStatus} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="circleName"
            label="サークル名"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={triggerAutoSave}
            placeholder="例: たこ焼き 茨香庵"
          />
          <FormField
            id="circlePin"
            label={isEdit ? "代表者一時PIN (変更時のみ)" : "代表者一時PINコード"}
            type="password"
            value={form.managerPin}
            onChange={(e) => setForm({ ...form, managerPin: e.target.value })}
            onBlur={triggerAutoSave}
            placeholder={isEdit ? "変更時のみ入力" : "例: 1234"}
          />
          <FormField
            id="managerEmail"
            label="代表者メールアドレス"
            required
            type="email"
            value={form.managerEmail}
            onChange={(e) => setForm({ ...form, managerEmail: e.target.value })}
            onBlur={triggerAutoSave}
            placeholder="leader@example.com"
          />
          <FormField
            id="managerName"
            label="代表者名"
            value={form.managerName}
            onChange={(e) => setForm({ ...form, managerName: e.target.value })}
            onBlur={triggerAutoSave}
            placeholder="代表者のお名前"
          />
          <FormField
            id="circleDescription"
            label="説明"
            fieldClassName="sm:col-span-2"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            onBlur={triggerAutoSave}
            placeholder="出店ジャンルや販売メニュー等の説明"
          />
        </div>

        {!isEdit && (
          <FormSubmitButton
            onClick={handleSaveAndClose}
            disabled={!form.name || !form.managerEmail}
            isPending={isCreating}
            icon={Save}
          >
            追加する
          </FormSubmitButton>
        )}
      </Modal>

      <ConfirmationDialog
        isOpen={isConfirmOpen}
        title="[確認: 保存されていないサークル登録があります]"
        description="サークル追加を完了するには「保存して閉じる」を押してください。破棄する場合は「保存せず閉じる」を選択してください。"
        onConfirm={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}

import { staffApi, type Staff } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  FormField,
  FormSubmitButton,
  EditModeBanner,
} from "@/components/ui/FormField";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useEntityForm } from "@/hooks/useEntityForm";
import { Save } from "lucide-react";

interface StaffFormModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
  staff?: Staff | null;
}

export function StaffFormModal({ circleId, isOpen, onClose, staff }: StaffFormModalProps) {
  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<{ name: string }, Staff>({
    isOpen,
    entity: staff,
    emptyForm: { name: "" },
    toForm: (s) => ({ name: s.name }),
    onClose,
    toastId: "staff-auto-save",
    invalidateKeys: [["staff", circleId]],
    create: (data) => staffApi.create({ circleId, name: data.name }),
    update: (s, data) => staffApi.update(s.id, { name: data.name }),
    validate: (data) => (!data.name ? "スタッフ名を入力してください" : null),
    messages: {
      createSuccess: "スタッフを追加しました",
      createError: "スタッフの追加に失敗しました",
      updateSuccess: "スタッフ名を自動保存しました",
    },
  });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleOverlayClose}
        maxWidth="md"
        title={isEdit ? `[スタッフ編集: ${staff?.name}]` : "[新規スタッフ追加]"}
      >
        {isEdit && <EditModeBanner saveStatus={saveStatus} />}

        <FormField
          id="staffName"
          label="スタッフ名"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          onBlur={triggerAutoSave}
          placeholder="スタッフの氏名・ニックネーム"
        />

        {!isEdit && (
          <FormSubmitButton
            onClick={handleSaveAndClose}
            disabled={!form.name}
            isPending={isCreating}
            icon={Save}
          >
            追加する
          </FormSubmitButton>
        )}
      </Modal>

      <ConfirmationDialog
        isOpen={isConfirmOpen}
        title="[確認: 保存されていないスタッフ入力があります]"
        description="スタッフ登録を完了するには「保存して閉じる」を押してください。破棄する場合は「保存せず閉じる」を選択してください。"
        onConfirm={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}

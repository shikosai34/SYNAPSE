import { membershipApi } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  FormField,
  FormSelect,
  FormSubmitButton,
} from "@/components/ui/FormField";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useEntityForm } from "@/hooks/useEntityForm";
import { UserPlus } from "lucide-react";

interface EventStaffFormModalProps {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
}

type InviteForm = { email: string; role: "event_staff" | "event_admin" };

export function EventStaffFormModal({ eventId, isOpen, onClose }: EventStaffFormModalProps) {
  // 招待は常に新規発行のみ (編集モードなし) なので entity は渡さない。
  const {
    form, setForm, isConfirmOpen, setIsConfirmOpen, isCreating,
    handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<InviteForm, never>({
    isOpen,
    emptyForm: { email: "", role: "event_staff" },
    onClose,
    toastId: "event-staff-invite",
    invalidateKeys: [["invites", eventId]],
    create: (data) =>
      membershipApi.createInvite({
        eventId,
        targetEmail: data.email.toLowerCase(),
        role: data.role,
        createdBy: "event_admin",
      }),
    validate: (data) => (!data.email ? "メールアドレスを入力してください" : null),
    hasInput: (data) => data.email.trim() !== "",
    messages: {
      createSuccess: "招待トークンを発行しました",
      createError: "招待トークンの発行に失敗しました",
      updateSuccess: "",
    },
  });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleOverlayClose}
        maxWidth="md"
        title="[スタッフ招待トークン発行]"
      >
        <FormField
          id="inviteEmail"
          label="メールアドレス"
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="staff@example.com"
        />

        <FormSelect
          id="inviteRole"
          label="付与権限 (ロール)"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as InviteForm["role"] })}
        >
          <option value="event_staff">イベントスタッフ (一般)</option>
          <option value="event_admin">イベント管理者 (フルアクセス)</option>
        </FormSelect>

        <FormSubmitButton
          onClick={handleSaveAndClose}
          disabled={!form.email}
          isPending={isCreating}
          icon={UserPlus}
        >
          招待を発行する
        </FormSubmitButton>
      </Modal>

      <ConfirmationDialog
        isOpen={isConfirmOpen}
        title="[確認: スタッフ招待フォームを閉じます]"
        description="招待を発行するには「招待を発行する」を押してください。破棄する場合は「保存せず閉じる」を選択してください。"
        onConfirm={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}

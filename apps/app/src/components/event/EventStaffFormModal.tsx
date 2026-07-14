import { membershipApi } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  FormField,
  FormSelect,
  FormSubmitButton,
} from "@/components/ui/FormField";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useEntityForm } from "@/hooks/useEntityForm";
import { UserPlus } from "lucide-react";

interface EventStaffFormModalProps {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
}

// 2026-07-12 (SaaS): バックエンドの enum に無い "event_staff"/"event_admin" を
// 送って 400 になっていた不具合を修正 (role-vocab-debt)。有効なロールに統一する。
// - event_manager: イベント共同管理者 (特定の人宛。email 必須)。
// - circle_manager (circleId 無し) = circle_host: サークル出店の招待。
//   出店代表者がこのコード/リンクでサークルを新規作成し circle_manager になる。
//   複数サークルに配るため email 任意・maxUses 複数可。
type InvitePurpose = "event_manager" | "circle_host";
// expiresInDays: 招待の有効期限(日)。既定7日 (出店募集は数日〜1週間かかるため。サーバ上限は168h=7日) (2026-07-14 P1-4)。
type InviteForm = { email: string; purpose: InvitePurpose; maxUses: number; expiresInDays: number };

export function EventStaffFormModal({ eventId, isOpen, onClose }: EventStaffFormModalProps) {
  // 招待は常に新規発行のみ (編集モードなし) なので entity は渡さない。
  const {
    form, setForm, isConfirmOpen, setIsConfirmOpen, isCreating,
    handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<InviteForm, never>({
    isOpen,
    emptyForm: { email: "", purpose: "circle_host", maxUses: 1, expiresInDays: 7 },
    onClose,
    toastId: "event-staff-invite",
    invalidateKeys: [["invites", eventId]],
    create: (data) =>
      membershipApi.createInvite({
        eventId,
        // circle_host はイベント配下にサークルを作る権利 (role=circle_manager, circleId 無し)。
        role: data.purpose === "event_manager" ? "event_manager" : "circle_manager",
        // circle_host は不特定多数に配れるよう email 任意 + maxUses 複数可。
        targetEmail: data.email.trim() ? data.email.toLowerCase() : undefined,
        maxUses: data.purpose === "circle_host" ? Math.max(1, data.maxUses) : 1,
        // 有効期限 (日→時間)。1〜7日にクランプ (サーバ側も max 168h)。
        expiresInHours: Math.min(7, Math.max(1, data.expiresInDays)) * 24,
        createdBy: "event_admin",
      }),
    validate: (data) =>
      data.purpose === "event_manager" && !data.email
        ? "共同管理者の招待にはメールアドレスが必要です"
        : null,
    hasInput: (data) => data.email.trim() !== "" || data.purpose === "circle_host",
    messages: {
      createSuccess: "招待を発行しました",
      createError: "招待の発行に失敗しました",
      updateSuccess: "",
    },
  });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleOverlayClose}
        maxWidth="md"
        title="[招待の発行]"
      >
        <FormSelect
          id="invitePurpose"
          label="招待の種類"
          value={form.purpose}
          onChange={(e) => setForm({ ...form, purpose: e.target.value as InvitePurpose })}
        >
          <option value="circle_host">サークル出店 (代表者がサークルを作成)</option>
          <option value="event_manager">イベント共同管理者 (フルアクセス)</option>
        </FormSelect>

        <FormField
          id="inviteEmail"
          label={form.purpose === "event_manager" ? "メールアドレス" : "メールアドレス (任意)"}
          required={form.purpose === "event_manager"}
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="staff@example.com"
        />

        {form.purpose === "circle_host" && (
          <FormField
            id="inviteMaxUses"
            label="使用可能回数 (何サークル分)"
            type="number"
            value={String(form.maxUses)}
            onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) || 1 })}
            placeholder="1"
          />
        )}

        <FormSelect
          id="inviteExpiry"
          label="有効期限"
          value={String(form.expiresInDays)}
          onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}
        >
          <option value="1">1日</option>
          <option value="3">3日</option>
          <option value="7">7日</option>
        </FormSelect>

        <FormSubmitButton
          onClick={handleSaveAndClose}
          disabled={form.purpose === "event_manager" && !form.email}
          isPending={isCreating}
          icon={UserPlus}
        >
          招待を発行する
        </FormSubmitButton>
      </Modal>

      <UnsavedChangesDialog
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

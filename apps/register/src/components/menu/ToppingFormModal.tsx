import { toppingApi, type Topping } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  FormField,
  FormSubmitButton,
  EditModeBanner,
} from "@/components/ui/FormField";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useEntityForm } from "@/hooks/useEntityForm";
import { Save } from "lucide-react";

interface ToppingFormModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
  topping?: Topping | null;
}

type ToppingForm = { name: string; price: number; description: string };

export function ToppingFormModal({ circleId, isOpen, onClose, topping }: ToppingFormModalProps) {
  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<ToppingForm, Topping>({
    isOpen,
    entity: topping,
    emptyForm: { name: "", price: 0, description: "" },
    toForm: (t) => ({ name: t.name, price: t.price, description: t.description || "" }),
    onClose,
    toastId: "topping-auto-save",
    invalidateKeys: [["toppings", circleId]],
    create: (data) =>
      toppingApi.create({
        circleId,
        name: data.name,
        price: data.price,
        description: data.description || undefined,
      }),
    update: (t, data) =>
      toppingApi.update(t.id, {
        name: data.name,
        price: data.price,
        description: data.description || null,
      }),
    validate: (data) => (!data.name ? "トッピング名を入力してください" : null),
    messages: {
      createSuccess: "トッピングを追加しました",
      createError: "トッピングの追加に失敗しました",
      updateSuccess: "変更を自動保存しました",
    },
  });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleOverlayClose}
        title={isEdit ? `[トッピング編集: ${topping?.name}]` : "[新規トッピング追加]"}
      >
        {isEdit && <EditModeBanner saveStatus={saveStatus} />}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            id="toppingName"
            label="トッピング名"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={triggerAutoSave}
            placeholder="例: チーズ増量"
          />
          <FormField
            id="toppingPrice"
            label="価格"
            required
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
            onBlur={triggerAutoSave}
          />
        </div>

        <FormField
          id="toppingDescription"
          label="説明"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          onBlur={triggerAutoSave}
          placeholder="トッピングの説明"
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
        title="[確認: 保存されていないトッピング入力があります]"
        description="トッピング追加を完了するには「保存して閉じる」を押してください。破棄する場合は「保存せず閉じる」を選択してください。"
        onConfirm={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}

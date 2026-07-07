import { toppingApi, type Topping } from "@/lib/api";
import { ImageUpload } from "@/components/image-upload";
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

type ToppingForm = { name: string; price: number; imagePath: string; description: string };

export function ToppingFormModal({ circleId, isOpen, onClose, topping }: ToppingFormModalProps) {
  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, saveNow, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<ToppingForm, Topping>({
    isOpen,
    entity: topping,
    emptyForm: { name: "", price: 0, imagePath: "", description: "" },
    toForm: (t) => ({
      name: t.name,
      price: t.price,
      imagePath: t.imagePath || "",
      description: t.description || "",
    }),
    onClose,
    toastId: "topping-auto-save",
    invalidateKeys: [["toppings", circleId]],
    create: (data) =>
      toppingApi.create({
        circleId,
        name: data.name,
        price: data.price,
        imagePath: data.imagePath || undefined,
        description: data.description || undefined,
      }),
    update: (t, data) =>
      toppingApi.update(t.id, {
        name: data.name,
        price: data.price,
        imagePath: data.imagePath || undefined,
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
            // 割引トッピング用に負値を許可 (FormField 既定の min=0 クランプを外す)
            min={-1000000}
            value={form.price}
            onChange={(e) => {
              const n = Number(e.target.value);
              setForm({ ...form, price: Number.isNaN(n) ? 0 : n });
            }}
            onBlur={triggerAutoSave}
          />
        </div>

        <ImageUpload
          label="トッピング画像"
          value={form.imagePath}
          onChange={(path) => {
            setForm((prev) => {
              const next = { ...prev, imagePath: path };
              // 画像パス変更時は blur を伴わないため即座に自動保存を発火
              if (isEdit) saveNow(next);
              return next;
            });
          }}
        />

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

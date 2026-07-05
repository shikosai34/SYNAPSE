import { menuApi, type Menu } from "@/lib/api";
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

interface MenuFormModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
  menu?: Menu | null; // 編集時は既存のMenuを渡す。null/undefined時は新規作成
}

type MenuForm = {
  name: string;
  price: number;
  imagePath: string;
  description: string;
  stockQuantity: number;
};

export function MenuFormModal({ circleId, isOpen, onClose, menu }: MenuFormModalProps) {
  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, saveNow, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<MenuForm, Menu>({
    isOpen,
    entity: menu,
    emptyForm: { name: "", price: 0, imagePath: "", description: "", stockQuantity: 0 },
    toForm: (m) => ({
      name: m.name,
      price: m.price,
      imagePath: m.imagePath || "",
      description: m.description || "",
      stockQuantity: m.stockQuantity ?? 0,
    }),
    onClose,
    toastId: "menu-auto-save",
    invalidateKeys: [["menus", circleId]],
    create: (data) =>
      menuApi.create({
        circleId,
        name: data.name,
        price: data.price,
        imagePath: data.imagePath || undefined,
        description: data.description || undefined,
        stockQuantity: data.stockQuantity,
      }),
    update: (m, data) =>
      menuApi.update(m.id, {
        name: data.name,
        price: data.price,
        imagePath: data.imagePath || undefined,
        description: data.description || undefined,
        stockQuantity: data.stockQuantity,
      }),
    validate: (data) => (!data.name ? "メニュー名を入力してください" : null),
    messages: {
      createSuccess: "メニューを追加しました",
      createError: "メニューの追加に失敗しました",
      updateSuccess: "変更を自動保存しました",
    },
  });

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleOverlayClose}
        title={isEdit ? `[メニュー編集: ${menu?.name}]` : "[新規メニュー追加]"}
      >
        {isEdit && <EditModeBanner saveStatus={saveStatus} />}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            id="menuName"
            label="メニュー名"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={triggerAutoSave}
            placeholder="例: ハンバーガー"
          />
          <FormField
            id="menuPrice"
            label="価格"
            required
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
            onBlur={triggerAutoSave}
          />
        </div>

        <ImageUpload
          label="メニュー画像"
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
          id="menuDescription"
          label="説明"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          onBlur={triggerAutoSave}
          placeholder="商品の説明"
        />

        <FormField
          id="stockQuantity"
          label="在庫数"
          type="number"
          value={form.stockQuantity}
          onChange={(e) => setForm({ ...form, stockQuantity: Number(e.target.value) })}
          onBlur={triggerAutoSave}
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
        title="[確認: 保存されていないメニュー入力があります]"
        description="メニュー追加を完了するには「保存して閉じる」を押してください。破棄する場合は「保存せず閉じる」を選択してください。"
        onConfirm={handleSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={() => setIsConfirmOpen(false)}
      />
    </>
  );
}

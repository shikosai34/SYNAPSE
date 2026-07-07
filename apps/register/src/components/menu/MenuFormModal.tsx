import { useQuery } from "@tanstack/react-query";
import { menuApi, toppingApi, type Menu } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/image-upload";
import { Modal } from "@/components/ui/Modal";
import { Label } from "@/components/ui/label";
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
  defaultToppingIds: string[];
};

function parseDefaultToppingIds(raw?: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function MenuFormModal({ circleId, isOpen, onClose, menu }: MenuFormModalProps) {
  // 既定トッピングの選択肢 (サークルのトッピング一覧)
  const { data: toppings } = useQuery({
    queryKey: ["toppings", circleId],
    queryFn: () => toppingApi.list(circleId),
    enabled: isOpen && !!circleId,
  });

  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, saveNow, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<MenuForm, Menu>({
    isOpen,
    entity: menu,
    emptyForm: { name: "", price: 0, imagePath: "", description: "", stockQuantity: 0, defaultToppingIds: [] },
    toForm: (m) => ({
      name: m.name,
      price: m.price,
      imagePath: m.imagePath || "",
      description: m.description || "",
      stockQuantity: m.stockQuantity ?? 0,
      defaultToppingIds: parseDefaultToppingIds(m.defaultToppingIds),
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
        defaultToppingIds: data.defaultToppingIds,
      }),
    update: (m, data) =>
      menuApi.update(m.id, {
        name: data.name,
        price: data.price,
        imagePath: data.imagePath || undefined,
        description: data.description || undefined,
        stockQuantity: data.stockQuantity,
        defaultToppingIds: data.defaultToppingIds,
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
            // 割引メニュー用に負値を許可 (FormField 既定の min=0 クランプを外す)
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
          onChange={(e) => {
            const n = Number(e.target.value);
            setForm({ ...form, stockQuantity: Number.isNaN(n) ? 0 : n });
          }}
          onBlur={triggerAutoSave}
        />

        {/* 既定トッピング: レジで追加時に自動で入るトッピング */}
        {toppings && toppings.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs font-bold uppercase">
              既定トッピング（レジで自動適用）
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {toppings.map((t) => {
                const selected = form.defaultToppingIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      const next = {
                        ...form,
                        defaultToppingIds: selected
                          ? form.defaultToppingIds.filter((x) => x !== t.id)
                          : [...form.defaultToppingIds, t.id],
                      };
                      setForm(next);
                      if (isEdit) saveNow(next);
                    }}
                    className={cn(
                      "border-thick rounded-none px-2 py-1 text-xs font-bold transition-all",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {t.name} (+¥{t.price})
                  </button>
                );
              })}
            </div>
          </div>
        )}

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

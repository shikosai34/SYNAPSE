import { useQuery } from "@tanstack/react-query";
import { toppingApi, circleApi, parseCircleSettings, type Topping } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/image-upload";
import { Modal } from "@/components/ui/Modal";
import { Label } from "@/components/ui/label";
import {
  FormField,
  FormSubmitButton,
  EditModeBanner,
} from "@/components/ui/FormField";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useEntityForm } from "@/hooks/useEntityForm";
import { Save } from "lucide-react";

interface ToppingFormModalProps {
  circleId: string;
  isOpen: boolean;
  onClose: () => void;
  topping?: Topping | null;
}

// 売り切れフラグを保持 (2026-07-15)。メニュー同様、在庫数はトッピング編集では扱わず
// 在庫管理から操作する。ここで持つのは売切かどうかだけ。
type ToppingForm = { name: string; price: number; imagePath: string; description: string; soldOut: boolean };

export function ToppingFormModal({ circleId, isOpen, onClose, topping }: ToppingFormModalProps) {
  // 在庫管理拡張ONのサークルでは、売切はトッピング編集から変更不可 (在庫で自動制御)。
  const { data: circleData } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: isOpen && !!circleId,
  });
  const stockManaged = parseCircleSettings(circleData?.settings).extensions.stock;

  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, saveNow, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<ToppingForm, Topping>({
    isOpen,
    entity: topping,
    emptyForm: { name: "", price: 0, imagePath: "", description: "", soldOut: false },
    toForm: (t) => ({
      name: t.name,
      price: t.price,
      imagePath: t.imagePath || "",
      description: t.description || "",
      soldOut: t.soldOut ?? false,
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
        soldOut: data.soldOut,
      }),
    update: (t, data) =>
      toppingApi.update(t.id, {
        name: data.name,
        price: data.price,
        imagePath: data.imagePath || undefined,
        description: data.description || null,
        soldOut: data.soldOut,
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

        {/* 売り切れ設定 (2026-07-15)。在庫管理拡張ONのサークルでは在庫で自動制御されるため変更不可。 */}
        <div className="space-y-1.5">
          <Label className="text-xs font-bold uppercase">販売状態</Label>
          {stockManaged ? (
            <div className="border-thick border-border bg-muted/30 p-3 text-xs font-mono text-muted-foreground">
              このサークルは<strong className="text-foreground">在庫管理</strong>がONのため、売り切れは在庫数から自動判定されます。
              売切の切り替えは「在庫管理」から行ってください。
              <div className="mt-1.5 font-bold text-foreground">
                現在: {form.soldOut ? "売り切れ" : "販売中"}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                const next = { ...form, soldOut: !form.soldOut };
                setForm(next);
                if (isEdit) saveNow(next);
              }}
              className={cn(
                "w-full border-thick rounded-none px-3 py-2.5 text-sm font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                form.soldOut
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-success bg-success/10 text-success",
              )}
            >
              {form.soldOut ? "売り切れ (タップで販売中に戻す)" : "販売中 (タップで売り切れにする)"}
            </button>
          )}
        </div>

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

      <UnsavedChangesDialog
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

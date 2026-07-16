import { useQuery } from "@tanstack/react-query";
import { menuApi, toppingApi, circleApi, parseCircleSettings, type Menu } from "@/lib/api";
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
  // 売り切れフラグ (2026-07-14)。在庫数はメニュー管理では扱わず、売切かどうかだけを持つ。
  soldOut: boolean;
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

  // 在庫管理拡張がONのサークルでは、売切はメニュー管理から変更できない (在庫で自動制御) 。
  const { data: circleData } = useQuery({
    queryKey: ["circle", circleId],
    queryFn: () => circleApi.get(circleId),
    enabled: isOpen && !!circleId,
  });
  const stockManaged = parseCircleSettings(circleData?.settings).extensions.stock;

  const {
    form, setForm, isEdit, isConfirmOpen, setIsConfirmOpen, isCreating, saveStatus,
    triggerAutoSave, saveNow, handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  } = useEntityForm<MenuForm, Menu>({
    isOpen,
    entity: menu,
    emptyForm: { name: "", price: 0, imagePath: "", description: "", soldOut: false, defaultToppingIds: [] },
    toForm: (m) => ({
      name: m.name,
      price: m.price,
      imagePath: m.imagePath || "",
      description: m.description || "",
      soldOut: m.soldOut ?? false,
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
        // 在庫数はメニュー管理では設定しない (在庫管理拡張で扱う)。売切のみ渡す。
        soldOut: data.soldOut,
        defaultToppingIds: data.defaultToppingIds,
      }),
    update: (m, data) =>
      menuApi.update(m.id, {
        name: data.name,
        price: data.price,
        imagePath: data.imagePath || undefined,
        description: data.description || undefined,
        soldOut: data.soldOut,
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

        {/* 売り切れ設定 (2026-07-14)。在庫管理拡張ONのサークルでは在庫で自動制御されるため変更不可。 */}
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

      <UnsavedChangesDialog
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

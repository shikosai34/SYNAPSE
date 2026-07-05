import { useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SaveStatus } from "@/components/ui/FormField";

// 2026-07-04: Circle/Menu/Topping/Staff/EventStaff の各 FormModal が
// 「新規=作成 / 編集=onBlur 自動保存 / 未保存入力ありなら閉じる前に確認」という
// 同一のデータ操作ロジックを個別に実装していたため共通化する。
// エンティティ固有の差異 (バリデーション・変更検知・保存後処理) はコールバックで注入する。

interface UseEntityFormOptions<TForm extends Record<string, unknown>, TEntity> {
  isOpen: boolean;
  /** 編集対象。null/undefined のときは新規作成モード。 */
  entity?: TEntity | null;
  /** 新規作成時のフォーム初期値。 */
  emptyForm: TForm;
  /** 編集時に既存エンティティをフォーム値へ変換する。省略時は emptyForm。 */
  toForm?: (entity: TEntity) => TForm;
  onClose: () => void;
  /** 自動保存トーストをまとめるための一意な ID。 */
  toastId: string;
  /** 保存成功時に無効化する react-query のキー群。 */
  invalidateKeys: readonly unknown[][];
  create: (form: TForm) => Promise<unknown>;
  /** 編集(自動保存)。省略時は編集モードでも保存を行わない。 */
  update?: (entity: TEntity, form: TForm) => Promise<unknown>;
  /** 新規作成前のバリデーション。エラーメッセージ文字列を返すと中断。 */
  validate?: (form: TForm) => string | null;
  /** 自動保存を発火すべき差分があるか。省略時は toForm(entity) との JSON 比較。 */
  hasChanged?: (form: TForm, entity: TEntity) => boolean;
  /** 新規作成時、閉じる前に確認すべき入力があるか。省略時は emptyForm との JSON 比較。 */
  hasInput?: (form: TForm) => boolean;
  /** 自動保存の mutate 発火直後に呼ばれる (例: PIN 欄のクリア)。 */
  onAfterAutoSave?: (setForm: Dispatch<SetStateAction<TForm>>) => void;
  messages: { createSuccess: string; createError: string; updateSuccess: string };
}

export function useEntityForm<TForm extends Record<string, unknown>, TEntity>(
  opts: UseEntityFormOptions<TForm, TEntity>,
) {
  const {
    isOpen, entity, emptyForm, toForm, onClose, toastId, invalidateKeys,
    create, update, validate, hasChanged, hasInput, onAfterAutoSave, messages,
  } = opts;

  const queryClient = useQueryClient();
  const isEdit = !!entity;

  const [form, setForm] = useState<TForm>(emptyForm);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // "saved"/"error" は次の自動保存が始まるまで表示を維持したいため、
  // updateMutation の isPending/isSuccess/isError だけでなく独自 state で保持する。
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // モーダルを開くたび・対象エンティティが変わるたびにフォームを初期化する
  useEffect(() => {
    setForm(entity && toForm ? toForm(entity) : emptyForm);
    setIsConfirmOpen(false);
    // emptyForm はリテラルで毎回生成されるため依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, isOpen]);

  const invalidate = () =>
    invalidateKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));

  const createMutation = useMutation({
    mutationFn: (data: TForm) => create(data),
    onSuccess: () => {
      toast.success(messages.createSuccess);
      invalidate();
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || messages.createError),
  });

  const updateMutation = useMutation({
    mutationFn: (data: TForm) => {
      if (!entity || !update) throw new Error("No entity/updater for edit");
      return update(entity, data);
    },
    onSuccess: () => {
      toast.success(messages.updateSuccess, { id: toastId });
      invalidate();
      setSaveStatus("saved");
    },
    onError: (err: any) => {
      toast.error(`自動保存失敗: ${err?.message ?? ""}`);
      setSaveStatus("error");
    },
  });

  const defaultHasChanged = () =>
    entity && toForm ? JSON.stringify(form) !== JSON.stringify(toForm(entity)) : false;
  const defaultHasInput = () => JSON.stringify(form) !== JSON.stringify(emptyForm);

  // onBlur で呼ぶ自動保存
  const triggerAutoSave = () => {
    if (!isEdit || !update || !entity) return;
    const changed = hasChanged ? hasChanged(form, entity) : defaultHasChanged();
    if (!changed) return;
    toast.loading("自動保存中...", { id: toastId });
    setSaveStatus("saving");
    updateMutation.mutate(form);
    onAfterAutoSave?.(setForm);
  };

  // 画像アップロード等、blur を伴わない即時保存用
  const saveNow = (next?: TForm) => {
    if (!isEdit || !update || !entity) return;
    toast.loading("自動保存中...", { id: toastId });
    setSaveStatus("saving");
    updateMutation.mutate(next ?? form);
  };

  const handleOverlayClose = () => {
    if (isEdit) {
      onClose(); // 編集は自動保存済みなのでそのまま閉じる
      return;
    }
    const dirty = hasInput ? hasInput(form) : defaultHasInput();
    if (dirty) setIsConfirmOpen(true);
    else onClose();
  };

  const handleSaveAndClose = () => {
    setIsConfirmOpen(false);
    const error = validate?.(form);
    if (error) {
      toast.error(error);
      return;
    }
    createMutation.mutate(form);
  };

  const handleDiscardAndClose = () => {
    setIsConfirmOpen(false);
    onClose();
  };

  return {
    form, setForm, isEdit,
    isConfirmOpen, setIsConfirmOpen,
    isCreating: createMutation.isPending,
    saveStatus,
    triggerAutoSave, saveNow,
    handleOverlayClose, handleSaveAndClose, handleDiscardAndClose,
  };
}

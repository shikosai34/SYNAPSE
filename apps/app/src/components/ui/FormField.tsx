import { Eye, EyeOff, Loader2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// 2026-07-04: 全 FormModal で Label + Input / Label + select の同一マークアップと
// クラス文字列が繰り返されていたため共通化。ラベルと入力欄が id で
// 確実に紐づくようにし、アクセシビリティも担保する。

/** フォーム内 Input/Select 共通のスタイル (RawBlock: 太枠・角丸なし・mono)。 */
export const formControlClassName =
  "border-thick border-border rounded-none h-10 text-xs bg-background focus-visible:ring-0";

interface FieldShellProps {
  id: string;
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

function FieldShell({ id, label, required, className, children }: FieldShellProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id} className="text-xs font-bold uppercase">
        {label}
        {required && " *"}
      </Label>
      {children}
    </div>
  );
}

interface FormFieldProps
  extends Omit<React.ComponentProps<typeof Input>, "id"> {
  id: string;
  label: string;
  required?: boolean;
  /** ラッパー div に付与する追加クラス (グリッド span 等)。 */
  fieldClassName?: string;
}

export function FormField({
  id,
  label,
  required,
  fieldClassName,
  className,
  type,
  min,
  inputMode,
  onBlur,
  value,
  placeholder,
  ...inputProps
}: FormFieldProps) {
  const [passwordVisible, setPasswordVisible] = useState(false);
  // 2026-07-05: 価格・在庫数等の number 入力で負値が入力・確定されてしまう問題への
  // 共通対策。呼び出し側が min を指定しなければ 0 を既定にし、onBlur 時に
  // DOM の現在値を min でクランプ・正規化して onChange を呼び直す。
  // (呼び出し側の state 管理はそのまま onChange 経由で更新されるため壊れない)
  const isNumber = type === "number";
  const resolvedMin = isNumber ? (min ?? 0) : min;

  // 2026-07-06: 価格・在庫数などの number 入力は値が 0 のとき常に "0" が
  // 表示され続け、ユーザーが一度消してから入力し直す必要があり直感に反していた。
  // 値が 0 の間は表示上は空欄にし、placeholder で "0" を示すことで
  // そのまま数字を打ち始められるようにする (格納される値は引き続き number のまま)。
  const displayValue =
    isNumber && (value === 0 || value === "0") ? "" : value;
  const resolvedPlaceholder = isNumber ? (placeholder ?? "0") : placeholder;

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (isNumber) {
      const minValue = Number(resolvedMin);
      const input = e.target;
      const rawValue = input.value;
      if (rawValue !== "" && !Number.isNaN(Number(rawValue))) {
        const normalized = Math.max(Number(rawValue), minValue);
        if (normalized !== Number(rawValue)) {
          // controlled input のため、React の value トラッキングを回避する
          // ネイティブ setter 経由で値を書き換えてから input イベントを発火し、
          // 呼び出し側の onChange (state 更新) を正しく再実行させる。
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          )?.set;
          nativeSetter?.call(input, String(normalized));
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    }
    onBlur?.(e);
  };

  return (
    <FieldShell id={id} label={label} required={required} className={fieldClassName}>
      <div className={type === "password" ? "relative" : undefined}>
        <Input
          id={id}
          type={type === "password" && passwordVisible ? "text" : type}
          min={resolvedMin}
          inputMode={isNumber ? (inputMode ?? "numeric") : inputMode}
          onBlur={handleBlur}
          value={displayValue}
          placeholder={resolvedPlaceholder}
          className={cn(formControlClassName, className, type === "password" && "pr-10")}
          {...inputProps}
        />
        {type === "password" && (
          // 2026-09-27: 表示切替を共通フィールドに置き、パスワード欄ごとに操作感を揃える。
          <button
          type="button"
          aria-label={passwordVisible ? "パスワードを隠す" : "パスワードを表示"}
          aria-pressed={passwordVisible}
          disabled={inputProps.disabled}
          onClick={() => setPasswordVisible((visible) => !visible)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-foreground"
          >
            {passwordVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
    </FieldShell>
  );
}

interface FormSelectProps
  extends Omit<React.ComponentProps<"select">, "id"> {
  id: string;
  label: string;
  required?: boolean;
  fieldClassName?: string;
}

export function FormSelect({
  id,
  label,
  required,
  fieldClassName,
  className,
  children,
  ...selectProps
}: FormSelectProps) {
  return (
    <FieldShell id={id} label={label} required={required} className={fieldClassName}>
      <select
        id={id}
        className={cn(
          "w-full h-10 border-thick border-border rounded-none bg-background px-2 text-xs font-bold uppercase font-mono",
          className,
        )}
        {...selectProps}
      >
        {children}
      </select>
    </FieldShell>
  );
}

interface FormSubmitButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isPending?: boolean;
  icon: LucideIcon;
  children: React.ReactNode;
}

/** 新規作成モーダルの右下に置く送信ボタン (処理中はスピナー表示)。 */
export function FormSubmitButton({
  onClick,
  disabled,
  isPending,
  icon: Icon,
  children,
}: FormSubmitButtonProps) {
  return (
    <div className="flex justify-end gap-2 pt-2 border-t-thick border-border">
      <Button
        onClick={onClick}
        disabled={disabled || isPending}
        className="border-thick border-primary bg-primary text-primary-foreground hover:bg-background hover:text-foreground h-10 text-xs font-bold rounded-none shadow-none px-4 flex items-center gap-1.5"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        {children}
      </Button>
    </div>
  );
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface EditModeBannerProps {
  /** useEntityForm から渡す自動保存の状態。省略時は従来通りインジケータなし。 */
  saveStatus?: SaveStatus;
}

/**
 * 2026-07-06: 「フォーカスを外すと自動保存されます」という注記文言は不要という
 * フィードバックのため非表示にした。自動保存の挙動自体 (useEntityForm 側) は
 * 変更していない。呼び出し側の import が壊れないよう export とシグネチャは維持し、
 * null を返す。
 */
export function EditModeBanner(_props: EditModeBannerProps) {
  return null;
}

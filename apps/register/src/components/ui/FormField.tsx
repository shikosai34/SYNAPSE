import { Loader2, type LucideIcon } from "lucide-react";
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
  ...inputProps
}: FormFieldProps) {
  return (
    <FieldShell id={id} label={label} required={required} className={fieldClassName}>
      <Input id={id} className={cn(formControlClassName, className)} {...inputProps} />
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

/** 編集モード時に表示する「フォーカスを外すと自動保存」の注記バナー。 */
export function EditModeBanner() {
  return (
    <div className="text-[10px] text-success font-bold bg-muted p-2 border-thick border-border">
      ※ 編集モード: 変更箇所は入力欄からフォーカスを外すと自動保存されます。
    </div>
  );
}

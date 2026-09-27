
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import { uploadImage } from "@/lib/api";
import { resolveAssetUrl } from "@/lib/asset-url";

interface ImageUploadProps {
  value: string;
  onChange: (path: string) => void;
  label?: string;
}

function isHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type);
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/") || isHeic(file) || /\.(jpe?g|png|gif|webp)$/i.test(file.name);
}

export function ImageUpload({
  value,
  onChange,
  label = "画像",
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError(null);

    try {
      let upload = file;
      if (isHeic(file)) {
        // 2026-09-27: Workers/R2へHEICのまま保存すると一般ブラウザで表示できないため、
        // 必要な時だけブラウザ側でJPEGへ変換し、既存のアップロード経路へ渡す。
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
        const jpeg = Array.isArray(converted) ? converted[0] : converted;
        if (!jpeg) throw new Error("HEIC画像を変換できませんでした");
        upload = new File([jpeg], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
      }
      // 2026-09-27: HEIC変換後のファイルも共通の認証付きアップロード経路へ渡す。
      const data = await uploadImage(upload);
      onChange(data.path);
    } catch (err) {
      const detail = err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String(err.message)
          : err && typeof err === "object" && "code" in err
            ? `変換エラー (${String(err.code)})`
            : "アップロードに失敗しました";
      setError(
        detail
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file && isImage(file)) {
      uploadFile(file);
    } else {
      setError("画像ファイルを選択してください");
    }
  };

  const handleRemove = () => {
    onChange("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {value ? (
        // プレビュー表示
        <div className="relative">
          <div className="relative h-48 w-full rounded-lg overflow-hidden border">
            <img src={resolveAssetUrl(value)} alt="プレビュー" className="absolute inset-0 h-full w-full object-cover" />
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2"
            onClick={handleRemove}
            aria-label="画像を削除"
          >
            <X className="h-4 w-4" />
          </Button>
          <p className="text-xs text-muted-foreground mt-1 truncate">{value}</p>
        </div>
      ) : (
        // アップロードエリア
        <div
          className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={isUploading}
          />

          <div className="flex flex-col items-center gap-2">
            {isUploading ? (
              <>
                <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
                <p className="text-sm text-muted-foreground">
                  アップロード中...
                </p>
              </>
            ) : (
              <>
                <div className="p-3 rounded-full bg-muted">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    クリックまたはドラッグ＆ドロップ
                  </p>
                  <p className="text-xs text-muted-foreground">
                    JPEG, PNG, GIF, WebP, HEIC (最大10MB)
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* 手動入力オプション */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>または</span>
        <Input
          placeholder="画像URLを直接入力"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}

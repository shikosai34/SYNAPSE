
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X, Image as ImageIcon, Loader2 } from "lucide-react";
import Image from "@/components/image";

interface ImageUploadProps {
  value: string;
  onChange: (path: string) => void;
  label?: string;
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
      const formData = new FormData();
      formData.append("file", file);

      // API Worker の既定ポートは 8787 (3001 は visitor フロントのポートで誤り) (2026-07-04)
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:8787";
      const response = await fetch(`${apiUrl}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "アップロードに失敗しました");
      }

      const data = await response.json();
      onChange(data.path);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "アップロードに失敗しました"
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
    if (file && file.type.startsWith("image/")) {
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
            <Image src={value} alt="プレビュー" fill className="object-cover" />
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2"
            onClick={handleRemove}
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
            accept="image/jpeg,image/png,image/gif,image/webp"
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
                    JPEG, PNG, GIF, WebP (最大5MB)
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


import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Image as ImageIcon, Loader2 } from "lucide-react";
import { startUpload, useUploadJobs } from "@/lib/upload-manager";
import { resolveAssetUrl } from "@/lib/asset-url";

interface ImageUploadProps {
  value: string;
  onChange: (path: string) => void;
  label?: string;
  /** 同じ画像欄を開き直したとき進行中のアップロードを引き当てるキー (例: "menu:{id}:image") */
  entityKey?: string;
  /**
   * 2026-10-05 Issue #97: 完了後の永続化処理。モーダルを閉じて ImageUpload が消えた後でも
   * アップロードマネージャが必ず実行する (onChange は画面に残っているときだけ呼ばれる)。
   */
  onCommit?: (path: string) => Promise<void>;
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
  entityKey,
  onCommit,
}: ImageUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 自分が開始したジョブ、または開き直し前に同じ entityKey で開始された進行中ジョブを表示に使う
  const jobs = useUploadJobs();
  const job =
    jobs.find((j) => j.id === jobId) ??
    [...jobs].reverse().find((j) => entityKey && j.entityKey === entityKey && j.phase !== "done" && j.phase !== "error");
  const isUploading =
    !!job && job.phase !== "done" && job.phase !== "error";
  const phaseText =
    job?.phase === "converting" ? "HEICを変換中..." : job?.phase === "saving" ? "保存中..." : "アップロード中...";

  const uploadFile = (file: File) => {
    setError(null);
    // 2026-10-05 Issue #97: 変換/アップロードはマネージャへ委譲し、ここでは状態を持たない。
    // 画面が残っている間だけ onChange でフォームへ反映し、永続化は onCommit に任せる。
    const id = startUpload({
      file,
      label,
      entityKey,
      onUploaded: (path) => {
        if (mountedRef.current) onChangeRef.current(path);
      },
      commit: onCommit,
    });
    setJobId(id);
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

  // 失敗したジョブのエラーはトレイ側で再試行できるが、欄内にも出して見落としを防ぐ
  const shownError = error ?? (job?.phase === "error" ? job.error ?? null : null);

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
                  {phaseText}
                </p>
                <p className="text-xs text-muted-foreground">
                  閉じても処理は続きます (右下に状況を表示)
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

      {shownError && <p className="text-sm text-destructive">{shownError}</p>}

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

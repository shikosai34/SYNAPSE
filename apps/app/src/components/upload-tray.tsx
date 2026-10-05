import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dismissUpload,
  isUploadActive,
  retryUpload,
  useUploadJobs,
  type UploadPhase,
} from "@/lib/upload-manager";

// 2026-10-05 Issue #97: 画像アップロードの継続状況を右下に常駐表示する (Google ドライブ風)。
// モーダルを閉じても処理は upload-manager 側で続くため、閉じた後も「まだ処理中」と分かるようにする。
// 周囲のブルータリスト調 (太枠・角なし・mono・影なし) に合わせ、既存の Button を使う。

const PHASE_LABEL: Record<UploadPhase, string> = {
  converting: "HEICを変換中...",
  uploading: "アップロード中...",
  saving: "保存中...",
  done: "保存しました",
  error: "失敗しました",
};

export function UploadTray() {
  const jobs = useUploadJobs();
  const [collapsed, setCollapsed] = useState(false);
  const active = isUploadActive(jobs);

  // 処理中にタブを閉じる/リロードするとアップロードも保存も失われるため、その場合だけブラウザの標準警告を出す。
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);

  if (jobs.length === 0) return null;

  const activeCount = jobs.filter((j) => j.phase !== "done" && j.phase !== "error").length;
  const title = activeCount > 0 ? `アップロード中 (${activeCount}件)` : "アップロード完了";

  return (
    <section
      aria-label="画像アップロードの状況"
      className="fixed bottom-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm border-thick border-border bg-background font-mono"
    >
      <div className="flex items-center justify-between gap-2 border-b-thin border-border px-3 py-2">
        <h2 className="text-xs font-bold uppercase">{title}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-none"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "一覧を開く" : "一覧を閉じる"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>
      {!collapsed && (
        <ul className="max-h-60 divide-y divide-border overflow-y-auto" aria-live="polite">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-2 px-3 py-2 text-xs">
              {job.phase === "done" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              ) : job.phase === "error" ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{job.label}</p>
                <p className="truncate text-muted-foreground">
                  {job.fileName} ・ {job.phase === "error" && job.error ? job.error : PHASE_LABEL[job.phase]}
                </p>
              </div>
              {job.phase === "error" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-none"
                  onClick={() => retryUpload(job.id)}
                  aria-label={`${job.label}を再試行`}
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
              )}
              {(job.phase === "done" || job.phase === "error") && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-none"
                  onClick={() => dismissUpload(job.id)}
                  aria-label={`${job.label}の表示を閉じる`}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

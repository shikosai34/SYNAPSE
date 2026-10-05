import { useSyncExternalStore } from "react";
import { uploadImage } from "@/lib/api";

// 2026-10-05 Issue #97: 画像アップロードの状態を ImageUpload コンポーネント (=モーダルの寿命) から
// 切り離す。従来は HEIC 変換/アップロード中にモーダルを閉じるとコンポーネントごと消え、完了後の
// onChange/saveNow が届かず画像が保存されなかった。ここで保持すれば画面遷移後も処理が継続し、
// 完了後の保存 (commit) も必ず実行される。確認ダイアログで閉じるのを阻むのではなく、
// Google ドライブのように右下のトレイで「継続中」を見せる方針 (Issue コメントより)。
// 依存を増やさないため、外部ストアは useSyncExternalStore で自前実装する。

export type UploadPhase = "converting" | "uploading" | "saving" | "done" | "error";

export interface UploadJob {
  id: string;
  fileName: string;
  /** トレイ表示用の対象名 (例: "メニュー画像") */
  label: string;
  /** 同じ画像欄を再度開いたときに進行中ジョブを引き当てるキー (例: "menu:abc:image") */
  entityKey?: string;
  phase: UploadPhase;
  error?: string;
}

export interface StartUploadOptions {
  file: File;
  label: string;
  entityKey?: string;
  /** アップロード完了直後に呼ばれる。呼び出し元が画面に残っているときだけ反映したい処理向け。 */
  onUploaded?: (path: string) => void;
  /** 画面が閉じていても必ず実行する永続化処理 (例: メニューの imagePath 更新)。 */
  commit?: (path: string) => Promise<void>;
}

const DONE_VISIBLE_MS = 4000;

let jobs: UploadJob[] = [];
const listeners = new Set<() => void>();
// 再試行用に元のオプションを保持する (UploadJob はシリアライズ不要な表示用の形に保つ)
const retryOptions = new Map<string, StartUploadOptions>();

function emit() {
  listeners.forEach((l) => l());
}

function patch(id: string, next: Partial<UploadJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...next } : j));
  emit();
}

function isHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  if (err && typeof err === "object" && "code" in err) return `変換エラー (${String(err.code)})`;
  return "アップロードに失敗しました";
}

async function run(id: string, opts: StartUploadOptions) {
  try {
    let upload = opts.file;
    if (isHeic(opts.file)) {
      patch(id, { phase: "converting", error: undefined });
      // 2026-09-27: Workers/R2へHEICのまま保存すると一般ブラウザで表示できないため、
      // 必要な時だけブラウザ側でJPEGへ変換し、既存のアップロード経路へ渡す。
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: opts.file, toType: "image/jpeg", quality: 0.9 });
      const jpeg = Array.isArray(converted) ? converted[0] : converted;
      if (!jpeg) throw new Error("HEIC画像を変換できませんでした");
      upload = new File([jpeg], opts.file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
    }
    patch(id, { phase: "uploading", error: undefined });
    const data = await uploadImage(upload);
    opts.onUploaded?.(data.path);
    if (opts.commit) {
      patch(id, { phase: "saving" });
      await opts.commit(data.path);
    }
    patch(id, { phase: "done" });
    retryOptions.delete(id);
    setTimeout(() => dismissUpload(id), DONE_VISIBLE_MS);
  } catch (err) {
    patch(id, { phase: "error", error: errorMessage(err) });
  }
}

export function startUpload(opts: StartUploadOptions): string {
  const id = crypto.randomUUID();
  jobs = [
    ...jobs,
    { id, fileName: opts.file.name, label: opts.label, entityKey: opts.entityKey, phase: "uploading" },
  ];
  retryOptions.set(id, opts);
  emit();
  void run(id, opts);
  return id;
}

export function retryUpload(id: string) {
  const opts = retryOptions.get(id);
  if (opts) void run(id, opts);
}

export function dismissUpload(id: string) {
  jobs = jobs.filter((j) => j.id !== id);
  retryOptions.delete(id);
  emit();
}

/** 変換/アップロード/保存のいずれかが進行中か (離脱警告の判定用) */
export function isUploadActive(list: readonly UploadJob[] = jobs): boolean {
  return list.some((j) => j.phase === "converting" || j.phase === "uploading" || j.phase === "saving");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUploadJobs(): readonly UploadJob[] {
  return useSyncExternalStore(subscribe, () => jobs, () => jobs);
}

/** entityKey に紐づく最新ジョブ (完了済みは除く)。画像欄を開き直したときの進行表示に使う。 */
export function useEntityUpload(entityKey?: string): UploadJob | undefined {
  const list = useUploadJobs();
  if (!entityKey) return undefined;
  return [...list].reverse().find((j) => j.entityKey === entityKey && j.phase !== "done");
}

/** テスト用: ストアを初期状態に戻す */
export function __resetUploadManager() {
  jobs = [];
  retryOptions.clear();
  emit();
}

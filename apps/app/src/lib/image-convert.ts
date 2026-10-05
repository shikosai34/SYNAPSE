// 2026-10-05 Issue #97: HEIC 変換を upload-manager から分離する。
// 「ERR_LIBHEIF format not supported」の原因は主に2つあった。
//  1. Safari/iOS が選択時に HEIC を JPEG へ変換しつつ名前は .HEIC のまま渡す
//     → 拡張子だけの判定では heic2any に誤って渡してしまう。先頭バイトで実体を判定して回避する。
//  2. heic2any (libheif が古い) が新しい端末の HEIC を読めない
//     → ブラウザ標準のデコード (Safari は HEIC 対応) + canvas で JPEG 化するフォールバックを用意する。

export type SniffedFormat = "jpeg" | "png" | "gif" | "webp" | "heic" | "unknown";

const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

/** 先頭バイト列から画像の実体形式を判定する (拡張子・MIME は信用しない)。 */
export function sniffImageFormat(head: Uint8Array): SniffedFormat {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.length >= 4 && head[0] === 0x89 && ascii(head, 1, 4) === "PNG") return "png";
  if (head.length >= 4 && ascii(head, 0, 4) === "GIF8") return "gif";
  if (head.length >= 12 && ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "webp";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp" && HEIC_BRANDS.includes(ascii(head, 8, 12))) {
    return "heic";
  }
  return "unknown";
}

export function isHeicLike(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type);
}

const EXT_BY_FORMAT: Record<Exclude<SniffedFormat, "heic" | "unknown">, { ext: string; type: string }> = {
  jpeg: { ext: "jpg", type: "image/jpeg" },
  png: { ext: "png", type: "image/png" },
  gif: { ext: "gif", type: "image/gif" },
  webp: { ext: "webp", type: "image/webp" },
};

function renameExt(name: string, ext: string): string {
  return name.replace(/\.[^.]+$/, "") + `.${ext}`;
}

async function convertWithHeic2any(file: File): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const jpeg = Array.isArray(converted) ? converted[0] : converted;
  if (!jpeg) throw new Error("HEIC画像を変換できませんでした");
  return jpeg;
}

/** ブラウザ標準のデコード (Safari は HEIC 対応) で JPEG 化する。 */
async function convertWithNativeDecoder(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas を初期化できませんでした");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEGへの変換に失敗しました"))), "image/jpeg", 0.9),
    );
  } finally {
    bitmap.close();
  }
}

export const HEIC_UNSUPPORTED_MESSAGE =
  "この HEIC 画像を変換できませんでした。iPhone の「設定 > カメラ > フォーマット」を「互換性優先」にするか、JPEG/PNG で選び直してください";

/**
 * アップロード可能な形へ整える。HEIC (拡張子/MIME が HEIC 系) のときだけ中身を調べる。
 * - 実体が JPEG/PNG 等 → 変換せず、正しい拡張子へ直してそのまま渡す。
 * - 実体が HEIC/不明 → heic2any、失敗したらブラウザ標準デコードで JPEG 化。
 */
export async function prepareImageForUpload(
  file: File,
  onConverting?: () => void,
): Promise<File> {
  if (!isHeicLike(file)) return file;

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const format = sniffImageFormat(head);
  if (format !== "heic" && format !== "unknown") {
    const { ext, type } = EXT_BY_FORMAT[format];
    return new File([await file.arrayBuffer()], renameExt(file.name, ext), { type });
  }

  onConverting?.();
  let jpeg: Blob;
  try {
    jpeg = await convertWithHeic2any(file);
  } catch (primary) {
    try {
      jpeg = await convertWithNativeDecoder(file);
    } catch {
      console.error("HEIC conversion failed", primary);
      throw new Error(HEIC_UNSUPPORTED_MESSAGE);
    }
  }
  return new File([jpeg], renameExt(file.name, "jpg"), { type: "image/jpeg" });
}

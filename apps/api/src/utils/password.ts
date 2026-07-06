/**
 * パスワード/PIN ハッシュ共通ユーティリティ (2026-07-06 追加)
 *
 * 背景: これまで bcryptjs を saltRounds=4 で使用していたが、これは強度が極端に低く
 * DB 漏洩時に即解読され得る。saltRounds を上げると Workers の CPU 制限(50ms/リクエスト)
 * に抵触するため、WebCrypto のネイティブ実装である PBKDF2-HMAC-SHA256 (iterations=100000)
 * へ移行する。ネイティブ実装は同等以上の強度を保ちつつ CPU 時間を抑えられる。
 *
 * 後方互換: 既存 DB には bcrypt 形式("$2a$"/"$2b$"/"$2y$" 等)のハッシュが残っているため、
 * verifySecret は stored の形式を見て bcrypt / PBKDF2 のどちらでも検証できるようにする。
 * ログイン成功時に isLegacyHash で判定し、呼び出し側で新形式へ再ハッシュすることを推奨する。
 *
 * 新規ハッシュのフォーマット: "pbkdf2$sha256$<iterations>$<saltBase64>$<hashBase64>"
 */
import bcrypt from "bcryptjs";

const ALGORITHM = "pbkdf2";
const DIGEST = "sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_LENGTH_BITS = 256; // 32 バイト

/** Uint8Array を Base64 文字列へ変換する (Workers の atob/btoa を利用)。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

/** Base64 文字列を Uint8Array へ変換する。 */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** PBKDF2-HMAC-SHA256 で derivedKey (32 バイト) を計算する。 */
async function deriveKey(
  plain: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: DIGEST.toUpperCase().replace("SHA", "SHA-"), // "sha256" -> "SHA-256"
    },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return new Uint8Array(derivedBits);
}

/** stored が旧 bcrypt 形式かどうかを判定する ("$2a$" / "$2b$" / "$2y$" 等)。 */
export function isLegacyHash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  return /^\$2[aby]?\$/.test(stored);
}

/** stored が新形式 (pbkdf2$...) かどうかを判定する。 */
function isPbkdf2Hash(stored: string): boolean {
  return stored.startsWith(`${ALGORITHM}$`);
}

/**
 * 定数時間でのバイト列比較。長さが異なる場合は早期に false を返すが、
 * その後の比較は常に全バイトを走査し XOR 差分を累積することでタイミング攻撃を避ける。
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

/** 新規ハッシュを生成する。返り値: "pbkdf2$sha256$<iterations>$<saltBase64>$<hashBase64>" */
export async function hashSecret(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKey(plain, salt, ITERATIONS);
  return `${ALGORITHM}$${DIGEST}$${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
}

/**
 * plain が stored ハッシュに一致するか検証する。
 * - stored が旧 bcrypt 形式なら bcryptjs.compare で検証 (後方互換)。
 * - stored が "pbkdf2$" 形式なら PBKDF2 で検証 (定数時間比較)。
 * - stored が null/undefined/空/不明形式、またはパースに失敗した場合は false。
 * 例外は投げない。
 */
export async function verifySecret(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;

  try {
    if (isLegacyHash(stored)) {
      return await bcrypt.compare(plain, stored);
    }

    if (isPbkdf2Hash(stored)) {
      const parts = stored.split("$");
      // ["pbkdf2", "sha256", "<iterations>", "<saltBase64>", "<hashBase64>"]
      if (parts.length !== 5) return false;
      const [algo, , iterationsStr, saltB64, hashB64] = parts;
      if (algo !== ALGORITHM) return false;
      if (!iterationsStr || !saltB64 || !hashB64) return false;

      const iterations = Number.parseInt(iterationsStr, 10);
      if (!Number.isFinite(iterations) || iterations <= 0) return false;

      const salt = base64ToBytes(saltB64);
      const expected = base64ToBytes(hashB64);
      const actual = await deriveKey(plain, salt, iterations);
      return constantTimeEqual(actual, expected);
    }

    return false;
  } catch {
    return false;
  }
}

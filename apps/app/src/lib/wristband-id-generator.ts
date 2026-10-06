const WRISTBAND_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_BUFFER_SIZE = 65_536;

/** 2026-10-06: 連番ではなく暗号学的乱数を使い、QR URLのID推測を難しくする。 */
export function generateWristbandIds(prefix: string, count: number, suffixLength: number): string[] {
  const normalizedPrefix = prefix.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedPrefix)) {
    throw new Error("イベント固有IDは半角英数字、ハイフン、アンダースコアで入力してください。");
  }
  if (!Number.isSafeInteger(count) || count < 1 || count > 50_000) {
    throw new Error("人数は1〜50,000の整数で指定してください。");
  }
  if (!Number.isSafeInteger(suffixLength) || suffixLength < 4 || suffixLength > 32) {
    throw new Error("ランダム文字列の長さは4〜32文字で指定してください。");
  }
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("安全な乱数を生成できない環境です。HTTPSまたはlocalhostで開いてください。");
  }

  const ids = new Set<string>();
  let randomBytes = new Uint8Array(0);
  let randomIndex = 0;
  const nextRandomByte = () => {
    if (randomIndex >= randomBytes.length) {
      randomBytes = globalThis.crypto.getRandomValues(new Uint8Array(RANDOM_BUFFER_SIZE));
      randomIndex = 0;
    }
    return randomBytes[randomIndex++]!;
  };

  while (ids.size < count) {
    let suffix = "";
    for (let index = 0; index < suffixLength; index += 1) {
      // 文字種は32種なので下位5bitを使えば偏りなく一文字を選べる。
      suffix += WRISTBAND_ID_ALPHABET[nextRandomByte() & 31];
    }
    ids.add(`${normalizedPrefix}-${suffix}`);
  }

  return [...ids];
}

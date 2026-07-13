/**
 * 2026-07-07 (Phase6): `cn` 実装 (border-thin/thick/heavy を tailwind-merge の
 * border-width グループに登録するカスタムマージ) は register/visitor で完全に重複しており、
 * 同じバグ修正 (border-thick が border-border に潰される問題) を2回行った経緯がある。
 * @fesflow/config/cn へ共有化し、ここでは re-export するだけにする
 * (`@/lib/utils` からの既存 import を壊さないため)。
 */
export { cn } from "@fesflow/config/cn";

export function extractIdFromCode(code: string): string {
	const trimmed = code.trim();
	// 1. /w/usr_xxxx などの URL から ID を抽出する
	const wMatch = trimmed.match(/\/w\/([a-zA-Z0-9_\-]+)/);
	if (wMatch && wMatch[1]) {
		return wMatch[1];
	}
	// 2. ?wb=usr_xxxx などの URL またはクエリから ID を抽出する
	const wbMatch = trimmed.match(/[?&]wb=([a-zA-Z0-9_\-]+)/);
	if (wbMatch && wbMatch[1]) {
		return wbMatch[1];
	}
	// 2026-07-13: 店頭スキャン等でチェックインURL (例: https://.../circle/checkin?wb=sp_usr_xxx) が入ってきた場合に対応
	const wbMatch = trimmed.match(/[\?&]wb=([a-zA-Z0-9_\-]+)/);
	if (wbMatch && wbMatch[1]) {
		return wbMatch[1];
	}
	return trimmed;
}

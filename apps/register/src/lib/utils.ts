import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * 2026-07-06: カスタム枠線ユーティリティ (border-thin/thick/heavy) を tailwind-merge に
 * 「border-width」グループとして登録する。
 *
 * これをしないと twMerge は `border-thick` を `border-border` (border-color) と同じ
 * 競合グループとみなし、`border-thick border-border` のように色クラスが後に来ると
 * 幅クラス(border-thick)を捨ててしまう → 枠が幅0で不可視になる。
 * (実際 `twMerge("border-thick border-border") === "border-border"` だった)
 * width グループに入れることで色クラスと共存し、幅同士だけが後勝ちになる。
 */
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"border-w": ["border-thin", "border-thick", "border-heavy"],
			"border-w-x": ["border-x-thin", "border-x-thick", "border-x-heavy"],
			"border-w-y": ["border-y-thin", "border-y-thick", "border-y-heavy"],
			"border-w-t": ["border-t-thin", "border-t-thick", "border-t-heavy"],
			"border-w-r": ["border-r-thin", "border-r-thick", "border-r-heavy"],
			"border-w-b": ["border-b-thin", "border-b-thick", "border-b-heavy"],
			"border-w-l": ["border-l-thin", "border-l-thick", "border-l-heavy"],
		},
	},
});

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function extractIdFromCode(code: string): string {
	const trimmed = code.trim();
	// http://localhost:3001/w/usr_xxxx などの URL から ID を抽出する
	const match = trimmed.match(/\/w\/([a-zA-Z0-9_\-]+)/);
	if (match && match[1]) {
		return match[1];
	}
	return trimmed;
}

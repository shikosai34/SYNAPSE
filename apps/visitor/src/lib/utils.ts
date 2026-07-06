import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * 2026-07-06: カスタム枠線ユーティリティ (border-thin/thick/heavy) を tailwind-merge の
 * border-width グループとして登録。未登録だと `border-thick border-border` で色クラスが
 * 幅クラスを上書きし枠が不可視になる (register 側と同じ対応)。
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

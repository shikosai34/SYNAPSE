import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Phase6: register/visitor で全く同一の実装が重複していた `cn` をここに共有化する。
 *
 * 背景 (元は各アプリの lib/utils.ts に個別実装されていた):
 * カスタム枠線ユーティリティ (border-thin/thick/heavy) を tailwind-merge に
 * 「border-width」グループとして登録する。
 *
 * これをしないと twMerge は `border-thick` を `border-border` (border-color) と同じ
 * 競合グループとみなし、`border-thick border-border` のように色クラスが後に来ると
 * 幅クラス(border-thick)を捨ててしまう → 枠が幅0で不可視になる。
 * (実際 `twMerge("border-thick border-border") === "border-border"` だった)
 * width グループに入れることで色クラスと共存し、幅同士だけが後勝ちになる。
 *
 * cn は clsx + tailwind-merge のみに依存する純粋関数 (React 非依存・副作用なし) なので、
 * @fesflow/config に置いても Tailwind v4 のコンテンツ走査 (各アプリの index.css が
 * 対象にするソースディレクトリ) には影響しない。ロジックの二重メンテ (同じバグを
 * 2度別々に直した経緯がある) を避けるためにここへ集約する。
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

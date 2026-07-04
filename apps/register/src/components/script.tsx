import { useEffect } from "react";

/**
 * next/script 互換シム (2026-07-04)。
 * SPA では最適化ローダーが無いので、外部 src を useEffect で
 * <script> として一度だけ注入する。インライン children には未対応
 * (現状の用途は外部 src のみ)。
 */
type Props = {
	src?: string;
	strategy?: string;
	onLoad?: () => void;
	id?: string;
	children?: never;
};

export default function Script({ src, onLoad, id }: Props) {
	useEffect(() => {
		if (!src) return;
		// 同一 src の二重注入を避ける
		const existing = document.querySelector(
			`script[data-fesflow-src="${src}"]`,
		);
		if (existing) {
			onLoad?.();
			return;
		}
		const el = document.createElement("script");
		el.src = src;
		el.async = true;
		if (id) el.id = id;
		el.dataset.fesflowSrc = src;
		if (onLoad) el.addEventListener("load", onLoad);
		document.body.appendChild(el);
	}, [src, id, onLoad]);

	return null;
}

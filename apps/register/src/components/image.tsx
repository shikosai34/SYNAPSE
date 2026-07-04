import type { ImgHTMLAttributes } from "react";

/**
 * next/image 互換シム (2026-07-04)。
 * SPA では最適化ローダーが無いので素の <img> を返す。
 * next 固有 props (fill / priority / sizes 等) を吸収し、
 * fill 指定時は absolute で親要素いっぱいに広げる。
 */
type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "width" | "height"> & {
	src: string;
	alt?: string;
	fill?: boolean;
	width?: number | string;
	height?: number | string;
	// 以下は next 固有。受け取るだけで DOM には渡さない。
	priority?: boolean;
	sizes?: string;
	quality?: number;
	placeholder?: string;
	unoptimized?: boolean;
};

export default function Image({
	fill,
	className,
	priority: _priority,
	sizes: _sizes,
	quality: _quality,
	placeholder: _placeholder,
	unoptimized: _unoptimized,
	...rest
}: Props) {
	const fillClass = fill ? "absolute inset-0 h-full w-full object-cover" : "";
	const cls = [fillClass, className].filter(Boolean).join(" ");
	// alt は a11y のため空文字でも明示的に付与する
	return <img className={cls || undefined} alt={rest.alt ?? ""} {...rest} />;
}

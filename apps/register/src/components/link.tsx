import { Link as RouterLink, type LinkProps } from "react-router-dom";

/**
 * next/link 互換シム (2026-07-04)。
 * 大量ページの移植を import 差し替えのみで済ませるため、
 * next/link の `href` API を react-router の `to` にブリッジする。
 * (将来的に各所を素の <RouterLink to=...> に置換してもよい)
 */
type Props = Omit<LinkProps, "to"> & { href: LinkProps["to"] };

export default function Link({ href, ...rest }: Props) {
	return <RouterLink to={href} {...rest} />;
}

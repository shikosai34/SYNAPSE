/**
 * 来場者向けパスの絶対URLを組み立てる。
 * 本番は VITE_VISITOR_URL で公開先を指定し、開発時は同じSPAの現在のオリジンを使う。
 */
export const VISITOR_BASE_URL =
	(import.meta.env.VITE_VISITOR_URL as string) || "http://localhost:3001";

export function visitorUrl(path: string): string {
	// 2026-10-08: 開発ポートは3000番が使用中だとViteが自動でずらすため、実際の同一SPAを指す。
	const baseUrl = import.meta.env.DEV ? window.location.origin : VISITOR_BASE_URL;
	return `${baseUrl}${path}`;
}

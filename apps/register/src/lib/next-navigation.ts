import {
	useNavigate,
	useLocation,
	useSearchParams as useRouterSearchParams,
	useParams,
} from "react-router-dom";

/**
 * next/navigation 互換シム (2026-07-04)。
 * 大量ページを import 差し替えのみで移植するため、
 * next/navigation の API を react-router へブリッジする。
 */

/** next の useRouter 相当。push/replace/back/forward を提供。 */
export function useRouter() {
	const navigate = useNavigate();
	return {
		push: (to: string) => navigate(to),
		replace: (to: string) => navigate(to, { replace: true }),
		back: () => navigate(-1),
		forward: () => navigate(1),
		prefetch: () => {},
		refresh: () => {},
	};
}

/** next の usePathname 相当。 */
export function usePathname(): string {
	return useLocation().pathname;
}

/**
 * next の useSearchParams 相当 (読み取り専用の URLSearchParams を返す)。
 * react-router は [params, setParams] を返すため first を取り出す。
 */
export function useSearchParams(): URLSearchParams {
	const [params] = useRouterSearchParams();
	return params;
}

export { useParams };

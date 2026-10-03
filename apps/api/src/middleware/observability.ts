import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

/** 2026-10-03: 外部から受け取ったIDは信頼せず、全応答でサーバー生成IDを共有する。 */
export function ensureRequestId(c: Context<any>): string {
  const requestId = c.get("requestId") as string | undefined ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);
  return requestId;
}

/** 2026-10-03: 高頻度利用時のログ量を制限。設定不正時も成功1%・エラー全件を維持する。 */
export function successSampleRate(value?: string): number {
  if (value === undefined || value.trim() === "") return 0.01;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.01;
}

export const requestObservability: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = ensureRequestId(c);
  const started = performance.now();
  await next();
  // 2026-10-03: 生URL/クエリ/ヘッダ/本文を使わずHonoのルート定義のみを記録。
  // 未定義パスは一律 unmatched とし、未知URLに含まれるQR等を漏らさない。
  const route = c.res.status === 404 && !c.req.routePath ? "unmatched" : c.req.routePath || "unmatched";
  const rate = successSampleRate(c.env?.REQUEST_LOG_SAMPLE_RATE);
  if (c.res.status >= 400 || Math.random() < rate) {
    console.info(JSON.stringify({
      event: "http_request",
      requestId,
      method: c.req.method,
      route,
      status: c.res.status,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      sampleRate: c.res.status >= 400 ? 1 : rate,
      ...(c.get("errorCode") ? { code: c.get("errorCode") } : {}),
    }));
  }
};

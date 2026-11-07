// 2026-10-24: 日付だけで設定する開催終了日は、日本時間の当日が終わるまで有効とする。
const JST_END_OF_DATE_OFFSET_MS = 15 * 60 * 60 * 1000;

export function isEventDateExpired(endDate: Date | null | undefined, now = Date.now()): boolean {
  if (!endDate) return false;
  const endOfJstDate = endDate.getTime() + JST_END_OF_DATE_OFFSET_MS;
  return Number.isFinite(endOfJstDate) && endOfJstDate <= now;
}

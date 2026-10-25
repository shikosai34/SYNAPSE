// 2026-10-24: 日付入力の終了日は日本時間の当日いっぱい有効なので、UTC午前0時を締切にしない。
export function isEventEnded(event: {
  lifecycleStatus?: "upcoming" | "live" | "ended" | "archived" | null;
  endDate?: string | Date | null;
} | null | undefined, now = Date.now()): boolean {
  if (!event) return false;
  if (event.lifecycleStatus === "ended" || event.lifecycleStatus === "archived") return true;
  if (event.lifecycleStatus === "upcoming") return false;
  if (!event.endDate) return false;
  const endTime = event.endDate instanceof Date ? event.endDate.getTime() : Date.parse(event.endDate);
  // date input は YYYY-MM-DD を UTC 午前0時で保存する。15時間後が翌日の日本時間0時。
  const endOfJstDate = endTime + 15 * 60 * 60 * 1000;
  return Number.isFinite(endTime) && endOfJstDate <= now;
}

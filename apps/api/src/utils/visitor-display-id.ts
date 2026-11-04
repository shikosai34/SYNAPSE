import type { DB } from "@fesflow/db";

// 2026-11-04: 受付発行とopt-in注文の採番を共有し、イベント内の番号衝突を避ける。
/** イベント内の呼出ID範囲をDBの単一書き込みで確保する。 */
export async function allocateDisplayIds(db: DB, eventId: string, count: number): Promise<number> {
  // 2026-10-17: MAX(display_id)+1 は並行発行で衝突するため、D1のatomic upsertで範囲を予約する。
  // 既存データの最大値も毎回下限に使い、導入時の既存来場者を安全に引き継ぐ。
  const row = await db.$client.prepare(`
    INSERT INTO event_user_sequence (event_id, value)
    SELECT ?, COALESCE(MAX(display_id), 0) + ? FROM event_user WHERE event_id = ?
    ON CONFLICT(event_id) DO UPDATE SET value =
      max(event_user_sequence.value, (SELECT COALESCE(MAX(display_id), 0) FROM event_user WHERE event_id = ?)) + ?
    RETURNING value
  `).bind(eventId, count, eventId, eventId, count).first<{ value: number }>();
  if (!row) throw new Error("来場者番号を確保できませんでした");
  return row.value - count + 1;
}

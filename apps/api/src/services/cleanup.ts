import type { WorkerEnv } from "@fesflow/db";

// 2026-10-03 (#83): 既存の60日保持は変えず、終了状態を必須にする。
// 保存期間・会計資料を含む削除範囲の正式な方針は docs/OPERATIONS.md で別途決定する。
export const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_EVENTS_PER_RUN = 20;
const CIRCLE_TABLES = ["orders", "pre_order", "circle_visit", "numbered_ticket", "review", "user_stamp"] as const;
const EVENT_TABLES = ["event_user", "lottery"] as const;
const TABLES = [...CIRCLE_TABLES, ...EVENT_TABLES] as const;
type CleanupTable = (typeof TABLES)[number];

/** 2026-10-03 (#83): school/accounting retention policy must be approved before production deletion. */
export function cleanupMustDryRun(env: Pick<WorkerEnv, "CLEANUP_ENABLED" | "CLEANUP_DRY_RUN">): boolean {
  return env.CLEANUP_ENABLED !== "true" || env.CLEANUP_DRY_RUN === "true";
}

export type CleanupResult = {
  dryRun: boolean;
  candidateEvents: number;
  processedEvents: number;
  changes: Record<CleanupTable, number>;
};

// SQLの識別子はこの固定リストのみから生成する。入力・テナント値は常にbindする。
function eventPredicate(table: CleanupTable, eventSql: string): string {
  return (CIRCLE_TABLES as readonly string[]).includes(table)
    ? `circle_id IN (SELECT id FROM circle WHERE event_id IN (${eventSql}))`
    : `event_id IN (${eventSql})`;
}

/** 終了状態を削除実行時にも再確認する。同じイベントの8文はD1 batchで全部成功/rollbackする。 */
export function cleanupStatements(db: WorkerEnv["DB"], eventId: string, cutoff: number, dryRun = false) {
  const eligible = "SELECT id FROM event WHERE id = ? AND lifecycle_status IN ('ended', 'archived') AND end_date < ?";
  return TABLES.map((table) => db.prepare(
    `${dryRun ? 'SELECT count(*) AS count FROM' : 'DELETE FROM'} "${table}" WHERE ${eventPredicate(table, eligible)}`,
  ).bind(eventId, cutoff));
}

export async function runCleanup(
  db: WorkerEnv["DB"],
  options: { now?: number; dryRun?: boolean } = {},
): Promise<CleanupResult> {
  const runId = crypto.randomUUID();
  const cutoff = (options.now ?? Date.now()) - RETENTION_MS;
  const dryRun = options.dryRun ?? false;
  const result: CleanupResult = {
    dryRun, candidateEvents: 0, processedEvents: 0,
    changes: Object.fromEntries(TABLES.map((table) => [table, 0])) as Record<CleanupTable, number>,
  };
  try {
    // 2026-10-03: 固定ページ上限で1回のCronを制限する。空のイベントを候補から除き、
    // 最初の20件が消去済みでも次回Cronで後続へ進める。IDの巨大なIN句を作らない。
    const hasData = TABLES.map((table) => `EXISTS (SELECT 1 FROM "${table}" WHERE ${eventPredicate(table, "SELECT e.id")})`).join(" OR ");
    const candidates = await db.prepare(`SELECT e.id FROM event e WHERE
      e.lifecycle_status IN ('ended', 'archived') AND e.end_date < ?
      AND (${hasData}) ORDER BY e.end_date, e.id LIMIT ?`).bind(cutoff, MAX_EVENTS_PER_RUN).all<{ id: string }>();
    result.candidateEvents = candidates.results.length;
    for (const candidate of candidates.results) {
      // 各文2bind。D1の100bind制限とPromise.allによる部分削除を同時に回避する。
      const outcomes = await db.batch(cleanupStatements(db, candidate.id, cutoff, dryRun));
      outcomes.forEach((outcome, i) => {
        result.changes[TABLES[i]!] += dryRun ? Number((outcome.results[0] as { count?: number })?.count ?? 0) : outcome.meta.changes;
      });
      result.processedEvents++;
    }
    // 識別子/プロフィールは出さず、実行相関IDと集計件数だけを監査する。
    console.info(JSON.stringify({ event: "retention_cleanup", runId, cutoff, ...result, outcome: "completed" }));
    return result;
  } catch {
    console.error(JSON.stringify({ event: "retention_cleanup", runId, cutoff, ...result, outcome: "failed" }));
    // 生のD1例外にはSQL/bindingsがあるため、Cron側に伝える例外も汎用化する。
    throw new Error(`Retention cleanup failed (${runId})`);
  }
}

import type { WorkerEnv } from "@fesflow/db";

// 2026-10-04 (#83): 初期値はユーザー指定の1年。管理画面から30日〜10年に調整できる。
// 値は候補期限だけを変え、CLEANUP_ENABLEDによる削除禁止ゲートは別に維持する。
export const DEFAULT_RETENTION_DAYS = 365;
export const MIN_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;
export const RETENTION_SETTING_KEY = "cleanup_retention";
const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_MS = DEFAULT_RETENTION_DAYS * DAY_MS;
const MAX_EVENTS_PER_RUN = 20;
const VISITOR_PROFILE_RETENTION_DAYS = 7;
const CIRCLE_TABLES = ["orders", "pre_order", "circle_visit", "numbered_ticket", "review", "user_stamp"] as const;
const EVENT_TABLES = ["event_user", "lottery"] as const;
const TABLES = [...CIRCLE_TABLES, ...EVENT_TABLES] as const;
type CleanupTable = (typeof TABLES)[number];

/** 不正・旧形式設定は安全な既定保持期間へ戻す。API更新時は別途範囲外を拒否する。 */
export function normalizeRetentionDays(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= MIN_RETENTION_DAYS && value <= MAX_RETENTION_DAYS
    ? value
    : DEFAULT_RETENTION_DAYS;
}

/** 管理設定とCronが同じJSON値を読む。未知・壊れた値は365日にフォールバックする。 */
export async function readCleanupRetentionDays(db: WorkerEnv["DB"]): Promise<number> {
  const row = await db.prepare("SELECT value FROM system_setting WHERE key = ?")
    .bind(RETENTION_SETTING_KEY).first<{ value: string }>();
  if (!row) return DEFAULT_RETENTION_DAYS;
  try {
    const stored = JSON.parse(row.value) as { retentionDays?: unknown };
    return normalizeRetentionDays(stored.retentionDays);
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

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
  options: { now?: number; dryRun?: boolean; retentionDays?: number } = {},
): Promise<CleanupResult> {
  const runId = crypto.randomUUID();
  const retentionDays = normalizeRetentionDays(options.retentionDays ?? await readCleanupRetentionDays(db));
  const cutoff = (options.now ?? Date.now()) - retentionDays * DAY_MS;
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

export type VisitorProfileCleanupResult = {
  dryRun: boolean;
  candidateEvents: number;
  processedEvents: number;
  changes: { eventUser: number; wristband: number };
};

/** Event 管理画面とCronの両方が使う、集計保全とプロフィール消去の一括処理。 */
export async function scrubVisitorProfilesForEvent(
  db: WorkerEnv["DB"],
  eventId: string,
  now: number,
) {
  const activeEvent = "EXISTS (SELECT 1 FROM event WHERE id = ? AND lifecycle_status IN ('ended', 'archived') AND privacy_scrubbed_at IS NULL)";
  const outcomes = await db.batch([
    // 年代構成は個人・リストバンドを参照しないイベント単位の集計として残す。
    db.prepare(`
      WITH profiles AS (
        SELECT COALESCE(w.age_group, '') AS age_group
        FROM wristband w JOIN event_user u ON w.user_id = u.id
        WHERE u.event_id = ? AND u.onboarded_at IS NOT NULL AND w.status IN ('active', 'smartphone')
        UNION ALL
        SELECT COALESCE(u.age_group, '') AS age_group
        FROM event_user u WHERE u.event_id = ? AND u.onboarded_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM wristband w WHERE w.user_id = u.id AND w.status IN ('active', 'smartphone'))
      ), grouped AS (
        SELECT age_group, COUNT(*) AS count FROM profiles GROUP BY age_group
      )
      INSERT INTO event_age_snapshot (event_id, profile_count, age_counts, captured_at)
      SELECT ?, COALESCE((SELECT SUM(count) FROM grouped),0),
        COALESCE((SELECT json_group_array(json_object('age_group',age_group,'count',count)) FROM grouped),'[]'), ?
      WHERE ${activeEvent}
      ON CONFLICT(event_id) DO NOTHING
    `).bind(eventId, eventId, eventId, now, eventId),
    // 注文の年代スナップショットを先に補完し、後続の分析で個人プロフィールを参照させない。
    db.prepare(`
      UPDATE orders SET age_group = (
        SELECT u.age_group FROM event_user u
        JOIN circle c ON c.id = orders.circle_id AND c.event_id = u.event_id
        WHERE u.id = orders.user_id
      )
      WHERE age_group IS NULL AND user_id IS NOT NULL
        AND circle_id IN (SELECT id FROM circle WHERE event_id = ?)
        AND ${activeEvent}
    `).bind(eventId, eventId),
    db.prepare(`UPDATE wristband SET nickname=NULL, age_group=NULL
      WHERE user_id IN (SELECT id FROM event_user WHERE event_id=?) AND ${activeEvent}
    `).bind(eventId, eventId),
    db.prepare(`UPDATE event_user SET nickname=NULL, age_group=NULL, allergies=NULL
      WHERE event_id=? AND ${activeEvent}
    `).bind(eventId, eventId),
    db.prepare(`UPDATE event SET privacy_scrubbed_at=?
      WHERE id=? AND lifecycle_status IN ('ended','archived') AND privacy_scrubbed_at IS NULL`).bind(now, eventId),
  ]);
  return {
    scrubbed: (outcomes[4]?.meta.changes ?? 0) === 1,
    ordersBackfilled: outcomes[1]?.meta.changes ?? 0,
    wristbandsScrubbed: outcomes[2]?.meta.changes ?? 0,
    visitorAccountsScrubbed: outcomes[3]?.meta.changes ?? 0,
  };
}

/**
 * 開催終了から7日を過ぎた来場者のプロフィール情報を消去する。
 * 年代・ニックネームは event_user と wristband に複製され、アレルギー情報は event_user に保存される。
 */
export async function runVisitorProfileCleanup(
  db: WorkerEnv["DB"],
  options: { now?: number; dryRun?: boolean } = {},
): Promise<VisitorProfileCleanupResult> {
  const runId = crypto.randomUUID();
  const cutoff = (options.now ?? Date.now()) - VISITOR_PROFILE_RETENTION_DAYS * DAY_MS;
  const dryRun = options.dryRun ?? false;
  const result: VisitorProfileCleanupResult = {
    dryRun,
    candidateEvents: 0,
    processedEvents: 0,
    changes: { eventUser: 0, wristband: 0 },
  };

  try {
    const candidates = await db.prepare(`SELECT id FROM event WHERE
      lifecycle_status IN ('ended', 'archived') AND end_date <= ? AND privacy_scrubbed_at IS NULL
      ORDER BY end_date, id LIMIT ?`).bind(cutoff, MAX_EVENTS_PER_RUN).all<{ id: string }>();
    result.candidateEvents = candidates.results.length;

    for (const { id } of candidates.results) {
      if (dryRun) {
        result.processedEvents++;
        continue;
      }
      const outcome = await scrubVisitorProfilesForEvent(db, id, options.now ?? Date.now());
      if (!outcome.scrubbed) continue;
      result.changes.eventUser += outcome.visitorAccountsScrubbed;
      result.changes.wristband += outcome.wristbandsScrubbed;
      result.processedEvents++;
    }

    console.info(JSON.stringify({ event: "visitor_profile_cleanup", runId, cutoff, ...result, outcome: "completed" }));
    return result;
  } catch {
    console.error(JSON.stringify({ event: "visitor_profile_cleanup", runId, cutoff, ...result, outcome: "failed" }));
    throw new Error(`Visitor profile cleanup failed (${runId})`);
  }
}

import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  membership,
  authAttempt,
  systemSetting,
  announcement,
  event,
  circle,
  contractPayment,
  sudoSession,
  impersonationSession,
  auditLog,
  session,
  user,
  eventUser,
  type DB,
  type WorkerEnv,
} from "@fesflow/db";
import { eq, and, gt, lt, isNotNull, isNull, desc, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { requireSuperAdmin } from "../middleware/auth";
import {
  betterAuthSessionId,
  isFreshlyAuthenticated,
  getElevation,
  getImpersonation,
  requireSudo,
  audit,
  SUDO_TTL_MS,
  IMPERSONATION_TTL_MS,
} from "../utils/sudo";
import type { AppEnv, AppVariables } from "../types";
import {
  cleanupMustDryRun,
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  normalizeRetentionDays,
  RETENTION_SETTING_KEY,
} from "../services/cleanup";
import { notifyVisitors, sendPushToTargets } from "../services/web-push";

// ── 公開システム設定 (メンテナンス/お知らせ) ────────────────────────────
// 全アプリが起動時に読む。認証不要。value は JSON 文字列で保存。
const MAINT_KEY = "maintenance";

// 2026-07-08 (Phase5): db はモジュール Proxy ではなく c.get("db") 経由で受け取る (ALS撤去)。
// c を持たないモジュールレベルのヘルパは db を引数で受け取る。
async function readSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const rows = await db
    .select()
    .from(systemSetting)
    .where(eq(systemSetting.key, key));
  if (rows.length === 0) return fallback;
  try {
    return { ...fallback, ...JSON.parse(rows[0]!.value) } as T;
  } catch {
    return fallback;
  }
}

async function writeSetting(db: DB, key: string, value: unknown) {
  const json = JSON.stringify(value);
  await db
    .insert(systemSetting)
    .values({ key, value: json })
    .onConflictDoUpdate({
      target: systemSetting.key,
      set: { value: json, updatedAt: new Date() },
    });
}

const DEFAULT_MAINT = { enabled: false, message: "" };

// 公開ルート: GET /api/system/public
export const systemRoutes = new Hono<AppEnv>();

systemRoutes.get("/public", async (c) => {
  const db = c.get("db");
  const maintenance = await readSetting(db, MAINT_KEY, DEFAULT_MAINT);
  return c.json({ maintenance });
});

// 公開お知らせ一覧 (published のみ、新しい順)
systemRoutes.get("/announcements", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(announcement)
    .where(and(eq(announcement.published, true), isNull(announcement.deletedAt)))
    .orderBy(desc(announcement.createdAt));
  return c.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      level: r.level,
      createdAt: r.createdAt,
    })),
  );
});

// ── 管理ルート (super_admin 限定) ───────────────────────────────────────
export const adminRoutes = new Hono<{
  Bindings: WorkerEnv;
  Variables: AppVariables & { adminEmail: string };
}>();

// 全ルート super_admin ガード
// 2026-07-07 (Phase 3a): getAdminSession 呼び出しを middleware/auth.ts の
// requireSuperAdmin に集約。ここでは session から adminEmail を取り出すだけにする。
adminRoutes.use("*", requireSuperAdmin);
adminRoutes.use("*", async (c, next) => {
  // requireSuperAdmin が直前で session を必ず set しているため non-null。
  const session = c.get("session")!;
  c.set("adminEmail", session.user.email.toLowerCase());
  await next();
});

// 2026-10-16: 管理者の参照操作を記録する。変更操作はAPI共通監査ミドルウェアが記録する。
// 本文や生URLは保存せず、Honoのルート定義と実行者だけを残す。監査画面のポーリングと状態照会は除外する。
adminRoutes.use("*", async (c, next) => {
  await next();
  const method = c.req.method.toUpperCase();
  if (method !== "GET") return;
  const route = c.req.routePath || "unmatched";
  if (["/api/admin/audit", "/api/admin/sudo/status", "/api/admin/impersonate/status"].includes(route)) return;
  try {
    await c.get("db").insert(auditLog).values({
      id: ulid(),
      actorEmail: c.get("adminEmail"),
      action: c.res.status >= 200 && c.res.status < 300 ? "admin_view" : "operator_failure",
      method,
      path: route,
      summary: c.res.status >= 200 && c.res.status < 300
        ? "システム管理画面から参照"
        : `参照失敗 (HTTP ${c.res.status})`,
    });
  } catch (error) {
    // 2026-10-16: 操作自体の成功応答を監査ログDBの一時障害で失敗に変えない。
    console.error("admin_audit_write_failed", { route, method, error });
  }
});

// メンテナンス設定の取得 (管理画面用)
// 2026-10-04 (#83): 保持日数と削除可否を分離し、設定変更だけで本番削除が有効にならないようにする。
adminRoutes.get("/settings", async (c) => {
  const db = c.get("db");
  const maintenance = await readSetting(db, MAINT_KEY, DEFAULT_MAINT);
  const cleanupSetting = await readSetting(db, RETENTION_SETTING_KEY, { retentionDays: DEFAULT_RETENTION_DAYS });
  return c.json({
    maintenance,
    cleanup: {
      retentionDays: normalizeRetentionDays(cleanupSetting.retentionDays),
      minDays: MIN_RETENTION_DAYS,
      maxDays: MAX_RETENTION_DAYS,
      dryRun: cleanupMustDryRun(c.env),
    },
  });
});

// メンテナンス設定の更新
adminRoutes.put(
  "/settings",
  zBody(
    z.object({
      maintenance: z
        .object({ enabled: z.boolean(), message: z.string().max(500) })
        .optional(),
      cleanup: z.object({
        retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
      }).optional(),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const input = c.req.valid("json");
    if (input.maintenance) await writeSetting(db, MAINT_KEY, input.maintenance);
    if (input.cleanup) await writeSetting(db, RETENTION_SETTING_KEY, input.cleanup);
    if (input.maintenance || input.cleanup) {
      await audit(c, {
        actorEmail: c.get("adminEmail"),
        action: "system_setting_update",
        method: "PUT",
        path: "/api/admin/settings",
        summary: input.cleanup
          ? `イベントデータ保持期間を${input.cleanup.retentionDays}日に変更`
          : "メンテナンス設定を変更",
      });
    }
    return c.json({ success: true });
  },
);

// ── お知らせ CMS (super_admin) ─────────────────────────────────────────
const announcementInput = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(2000).default(""),
  level: z.enum(["info", "warning", "critical"]).default("info"),
  published: z.boolean().default(false),
});

// 全お知らせ (下書き含む)
adminRoutes.get("/announcements", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(announcement)
    .orderBy(desc(announcement.createdAt));
  return c.json(rows);
});

async function notifyPublishedSystemAnnouncement(
  db: AppEnv["Variables"]["db"],
  env: WorkerEnv,
  input: { id: string; title: string; body: string },
) {
  const staffRows = await db.select({ userEmail: membership.userEmail }).from(membership)
    .where(eq(membership.isActive, true));
  const staffEmails = [...new Set(staffRows.map((row) => row.userEmail.toLowerCase()))];
  const visitorRows = await db.select({ id: eventUser.id, eventId: eventUser.eventId })
    .from(eventUser)
    .innerJoin(event, eq(event.id, eventUser.eventId))
    .where(and(
      eq(event.lifecycleStatus, "live"),
      eq(eventUser.status, "available"),
      isNull(event.deletedAt),
    ));
  const message = input.body || "新しいシステムのお知らせがあります。";
  await notifyVisitors(db, env, visitorRows, {
    type: "system_announcement",
    title: input.title,
    message,
    href: "/visitor/notifications",
    dedupeKey: (visitorId) => `system-announcement:${input.id}:${visitorId}`,
  }, {
    title: input.title,
    body: message,
    url: "/visitor/notifications",
    tag: `system-announcement-${input.id}`,
  });
  await sendPushToTargets(db, env, staffEmails.map((ownerId) => ({ ownerType: "staff" as const, ownerId })), {
    title: input.title,
    body: message,
    url: "/",
    tag: `system-announcement-${input.id}`,
  });
}

adminRoutes.post("/announcements", zBody(announcementInput), async (c) => {
  const db = c.get("db");
  const input = c.req.valid("json");
  const id = ulid();
  await db.insert(announcement).values({ id, ...input });
  if (input.published) {
    c.executionCtx.waitUntil(notifyPublishedSystemAnnouncement(db, c.env, {
      id,
      title: input.title,
      body: input.body,
    }).catch(() => console.warn("system_announcement_fanout_failed")));
  }
  return c.json({ success: true, id });
});

adminRoutes.patch(
  "/announcements/:id",
  zBody(announcementInput.partial()),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const existingRows = await db.select().from(announcement).where(and(
      eq(announcement.id, id), isNull(announcement.deletedAt),
    )).limit(1);
    const previous = existingRows[0];
    await db
      .update(announcement)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(announcement.id, id), isNull(announcement.deletedAt)));
    if (previous && !previous.published && input.published === true) {
      c.executionCtx.waitUntil(notifyPublishedSystemAnnouncement(db, c.env, {
        id,
        title: input.title ?? previous.title,
        body: input.body ?? previous.body,
      }).catch(() => console.warn("system_announcement_fanout_failed")));
    }
    return c.json({ success: true });
  },
);

adminRoutes.delete("/announcements/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  // 2026-10-21: 配信根拠を残し、アーカイブ時は以後の公開だけ停止する。
  await db.update(announcement).set({ published: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(announcement.id, id), isNull(announcement.deletedAt)));
  return c.json({ success: true });
});

// 2026-10-21: 復元しても自動で再公開しない。運営者が内容を確認してから公開を選ぶ。
adminRoutes.post("/announcements/:id/restore", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  await db.update(announcement).set({ deletedAt: null, published: false, updatedAt: new Date() })
    .where(and(eq(announcement.id, id), isNotNull(announcement.deletedAt)));
  return c.json({ success: true });
});

// 全アカウント (= membership を持つユーザー) の一覧。email 単位で集約。
adminRoutes.get("/users", async (c) => {
  const db = c.get("db");
  const memberships = await db.select().from(membership);
  const events = await db.select().from(event);
  const circles = await db.select().from(circle);
  const eventName = new Map(events.map((e) => [e.id, e.eventName]));
  const circleName = new Map(circles.map((c) => [c.id, c.name]));

  const byEmail = new Map<
    string,
    {
      email: string;
      name: string;
      isSuperAdmin: boolean;
      memberships: Array<{
        id: string;
        role: string;
        isActive: boolean;
        scope: string;
        scopeName: string;
      }>;
    }
  >();

  for (const m of memberships) {
    const email = m.userEmail.toLowerCase();
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        name: m.userName,
        isSuperAdmin: false,
        memberships: [],
      });
    }
    const acct = byEmail.get(email)!;
    if (m.role === "super_admin") acct.isSuperAdmin = true;
    const scope = m.role === "super_admin"
      ? "system"
      : m.eventId && !m.circleId
        ? "event"
        : m.circleId
          ? "circle"
          : "system";
    const scopeName =
      scope === "event"
        ? eventName.get(m.eventId!) || "(イベント)"
        : scope === "circle"
          ? circleName.get(m.circleId!) || "(サークル)"
          : "システム全体";
    acct.memberships.push({
      id: m.id,
      role: m.role,
      isActive: m.isActive,
      scope,
      scopeName,
    });
  }

  return c.json(
    Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email)),
  );
});

// メンバーシップのロール/有効状態を更新 (付与・剥奪・無効化)
adminRoutes.patch(
  "/memberships/:id",
  zBody(
    z.object({
      role: z
        .enum(["super_admin", "event_manager", "circle_manager", "circle_admin", "circle_staff"])
        .optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const adminEmail = c.get("adminEmail");

    const rows = await db.select().from(membership).where(eq(membership.id, id));
    if (rows.length === 0) {
      apiError("NOT_FOUND", "メンバーシップが見つかりません");
    }
    const target = rows[0]!;

    // 2026-10-16: ロールは所属スコープと一致させ、誤ったロールで到達不能な権限を作らない。
    if (input.role !== undefined) {
      const scope = target.role === "super_admin"
        ? "system"
        : target.circleId
          ? "circle"
          : target.eventId
            ? "event"
            : "system";
      const allowedRoles = scope === "system"
        ? ["super_admin"]
        : scope === "event"
          ? ["event_manager"]
          : ["circle_manager", "circle_admin", "circle_staff"];
      if (!allowedRoles.includes(input.role)) {
        apiError("BAD_REQUEST", "所属スコープに設定できない権限です");
      }
    }

    // 自分自身の super_admin 権限を誤って失わないようガード
    const isSelfSuperAdmin =
      target.userEmail.toLowerCase() === adminEmail && target.role === "super_admin";
    if (
      isSelfSuperAdmin &&
      (input.isActive === false || (input.role && input.role !== "super_admin"))
    ) {
      apiError("BAD_REQUEST", "自分自身のシステム管理者権限は変更できません");
    }

    // 最後の super_admin を失わないようガード
    if (
      target.role === "super_admin" &&
      (input.isActive === false || (input.role && input.role !== "super_admin"))
    ) {
      const admins = await db
        .select()
        .from(membership)
        .where(and(eq(membership.role, "super_admin"), eq(membership.isActive, true)));
      if (admins.length <= 1) {
        apiError("BAD_REQUEST", "最後のシステム管理者は変更できません");
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.role !== undefined) patch.role = input.role;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    await db.update(membership).set(patch).where(eq(membership.id, id));
    return c.json({ success: true });
  },
);

// 期限切れセッション数を取得
adminRoutes.get("/sessions/expired-count", async (c) => {
  const db = c.get("db");
  const now = new Date();
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(session)
    .where(lt(session.expiresAt, now));
  const count = rows[0]?.count ?? 0;
  return c.json({ count });
});

// 期限切れセッションをクリーンアップ
adminRoutes.post("/sessions/cleanup", async (c) => {
  const db = c.get("db");
  const now = new Date();
  await db.delete(session).where(lt(session.expiresAt, now));
  const email = c.get("adminEmail");
  await audit(c, { actorEmail: email, action: "impersonated_write", summary: "Cleaned up expired sessions" });
  return c.json({ success: true });
});

// ── SaaS 運営コンソール: イベント/課金管理 (2026-07-12 Phase C) ──────────
// これらは「運営(admin)情報」= 集計・契約状態・名簿の俯瞰であり、テナントの
// 「内容」(メニュー/注文/売上の中身) には触れない。内容の閲覧は Phase D/E の
// 昇格(sudo)+なりすまし経由に限る、という分離方針。

// 運営ダッシュボードの KPI。
adminRoutes.get("/overview", async (c) => {
  const db = c.get("db");
  const now = new Date();
  const [events, circles, memberships, lockouts] = await Promise.all([
    db.select().from(event).where(isNull(event.deletedAt)),
    db.select({ id: circle.id }).from(circle).where(isNull(circle.deletedAt)),
    db.select({ userEmail: membership.userEmail }).from(membership).where(eq(membership.isActive, true)),
    db
      .select({ id: authAttempt.id })
      .from(authAttempt)
      .where(and(isNotNull(authAttempt.lockedUntil), gt(authAttempt.lockedUntil, now))),
  ]);
  const accounts = new Set(memberships.map((m) => m.userEmail.toLowerCase())).size;
  const byPlan: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const e of events) {
    byPlan[e.plan] = (byPlan[e.plan] ?? 0) + 1;
    byStatus[e.billingStatus] = (byStatus[e.billingStatus] ?? 0) + 1;
  }

  // 過去14日間のアカウント（user）および来場ユーザー（eventUser）登録数推移の集計
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  fourteenDaysAgo.setHours(0, 0, 0, 0);

  // 日付キー生成関数 (JST想定。+9時間してJSTの日付文字列を作る)
  const getJstDateString = (date: Date) => {
    const jstDate = new Date(date.getTime() + 9 * 3600 * 1000);
    return `${jstDate.getUTCFullYear()}-${String(jstDate.getUTCMonth() + 1).padStart(2, "0")}-${String(jstDate.getUTCDate()).padStart(2, "0")}`;
  };

  // 14日分のデフォルトマップを用意
  const growthMap = new Map<string, { date: string; accounts: number; visitors: number }>();
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const key = getJstDateString(d);
    growthMap.set(key, { date: key.slice(5), accounts: 0, visitors: 0 }); // date: "MM-DD"
  }

  // アカウント（user）と来場者（eventUser）の直近14日分の作成時刻を取得
  const [usersCreated, visitorsCreated] = await Promise.all([
    db.select({ createdAt: user.createdAt }).from(user).where(gt(user.createdAt, fourteenDaysAgo)),
    db.select({ createdAt: eventUser.createdAt }).from(eventUser).where(gt(eventUser.createdAt, fourteenDaysAgo)),
  ]);

  for (const u of usersCreated) {
    const key = getJstDateString(u.createdAt);
    const entry = growthMap.get(key);
    if (entry) entry.accounts += 1;
  }

  for (const v of visitorsCreated) {
    const key = getJstDateString(v.createdAt);
    const entry = growthMap.get(key);
    if (entry) entry.visitors += 1;
  }

  const userGrowth = Array.from(growthMap.values()).reverse();

  return c.json({
    events: events.length,
    circles: circles.length,
    accounts,
    lockouts: lockouts.length,
    byPlan,
    byStatus,
    userGrowth,
  });
});

// 全イベント一覧 (契約状態・サークル数・オーナー付き)。テナント横断の運営ビュー。
adminRoutes.get("/events", async (c) => {
  const db = c.get("db");
  // 2026-10-15 (#128): 削除済みイベントも運営画面に出し、期間制限なしの復元を可能にする。
  const events = await db.select().from(event).orderBy(desc(event.createdAt));
  const circles = await db.select({ id: circle.id, eventId: circle.eventId }).from(circle).where(isNull(circle.deletedAt));
  const circleCount = new Map<string, number>();
  for (const c2 of circles) circleCount.set(c2.eventId, (circleCount.get(c2.eventId) ?? 0) + 1);

  // 入金合計・最終入金日をテナントごとに集計する (契約管理の一覧で見せる)。
  const paidRows = await db
    .select({
      eventId: contractPayment.eventId,
      total: sql<number>`sum(${contractPayment.amount})`,
      lastPaidAt: sql<number>`max(${contractPayment.paidAt})`,
    })
    .from(contractPayment)
    .where(isNull(contractPayment.voidedAt))
    .groupBy(contractPayment.eventId);
  const paid = new Map(paidRows.map((r) => [r.eventId, r]));

  return c.json(
    events.map((e) => ({
      id: e.id,
      eventName: e.eventName,
      deletedAt: e.deletedAt,
      ownerEmail: e.ownerEmail,
      plan: e.plan,
      billingStatus: e.billingStatus,
      maxCircles: e.maxCircles,
      circleCount: circleCount.get(e.id) ?? 0,
      createdAt: e.createdAt,
      activatedAt: e.activatedAt,
      suspendedAt: e.suspendedAt,
      billingAmount: e.billingAmount,
      nextBillingAt: e.nextBillingAt,
      contractNotes: e.contractNotes,
      paidTotal: paid.get(e.id)?.total ?? 0,
      lastPaidAt: paid.get(e.id)?.lastPaidAt ? new Date(Number(paid.get(e.id)!.lastPaidAt)) : null,
    })),
  );
});

// イベントの契約/課金の手動更新 (銀行振込対応の裏口)。plan/maxCircles/billingStatus/名称。
adminRoutes.patch(
  "/events/:id",
  zBody(
    z.object({
      eventName: z.string().min(1).max(120).optional(),
      plan: z.string().min(1).max(40).optional(),
      maxCircles: z.number().int().min(1).max(10000).optional(),
      billingStatus: z.enum(["active", "trial", "suspended", "unpaid"]).optional(),
      billingAmount: z.number().int().min(0).max(100000000).optional(),
      // ISO 文字列 or null (未設定に戻す)。空なら null。
      nextBillingAt: z.string().datetime().nullable().optional(),
      contractNotes: z.string().max(2000).nullable().optional(),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const rows = await db.select().from(event).where(eq(event.id, id));
    if (rows.length === 0) apiError("NOT_FOUND", "イベントが見つかりません");

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.eventName !== undefined) patch.eventName = input.eventName;
    if (input.plan !== undefined) patch.plan = input.plan;
    if (input.maxCircles !== undefined) patch.maxCircles = input.maxCircles;
    if (input.billingAmount !== undefined) patch.billingAmount = input.billingAmount;
    if (input.nextBillingAt !== undefined)
      patch.nextBillingAt = input.nextBillingAt ? new Date(input.nextBillingAt) : null;
    if (input.contractNotes !== undefined) patch.contractNotes = input.contractNotes;
    if (input.billingStatus !== undefined) {
      patch.billingStatus = input.billingStatus;
      // 有効化/停止の時刻を記録 (監査・銀行振込運用のため)。
      if (input.billingStatus === "suspended") patch.suspendedAt = new Date();
      if (input.billingStatus === "active") {
        patch.activatedAt = new Date();
        patch.suspendedAt = null;
      }
    }
    await db.update(event).set(patch).where(eq(event.id, id));
    return c.json({ success: true });
  },
);

// 2026-11-03: テナントを運営画面から停止する操作は、sudo昇格を必須にする。
// フロントのパスキー案内だけに頼らず、APIへ直接送られた削除も同じ認可で拒否する。
adminRoutes.delete("/events/:id", requireSudo, async (c) => {
  const db = c.get("db");
  // 2026-11-03: 15分のsudo状態だけでは足りないため、削除リクエスト自体も
  // パスキー再認証から5分以内のセッションに限定する。
  if (!isFreshlyAuthenticated(c.get("session")!, Date.now())) {
    apiError("REAUTH_REQUIRED", "イベント削除にはパスキーでの再認証が必要です");
  }
  // /events/:id にマッチした時点で id は必ず存在する。\n  const id = c.req.param("id")!;
  const existing = await db
    .select({ deletedAt: event.deletedAt })
    .from(event)
    .where(eq(event.id, id));
  if (!existing[0]) apiError("NOT_FOUND", "イベントが見つかりません");
  // 2026-10-15 (#128): 子サークルにイベントIDを記録し、復元対象を明示する。
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE event SET deleted_at=COALESCE(deleted_at, ?) WHERE id=?")
      .bind(Date.now(), id),
    c.env.DB.prepare(`UPDATE circle SET deleted_at=(SELECT deleted_at FROM event WHERE id=?), deleted_with_event_id=?
      WHERE event_id=? AND deleted_at IS NULL`)
      .bind(id, id, id),
  ]);
  return c.json({ success: true });
});

// 2026-10-15 (#128): 論理削除したイベントは運営が期間制限なく復元できる。
adminRoutes.post("/events/:id/restore", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const rows = await db
    .select({ deletedAt: event.deletedAt })
    .from(event)
    .where(eq(event.id, id));
  if (!rows[0]) apiError("NOT_FOUND", "イベントが見つかりません");
  const deletedAt = rows[0].deletedAt;
  if (!deletedAt) return c.json({ success: true });

  // 2026-10-15 (#128): イベント削除と同時に隠したサークルだけを戻し、個別削除を維持する。
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE circle SET deleted_at=NULL, deleted_with_event_id=NULL
      WHERE event_id=? AND deleted_with_event_id=?`)
      .bind(id, id),
    c.env.DB.prepare("UPDATE event SET deleted_at=NULL WHERE id=?")
      .bind(id),
  ]);
  return c.json({ success: true });
});

// ── 契約入金履歴 (2026-07-15)。銀行振込等の手動入金台帳。 ──

// テナントの入金履歴一覧 (新しい順)。
adminRoutes.get("/events/:id/payments", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  const rows = await db
    .select()
    .from(contractPayment)
    .where(eq(contractPayment.eventId, eventId))
    .orderBy(desc(contractPayment.paidAt));
  return c.json(rows);
});

// 入金を1件記録する。
adminRoutes.post(
  "/events/:id/payments",
  zBody(
    z.object({
      amount: z.number().int().min(1).max(100000000),
      method: z.string().min(1).max(40).default("銀行振込"),
      paidAt: z.string().datetime(), // ISO
      note: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    const input = c.req.valid("json");

    const rows = await db.select().from(event).where(eq(event.id, eventId));
    if (rows.length === 0) apiError("NOT_FOUND", "イベントが見つかりません");

    const id = ulid();
    await db.insert(contractPayment).values({
      id,
      eventId,
      amount: input.amount,
      method: input.method,
      paidAt: new Date(input.paidAt),
      note: input.note ?? null,
      recordedBy: c.get("adminEmail") ?? null,
    });
    return c.json({ id }, 201);
  },
);

// 入金記録の訂正。金額台帳から行を消さず、訂正扱いとして合計から外す。
adminRoutes.delete("/payments/:paymentId", async (c) => {
  const db = c.get("db");
  const paymentId = c.req.param("paymentId");
  await db.update(contractPayment).set({
    voidedAt: new Date(),
    voidedBy: c.get("adminEmail"),
  }).where(and(eq(contractPayment.id, paymentId), isNull(contractPayment.voidedAt)));
  return c.json({ success: true });
});

// ── sudo (権限昇格) / impersonation (なりすまし) / 監査 (2026-07-12 Phase D/E) ──

// 昇格状態の照会。フロントがバナー/ガードの表示判定に使う。
adminRoutes.get("/sudo/status", async (c) => {
  const session = c.get("session")!;
  const el = await getElevation(c, betterAuthSessionId(session));
  return c.json({ elevated: !!el, expiresAt: el?.expiresAt ?? null });
});

// 昇格 (elevate)。パスキー再認証直後 (=セッションが新しい) の super_admin のみ 15 分昇格できる。
// フロントは事前に authClient.signIn.passkey() で再認証してから叩く。
adminRoutes.post("/sudo/elevate", async (c) => {
  const db = c.get("db");
  const session = c.get("session")!;
  const now = Date.now();
  // 直近の再認証を要求する (古いログインのまま昇格させない)。
  if (!isFreshlyAuthenticated(session, now)) {
    apiError("REAUTH_REQUIRED", "昇格にはパスキーでの再認証が必要です");
  }
  const sid = betterAuthSessionId(session);
  const email = session.user.email.toLowerCase();
  const expiresAt = new Date(now + SUDO_TTL_MS);
  // セッションごとに1行 (再昇格で更新)。
  await db
    .insert(sudoSession)
    .values({ id: ulid(), sessionId: sid, userEmail: email, method: "passkey", expiresAt })
    .onConflictDoUpdate({ target: sudoSession.sessionId, set: { expiresAt, createdAt: new Date() } });
  await audit(c, { actorEmail: email, action: "elevate" });
  return c.json({ elevated: true, expiresAt });
});

// 降格 (昇格の破棄)。
adminRoutes.post("/sudo/end", async (c) => {
  const db = c.get("db");
  const session = c.get("session")!;
  await db.delete(sudoSession).where(eq(sudoSession.sessionId, betterAuthSessionId(session)));
  return c.json({ success: true });
});

// なりすまし状態の照会 (バナー表示用)。
adminRoutes.get("/impersonate/status", async (c) => {
  const session = c.get("session")!;
  const imp = await getImpersonation(c, betterAuthSessionId(session));
  return c.json({
    active: !!imp,
    role: imp?.role ?? null,
    eventId: imp?.eventId ?? null,
    circleId: imp?.circleId ?? null,
    label: imp?.label ?? null,
    expiresAt: imp?.expiresAt ?? null,
  });
});

// なりすまし開始 (要 sudo)。対象ロール×スコープとして振る舞う。
adminRoutes.post(
  "/impersonate",
  requireSudo,
  zBody(
    z.object({
      role: z.enum(["event_manager", "circle_manager", "circle_staff"]),
      eventId: z.string().optional(),
      circleId: z.string().optional(),
      label: z.string().max(120).optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const session = c.get("session")!;
    const input = c.req.valid("json");

    // スコープの整合性: event_manager は eventId、circle_* は circleId が必須。
    if (input.role === "event_manager" && !input.eventId) {
      apiError("BAD_REQUEST", "event_manager のなりすましには eventId が必要です");
    }
    if ((input.role === "circle_manager" || input.role === "circle_staff") && !input.circleId) {
      apiError("BAD_REQUEST", "サークルロールのなりすましには circleId が必要です");
    }

    // 対象の存在確認 + 表示ラベル解決
    let label = input.label ?? null;
    let eventId = input.eventId ?? null;
    if (input.circleId) {
      const cs = await db.select().from(circle).where(eq(circle.id, input.circleId));
      if (cs.length === 0) apiError("NOT_FOUND", "対象のサークルが存在しません");
      eventId = cs[0]!.eventId;
      label = label ?? cs[0]!.name;
    } else if (input.eventId) {
      const es = await db.select().from(event).where(eq(event.id, input.eventId));
      if (es.length === 0) apiError("NOT_FOUND", "対象のイベントが存在しません");
      label = label ?? es[0]!.eventName;
    }

    const sid = betterAuthSessionId(session);
    const actorEmail = session.user.email.toLowerCase();
    const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);
    await db
      .insert(impersonationSession)
      .values({
        id: ulid(),
        sessionId: sid,
        actorEmail,
        role: input.role,
        eventId,
        circleId: input.circleId ?? null,
        label,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: impersonationSession.sessionId,
        set: { role: input.role, eventId, circleId: input.circleId ?? null, label, expiresAt, createdAt: new Date() },
      });
    await audit(c, {
      actorEmail,
      action: "impersonate_start",
      asRole: input.role,
      eventId,
      circleId: input.circleId ?? null,
      summary: label,
    });
    return c.json({ active: true, role: input.role, eventId, circleId: input.circleId ?? null, label, expiresAt });
  }
);

// なりすまし終了。
adminRoutes.post("/impersonate/stop", async (c) => {
  const db = c.get("db");
  const session = c.get("session")!;
  const sid = betterAuthSessionId(session);
  const imp = await getImpersonation(c, sid);
  await db.delete(impersonationSession).where(eq(impersonationSession.sessionId, sid));
  if (imp) {
    await audit(c, {
      actorEmail: session.user.email.toLowerCase(),
      action: "impersonate_stop",
      asRole: imp.role,
      eventId: imp.eventId,
      circleId: imp.circleId,
      summary: imp.label,
    });
  }
  return c.json({ success: true });
});

// 監査ログ (新しい順、ページ単位)。
adminRoutes.get("/audit", async (c) => {
  const db = c.get("db");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  const [rows, countRows] = await Promise.all([
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(auditLog),
  ]);
  return c.json({ rows, total: countRows[0]?.count ?? 0, limit, offset });
});

// 現在ロック中の認証試行 (アカウントロックアウト) 一覧
adminRoutes.get("/lockouts", async (c) => {
  const db = c.get("db");
  const now = new Date();
  const rows = await db
    .select()
    .from(authAttempt)
    .where(and(isNotNull(authAttempt.lockedUntil), gt(authAttempt.lockedUntil, now)));
  return c.json(
    rows.map((r) => ({
      id: r.id,
      key: r.key,
      scope: r.scope,
      failedCount: r.failedCount,
      lockedUntil: r.lockedUntil,
    })),
  );
});

// ロックアウト解除 (該当行を削除)
adminRoutes.delete("/lockouts/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  await db.delete(authAttempt).where(eq(authAttempt.id, id));
  return c.json({ success: true });
});

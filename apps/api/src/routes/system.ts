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
    .where(eq(announcement.published, true))
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

// メンテナンス設定の取得 (管理画面用)
adminRoutes.get("/settings", async (c) => {
  const db = c.get("db");
  const maintenance = await readSetting(db, MAINT_KEY, DEFAULT_MAINT);
  return c.json({ maintenance });
});

// メンテナンス設定の更新
adminRoutes.put(
  "/settings",
  zBody(
    z.object({
      maintenance: z
        .object({ enabled: z.boolean(), message: z.string().max(500) })
        .optional(),
    }),
  ),
  async (c) => {
    const db = c.get("db");
    const input = c.req.valid("json");
    if (input.maintenance) await writeSetting(db, MAINT_KEY, input.maintenance);
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

adminRoutes.post("/announcements", zBody(announcementInput), async (c) => {
  const db = c.get("db");
  const input = c.req.valid("json");
  const id = ulid();
  await db.insert(announcement).values({ id, ...input });
  return c.json({ success: true, id });
});

adminRoutes.patch(
  "/announcements/:id",
  zBody(announcementInput.partial()),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");
    await db
      .update(announcement)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(announcement.id, id));
    return c.json({ success: true });
  },
);

adminRoutes.delete("/announcements/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  await db.delete(announcement).where(eq(announcement.id, id));
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
        .enum(["super_admin", "event_manager", "circle_manager", "staff", "viewer"])
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
  const events = await db.select().from(event).where(isNull(event.deletedAt)).orderBy(desc(event.createdAt));
  const circles = await db.select({ id: circle.id, eventId: circle.eventId }).from(circle).where(isNull(circle.deletedAt));
  const circleCount = new Map<string, number>();
  for (const c2 of circles) circleCount.set(c2.eventId, (circleCount.get(c2.eventId) ?? 0) + 1);
  return c.json(
    events.map((e) => ({
      id: e.id,
      eventName: e.eventName,
      ownerEmail: e.ownerEmail,
      plan: e.plan,
      billingStatus: e.billingStatus,
      maxCircles: e.maxCircles,
      circleCount: circleCount.get(e.id) ?? 0,
      createdAt: e.createdAt,
      activatedAt: e.activatedAt,
      suspendedAt: e.suspendedAt,
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

// イベントの論理削除 (運営判断での停止・撤去)。
adminRoutes.delete("/events/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  await db.update(event).set({ deletedAt: new Date() }).where(eq(event.id, id));
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

// 監査ログ (直近 200 件)。
adminRoutes.get("/audit", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200);
  return c.json(rows);
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

import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  db,
  membership,
  authAttempt,
  systemSetting,
  announcement,
  event,
  circle,
} from "@fesflow/db";
import { eq, and, gt, isNotNull, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireSuperAdmin, type AuthVariables } from "../middleware/auth";

// ── 公開システム設定 (メンテナンス/お知らせ) ────────────────────────────
// 全アプリが起動時に読む。認証不要。value は JSON 文字列で保存。
const MAINT_KEY = "maintenance";

async function readSetting<T>(key: string, fallback: T): Promise<T> {
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

async function writeSetting(key: string, value: unknown) {
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
export const systemRoutes = new Hono();

systemRoutes.get("/public", async (c) => {
  const maintenance = await readSetting(MAINT_KEY, DEFAULT_MAINT);
  return c.json({ maintenance });
});

// 公開お知らせ一覧 (published のみ、新しい順)
systemRoutes.get("/announcements", async (c) => {
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
  Variables: AuthVariables & { adminEmail: string };
}>();

// 全ルート super_admin ガード
// 2026-07-07 (Phase 3a): getAdminSession 呼び出しを middleware/auth.ts の
// requireSuperAdmin に集約。ここでは session から adminEmail を取り出すだけにする。
adminRoutes.use("*", requireSuperAdmin);
adminRoutes.use("*", async (c, next) => {
  const session = c.get("session");
  c.set("adminEmail", session.user.email.toLowerCase());
  await next();
});

// メンテナンス設定の取得 (管理画面用)
adminRoutes.get("/settings", async (c) => {
  const maintenance = await readSetting(MAINT_KEY, DEFAULT_MAINT);
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
    const input = c.req.valid("json");
    if (input.maintenance) await writeSetting(MAINT_KEY, input.maintenance);
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
  const rows = await db
    .select()
    .from(announcement)
    .orderBy(desc(announcement.createdAt));
  return c.json(rows);
});

adminRoutes.post("/announcements", zBody(announcementInput), async (c) => {
  const input = c.req.valid("json");
  const id = nanoid();
  await db.insert(announcement).values({ id, ...input });
  return c.json({ success: true, id });
});

adminRoutes.patch(
  "/announcements/:id",
  zBody(announcementInput.partial()),
  async (c) => {
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
  const id = c.req.param("id");
  await db.delete(announcement).where(eq(announcement.id, id));
  return c.json({ success: true });
});

// 全アカウント (= membership を持つユーザー) の一覧。email 単位で集約。
adminRoutes.get("/users", async (c) => {
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
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const adminEmail = c.get("adminEmail") as string;

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

// 現在ロック中の認証試行 (アカウントロックアウト) 一覧
adminRoutes.get("/lockouts", async (c) => {
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
  const id = c.req.param("id");
  await db.delete(authAttempt).where(eq(authAttempt.id, id));
  return c.json({ success: true });
});

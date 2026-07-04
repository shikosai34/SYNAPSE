import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, event, circle, membership } from "@fesflow/db";
import { eq, and, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { getAdminSession, getSession } from "../utils/auth";

const eventRoutes = new Hono();

// イベント一覧取得 (2026-07-04 SaaSマルチテナント制限)
eventRoutes.get("/", async (c) => {
  const session = await getSession(c);
  if (!session || !session.user) {
    return c.json({ error: "認証が必要です" }, 401);
  }
  const email = session.user.email.toLowerCase();

  const userMemberships = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.userEmail, email),
        eq(membership.isActive, true)
      )
    );

  const isSystemAdmin = userMemberships.some(
    (m) => m.role === "super_admin" || m.role === "system_manager" || m.role === "system_staff"
  );

  if (isSystemAdmin) {
    const events = await db.select().from(event);
    return c.json(events);
  }

  const myEventIds = userMemberships
    .filter((m) => (m.role === "event_manager" || m.role === "event_staff") && m.eventId)
    .map((m) => m.eventId) as string[];

  if (myEventIds.length === 0) {
    return c.json([]);
  }

  const events = await db
    .select()
    .from(event)
    .where(inArray(event.id, myEventIds));

  return c.json(events);
});

// イベント取得
eventRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const events = await db.select().from(event).where(eq(event.id, id));

  if (events.length === 0) {
    return c.json({ error: "イベントが見つかりません" }, 404);
  }

  return c.json(events[0]);
});

// イベント作成
eventRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      eventName: z.string().min(1, "イベント名は必須です"),
      description: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })
  ),
  async (c) => {
    const session = await getAdminSession(c);
    if (!session) {
      return c.json({ error: "管理者権限が必要です" }, 403);
    }

    const input = c.req.valid("json");
    const id = nanoid();

    await db.insert(event).values({
      id,
      eventName: input.eventName,
      description: input.description,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
    });

    return c.json({ id }, 201);
  }
);

// イベント削除
eventRoutes.delete("/:id", async (c) => {
  const session = await getAdminSession(c);
  if (!session) {
    return c.json({ error: "管理者権限が必要です" }, 403);
  }

  const id = c.req.param("id");
  await db.delete(event).where(eq(event.id, id));
  return c.json({ success: true });
});

// テーマパック設定の更新
eventRoutes.put(
  "/:id/theme",
  zValidator(
    "json",
    z.object({
      logoUrl: z.string().nullable().optional(),
      fontFamily: z.string().optional(),
      customFontUrl: z.string().nullable().optional(),
      primaryColor: z.string().optional(),
      primaryTextColor: z.string().optional(),
      accentColor: z.string().optional(),
      accentTextColor: z.string().optional(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
    })


  ),
  async (c) => {
    const session = await getAdminSession(c);
    if (!session) {
      return c.json({ error: "管理者権限が必要です" }, 403);
    }

    const id = c.req.param("id");
    const input = c.req.valid("json");

    const existing = await db.select().from(event).where(eq(event.id, id));
    if (existing.length === 0) {
      // イベントが存在しない場合（デフォルトイベント等）、自動作成
      await db.insert(event).values({
        id,
        eventName: "メインイベント (学園祭・フェス)",
        ...input,
      });
    } else {
      await db
        .update(event)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(event.id, id));
    }

    const updated = await db.select().from(event).where(eq(event.id, id));
    return c.json(updated[0]);
  }
);


// サークルログイン（イベント名+サークル名+パスワードでサークルIDを取得）
eventRoutes.post(
  "/login",
  zValidator(
    "json",
    z.object({
      eventName: z.string(),
      circleName: z.string(),
      password: z.string(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

    // イベント名でイベントを検索
    const events = await db
      .select()
      .from(event)
      .where(eq(event.eventName, input.eventName));

    if (events.length === 0) {
      return c.json({ error: "イベントが見つかりません" }, 404);
    }

    const foundEvent = events[0]!;

    // サークル名とイベントIDでサークルを検索
    const circles = await db
      .select()
      .from(circle)
      .where(
        and(
          eq(circle.eventId, foundEvent.id),
          eq(circle.name, input.circleName)
        )
      );

    if (circles.length === 0) {
      return c.json({ error: "サークルが見つかりません" }, 404);
    }

    const foundCircle = circles[0]!;

    // パスワードの検証
    const isPasswordValid = await bcrypt.compare(
      input.password,
      foundCircle.password
    );

    if (!isPasswordValid) {
      return c.json({ error: "パスワードが正しくありません" }, 401);
    }

    return c.json({
      circleId: foundCircle.id,
      circleName: foundCircle.name,
      eventId: foundEvent.id,
      eventName: foundEvent.eventName,
    });
  }
);

export default eventRoutes;

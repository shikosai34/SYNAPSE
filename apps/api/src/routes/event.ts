import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { db, event, membership } from "@fesflow/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAdminSession, getSession } from "../utils/auth";

const eventRoutes = new Hono();

// イベント一覧取得 (2026-07-04 SaaSマルチテナント制限)
eventRoutes.get("/", async (c) => {
  const session = await getSession(c);
  if (!session || !session.user) {
    apiError("UNAUTHORIZED", "認証が必要です");
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

  // 2026-07-05: ROLES定数に存在しないロール名(system_manager, system_staff)を判定していた死んだ分岐を除去
  const isSystemAdmin = userMemberships.some((m) => m.role === "super_admin");

  if (isSystemAdmin) {
    // 論理削除済み(deletedAt != null)は除外
    const events = await db.select().from(event).where(isNull(event.deletedAt));
    return c.json(events);
  }

  // 2026-07-05: ROLES定数に存在しないロール名(event_staff)を判定していた死んだ分岐を除去
  const myEventIds = userMemberships
    .filter((m) => m.role === "event_manager" && m.eventId)
    .map((m) => m.eventId) as string[];

  if (myEventIds.length === 0) {
    return c.json([]);
  }

  const events = await db
    .select()
    .from(event)
    .where(and(inArray(event.id, myEventIds), isNull(event.deletedAt)));

  return c.json(events);
});

// イベント取得
eventRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const events = await db
    .select()
    .from(event)
    .where(and(eq(event.id, id), isNull(event.deletedAt)));

  if (events.length === 0) {
    apiError("NOT_FOUND", "イベントが見つかりません");
  }

  return c.json(events[0]);
});

// イベント作成
eventRoutes.post(
  "/",
  zBody(
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
      apiError("FORBIDDEN", "管理者権限が必要です");
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

// イベント削除 (論理削除) — システム管理者(super_admin)のみ
eventRoutes.delete("/:id", async (c) => {
  const session = await getAdminSession(c);
  if (!session) {
    apiError("FORBIDDEN", "管理者権限が必要です");
  }

  const id = c.req.param("id");
  // 物理削除せず deletedAt に時刻を書き込む (論理削除)
  await db.update(event).set({ deletedAt: new Date() }).where(eq(event.id, id));
  return c.json({ success: true });
});

// テーマ・基本設定の更新
eventRoutes.put(
  "/:id/theme",
  zBody(
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
      eventName: z.string().optional(),
      description: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const session = await getAdminSession(c);
    if (!session) {
      apiError("FORBIDDEN", "管理者権限が必要です");
    }

    const id = c.req.param("id");
    const input = c.req.valid("json");

    const updateData: any = { ...input };
    if (input.startDate) {
      updateData.startDate = new Date(input.startDate);
    } else if (input.startDate === null) {
      updateData.startDate = null;
    }
    if (input.endDate) {
      updateData.endDate = new Date(input.endDate);
    } else if (input.endDate === null) {
      updateData.endDate = null;
    }

    const existing = await db.select().from(event).where(eq(event.id, id));
    if (existing.length === 0) {
      // イベントが存在しない場合（デフォルトイベント等）、自動作成
      await db.insert(event).values({
        id,
        eventName: input.eventName || "メインイベント (学園祭・フェス)",
        ...updateData,
      });
    } else {
      await db
        .update(event)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(event.id, id));
    }

    const updated = await db.select().from(event).where(eq(event.id, id));
    return c.json(updated[0]);
  }
);


// 2026-07-07 (Phase 3a): サークルログイン (POST /login, イベント名+サークル名+パスワード)
// を廃止。並行認証系だった独自パスワード認証を撤去し、better-auth に一本化する
// (フロント側の呼び出し・ログインフォームは Phase 3b で対応する)。

export default eventRoutes;

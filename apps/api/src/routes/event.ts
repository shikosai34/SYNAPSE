import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, event, circle, membership } from "@fesflow/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAdminSession, getSession } from "../utils/auth";
import { verifySecret, isLegacyHash, hashSecret } from "../utils/password";
import {
  clientIp,
  isLocked,
  recordFailure,
  clearAttempts,
  lockoutMessage,
} from "../utils/rate-limit";

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

// イベント削除 (論理削除) — システム管理者(super_admin)のみ
eventRoutes.delete("/:id", async (c) => {
  const session = await getAdminSession(c);
  if (!session) {
    return c.json({ error: "管理者権限が必要です" }, 403);
  }

  const id = c.req.param("id");
  // 物理削除せず deletedAt に時刻を書き込む (論理削除)
  await db.update(event).set({ deletedAt: new Date() }).where(eq(event.id, id));
  return c.json({ success: true });
});

// テーマ・基本設定の更新
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
      eventName: z.string().optional(),
      description: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const session = await getAdminSession(c);
    if (!session) {
      return c.json({ error: "管理者権限が必要です" }, 403);
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

    // 2026-07-05 (H4): サークルパスワード総当たり対策。IP バケットと対象(イベント名+サークル名)
    // バケットの双方を見て、どちらかがロック中なら DB 検索/bcrypt 前に 429 で弾く。対象キーは
    // ID 確定前の入力名ベース (存在しない名前の探索=列挙も同じ IP バケットで抑止される)。
    const ip = clientIp(c);
    const ipKey = `circle_login:ip:${ip}`;
    const targetKey = `circle_login:target:${input.eventName.trim().toLowerCase()}::${input.circleName.trim().toLowerCase()}`;
    const keys = [ipKey, targetKey];
    const buckets = [
      { key: ipKey, scope: "circle_login" },
      { key: targetKey, scope: "circle_login" },
    ];

    const retryAfter = await isLocked(keys);
    if (retryAfter > 0) {
      return c.json({ error: lockoutMessage(retryAfter) }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    // 2026-07-06 (M-3): イベント未検出/サークル未検出/パスワード不一致を応答から区別できると
    // イベント名・サークル名の存在有無を列挙されてしまうため、失敗ケースは全て同一のステータス(401)・
    // 同一メッセージに統一する。失敗回数の記録(recordFailure)は各ケースで維持する。
    const INVALID_LOGIN_MESSAGE =
      "イベント名・サークル名・パスワードのいずれかが正しくありません";

    // イベント名でイベントを検索
    // 2026-07-05: 論理削除済みイベントへのログインを防止するためisNull(event.deletedAt)を追加
    const events = await db
      .select()
      .from(event)
      .where(and(eq(event.eventName, input.eventName), isNull(event.deletedAt)));

    if (events.length === 0) {
      await recordFailure(buckets);
      return c.json({ error: INVALID_LOGIN_MESSAGE }, 401);
    }

    const foundEvent = events[0]!;

    // サークル名とイベントIDでサークルを検索
    // 2026-07-05: 論理削除済みサークルへのログインを防止するためisNull(circle.deletedAt)を追加
    const circles = await db
      .select()
      .from(circle)
      .where(
        and(
          eq(circle.eventId, foundEvent.id),
          eq(circle.name, input.circleName),
          isNull(circle.deletedAt)
        )
      );

    if (circles.length === 0) {
      await recordFailure(buckets);
      return c.json({ error: INVALID_LOGIN_MESSAGE }, 401);
    }

    const foundCircle = circles[0]!;

    // パスワードの検証
    // 2026-07-06 (H-1): bcryptjs(saltRounds=4)直接比較を廃止し、PBKDF2/bcrypt両対応の
    // verifySecret に置換 (utils/password.ts)。
    const isPasswordValid = await verifySecret(
      input.password,
      foundCircle.password
    );

    if (!isPasswordValid) {
      await recordFailure(buckets);
      return c.json({ error: INVALID_LOGIN_MESSAGE }, 401);
    }

    // 2026-07-06 (H-1): rehash-on-verify。旧bcryptハッシュで検証成功した場合、
    // 次回以降はPBKDF2で検証できるよう新形式へ再ハッシュして保存する。
    // 失敗してもログイン自体は成功させたいため try/catch で本体処理を巻き込まない。
    if (isLegacyHash(foundCircle.password)) {
      try {
        const rehashed = await hashSecret(input.password);
        await db
          .update(circle)
          .set({ password: rehashed })
          .where(eq(circle.id, foundCircle.id));
      } catch {
        // 再ハッシュ失敗はログを残さず無視する（ログイン成功を優先）
      }
    }

    // 認証成功: 失敗履歴を消去する。
    await clearAttempts(keys);

    return c.json({
      circleId: foundCircle.id,
      circleName: foundCircle.name,
      eventId: foundEvent.id,
      eventName: foundEvent.eventName,
    });
  }
);

export default eventRoutes;

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, circle, event, membership } from "@fesflow/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { getAdminSession, hasPermission } from "../utils/auth";

const circleRoutes = new Hono();

// サークル一覧取得
circleRoutes.get("/", async (c) => {
  const eventId = c.req.query("eventId");

  const query = db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      mods: circle.mods,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerEmail: membership.userEmail,
      managerName: membership.userName,
    })
    .from(circle)
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    );

  if (eventId) {
    const circles = await query.where(eq(circle.eventId, eventId));
    return c.json(circles);
  }

  const circles = await query;
  return c.json(circles);
});

// サークル取得
circleRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const circles = await db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      mods: circle.mods,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerEmail: membership.userEmail,
      managerName: membership.userName,
    })
    .from(circle)
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    )
    .where(eq(circle.id, id));

  if (circles.length === 0) {
    return c.json({ error: "サークルが見つかりません" }, 404);
  }

  return c.json(circles[0]!);
});

// サークル作成
circleRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      eventId: z.string(),
      name: z.string().min(1, "サークル名は必須です"),
      managerPin: z.string().min(4, "一時PINは4文字以上必要です").max(6, "一時PINは6文字以下にしてください").optional(),
      description: z.string().optional(),
      managerEmail: z.string().email("有効なメールアドレスを入力してください"),
      managerName: z.string().optional(),
    })
  ),
  async (c) => {
    const session = await getAdminSession(c);
    if (!session) {
      return c.json({ error: "管理者権限が必要です" }, 403);
    }

    const input = c.req.valid("json");
    const id = nanoid();

    // イベントの存在確認
    const events = await db
      .select()
      .from(event)
      .where(eq(event.id, input.eventId));
    if (events.length === 0) {
      return c.json({ error: "イベントが見つかりません" }, 404);
    }

    // 同じイベント内で同じ名前のサークルがないか確認
    const existingCircles = await db
      .select()
      .from(circle)
      .where(
        and(eq(circle.eventId, input.eventId), eq(circle.name, input.name))
      );

    if (existingCircles.length > 0) {
      return c.json({ error: "同じ名前のサークルが既に存在します" }, 400);
    }

    // 後方互換性のためにランダムなサークルパスワードを生成しハッシュ化
    // 2026-07-04: Cloudflare Workers の CPU 時間制限（最大50ms）超過による 500 エラーを避けるため、
    // ストレッチングコスト（ソルトラウンド）を 10 から 4 に引き下げ。
    const randomPassword = nanoid(16);
    const hashedPassword = await bcrypt.hash(randomPassword, 4);

    // PINをハッシュ化
    let pinHash: string | null = null;
    if (input.managerPin) {
      pinHash = await bcrypt.hash(input.managerPin, 4);
    }

    // サークルと代表者メンバーシップを作成
    // 2026-07-04: Cloudflare D1 は HTTP 経由の対話的トランザクション (BEGIN TRANSACTION) をサポートしておらず、
    // db.transaction() を実行すると "Failed query: begin" エラーで 500 になるため、順次実行に変更。
    await db.insert(circle).values({
      id,
      eventId: input.eventId,
      name: input.name,
      password: hashedPassword,
      description: input.description,
    });

    const membershipId = nanoid();
    await db.insert(membership).values({
      id: membershipId,
      userEmail: input.managerEmail.toLowerCase(), // メールアドレスは小文字で保存
      userName: input.managerName || `${input.name} 代表者`,
      circleId: id,
      role: "circle_manager",
      pin: pinHash,
      isActive: true,
    });

    return c.json({ id }, 201);
  }
);

// サークル更新
circleRoutes.put(
  "/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      managerPin: z.string().min(4).max(6).optional(),
      managerEmail: z.string().email("有効なメールアドレスを入力してください").optional(),
      managerName: z.string().optional(),
    })
  ),
  async (c) => {
    const session = await getAdminSession(c);
    if (!session) {
      return c.json({ error: "管理者権限が必要です" }, 403);
    }

    const id = c.req.param("id");
    const input = c.req.valid("json");

    // 対象サークルの存在確認
    const existingCircle = await db
      .select()
      .from(circle)
      .where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      return c.json({ error: "サークルが見つかりません" }, 404);
    }

    const updates: Partial<typeof circle.$inferSelect> = {};

    if (input.name) updates.name = input.name;
    if (input.description !== undefined)
      updates.description = input.description;

    // PINをハッシュ化
    // 2026-07-04: Cloudflare Workers の CPU 時間制限超過防止のため、ソルトラウンドを 4 に設定。
    let pinHash: string | null = null;
    if (input.managerPin) {
      pinHash = await bcrypt.hash(input.managerPin, 4);
    }

    // サークルと代表者メンバーシップを更新
    // 2026-07-04: D1 の制限回避のため db.transaction を廃止し、順次実行に変更。
    if (Object.keys(updates).length > 0) {
      await db.update(circle).set(updates).where(eq(circle.id, id));
    }

    if (input.managerEmail || pinHash || input.managerName) {
      const managers = await db
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.circleId, id),
            eq(membership.role, "circle_manager")
          )
        );

      const manager = managers[0];
      if (manager) {
        // 既存の代表者を更新
        const setValues: any = {};
        if (input.managerEmail) setValues.userEmail = input.managerEmail.toLowerCase();
        if (input.managerName !== undefined) setValues.userName = input.managerName || manager.userName;
        if (pinHash) setValues.pin = pinHash;

        if (Object.keys(setValues).length > 0) {
          await db
            .update(membership)
            .set(setValues)
            .where(eq(membership.id, manager.id));
        }
      } else {
        // 既存の代表者がいない場合は新規作成
        const currentCircle = existingCircle[0];
        const membershipId = nanoid();
        await db.insert(membership).values({
          id: membershipId,
          userEmail: (input.managerEmail || "").toLowerCase(),
          userName: input.managerName || `${input.name || (currentCircle ? currentCircle.name : "サークル")} 代表者`,
          circleId: id,
          role: "circle_manager",
          pin: pinHash,
          isActive: true,
        });
      }
    }

    return c.json({ success: true });
  }
);

// サークル削除
circleRoutes.delete("/:id", async (c) => {
  const session = await getAdminSession(c);
  if (!session) {
    return c.json({ error: "管理者権限が必要です" }, 403);
  }

  const id = c.req.param("id");
  await db.delete(circle).where(eq(circle.id, id));
  return c.json({ success: true });
});

// サークルの拡張機能（モッド）設定の更新
circleRoutes.patch(
  "/:id/mods",
  zValidator(
    "json",
    z.object({
      mods: z.record(z.string(), z.any()),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { mods } = c.req.valid("json");

    // 該当サークルへの書き込み権限をチェック
    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      return c.json({ error: "権限がありません" }, 403);
    }

    // 対象サークルの存在確認
    const existingCircle = await db
      .select()
      .from(circle)
      .where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      return c.json({ error: "サークルが見つかりません" }, 404);
    }

    // データベースの更新
    await db
      .update(circle)
      .set({
        mods: JSON.stringify(mods),
      })
      .where(eq(circle.id, id));

    return c.json({ success: true });
  }
);

export default circleRoutes;

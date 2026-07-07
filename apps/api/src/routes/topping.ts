import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { db, topping, menuTopping } from "@fesflow/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasPermission } from "../utils/auth";

const toppingRoutes = new Hono();

// トッピング一覧取得
toppingRoutes.get("/", async (c) => {
  const circleId = c.req.query("circleId");

  if (!circleId) {
    apiError("BAD_REQUEST", "circleIdが必要です");
  }

  // 2026-07-05: 認可チェックが皆無だったため追加（専用権限がないためmenu:*を流用）
  if (!(await hasPermission(c, circleId, "menu:read"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  const toppings = await db
    .select()
    .from(topping)
    .where(eq(topping.circleId, circleId));

  return c.json(toppings);
});

// トッピング取得
toppingRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const toppings = await db.select().from(topping).where(eq(topping.id, id));

  if (toppings.length === 0) {
    apiError("NOT_FOUND", "トッピングが見つかりません");
  }

  // 2026-07-05: 認可チェックが皆無だったため追加。対象のcircleIdで判定
  if (!(await hasPermission(c, toppings[0]!.circleId, "menu:read"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  return c.json(toppings[0]);
});

// トッピング作成
toppingRoutes.post(
  "/",
  zBody(
    z.object({
      circleId: z.string(),
      name: z.string().min(1, "トッピング名は必須です"),
      // 価格は負値も許可 (割引トッピング等。2026-07-07 に min(0) を撤廃)。
      price: z.number(),
      description: z.string().optional(),
      imagePath: z.string().optional(),
      soldOut: z.boolean().optional(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

    // 2026-07-05: 認可チェックが皆無だったため追加（専用権限がないためmenu:*を流用）
    if (!(await hasPermission(c, input.circleId, "menu:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const id = nanoid();

    await db.insert(topping).values({
      id,
      circleId: input.circleId,
      name: input.name,
      price: input.price,
      description: input.description,
      imagePath: input.imagePath ?? null,
      soldOut: input.soldOut ?? false,
    });

    return c.json({ id }, 201);
  }
);

// トッピング更新
toppingRoutes.put(
  "/:id",
  zBody(
    z.object({
      name: z.string().min(1).optional(),
      price: z.number().optional(), // 負値許可 (割引トッピング)
      description: z.string().optional(),
      imagePath: z.string().optional(),
      soldOut: z.boolean().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    // 2026-07-05: 認可チェックが皆無だったため追加（単価改ざん防止）。対象のcircleIdを先に取得して判定
    const existingTopping = await db
      .select()
      .from(topping)
      .where(eq(topping.id, id));
    if (existingTopping.length === 0) {
      apiError("NOT_FOUND", "トッピングが見つかりません");
    }

    if (!(await hasPermission(c, existingTopping[0]!.circleId, "menu:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const updates: Partial<typeof topping.$inferSelect> = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.price !== undefined) updates.price = input.price;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.imagePath !== undefined)
      updates.imagePath = input.imagePath ?? null;
    if (input.soldOut !== undefined) updates.soldOut = input.soldOut;

    await db.update(topping).set(updates).where(eq(topping.id, id));

    return c.json({ success: true });
  }
);

// トッピング削除
toppingRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // 2026-07-05: 認可チェックが皆無だったため追加。存在確認の上、対象のcircleIdで判定
  const existingTopping = await db
    .select()
    .from(topping)
    .where(eq(topping.id, id));
  if (existingTopping.length === 0) {
    apiError("NOT_FOUND", "トッピングが見つかりません");
  }

  if (!(await hasPermission(c, existingTopping[0]!.circleId, "menu:delete"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  // 2026-07-05: 関連するmenu_topping中間テーブル行を連動削除（menu.tsの削除実装に準拠）
  await db.delete(menuTopping).where(eq(menuTopping.toppingId, id));

  await db.delete(topping).where(eq(topping.id, id));
  return c.json({ success: true });
});

export default toppingRoutes;

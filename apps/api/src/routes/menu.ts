import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { db, menu, menuTopping, topping } from "@fesflow/db";
import { eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasPermission } from "../utils/auth";

const menuRoutes = new Hono();

// メニュー一覧取得（toppingも含む）
menuRoutes.get("/", async (c) => {
  const circleId = c.req.query("circleId");

  if (!circleId) {
    apiError("BAD_REQUEST", "circleIdが必要です");
  }

  // メニューを取得
  const menus = await db.select().from(menu).where(eq(menu.circleId, circleId));

  // 各メニューのトッピングを取得
  const menuIds = menus.map((m) => m.id);

  if (menuIds.length === 0) {
    return c.json([]);
  }

  const menuToppings = await db
    .select()
    .from(menuTopping)
    .where(inArray(menuTopping.menuId, menuIds));

  const toppingIds = [...new Set(menuToppings.map((mt) => mt.toppingId))];

  const toppings =
    toppingIds.length > 0
      ? await db.select().from(topping).where(inArray(topping.id, toppingIds))
      : [];

  // メニューにトッピング情報を追加
  const menusWithToppings = menus.map((m) => {
    const menuToppingIds = menuToppings
      .filter((mt) => mt.menuId === m.id)
      .map((mt) => mt.toppingId);
    const menuToppingsData = toppings.filter((t) =>
      menuToppingIds.includes(t.id)
    );
    return {
      ...m,
      toppings: menuToppingsData,
    };
  });

  return c.json(menusWithToppings);
});

// メニュー取得
menuRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const menus = await db.select().from(menu).where(eq(menu.id, id));

  if (menus.length === 0) {
    apiError("NOT_FOUND", "メニューが見つかりません");
  }

  const foundMenu = menus[0]!;

  // トッピングを取得
  const menuToppings = await db
    .select()
    .from(menuTopping)
    .where(eq(menuTopping.menuId, id));

  const toppingIds = menuToppings.map((mt) => mt.toppingId);

  const toppings =
    toppingIds.length > 0
      ? await db.select().from(topping).where(inArray(topping.id, toppingIds))
      : [];

  return c.json({
    ...foundMenu,
    toppings,
  });
});

// メニュー作成
menuRoutes.post(
  "/",
  zBody(
    z.object({
      circleId: z.string(),
      name: z.string().min(1, "メニュー名は必須です"),
      // 価格は負値も許可 (割引メニュー等を表現するため。2026-07-07 に min(0) を撤廃)。
      price: z.number(),
      description: z.string().optional(),
      // 画像は任意。未指定でメニュー追加できるようにする (2026-07-06: 画像なしだと
      // imagePath が送られず 400 Bad Request になっていた不具合の修正)。
      imagePath: z.string().optional(),
      additionalInfo: z.string().optional(),
      stockQuantity: z.number().min(0).optional(),
      soldOut: z.boolean().optional(),
      toppingIds: z.array(z.string()).optional(),
      // 既定トッピング (レジで自動適用)
      defaultToppingIds: z.array(z.string()).optional(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

    if (!(await hasPermission(c, input.circleId, "menu:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const id = nanoid();

    await db.insert(menu).values({
      id,
      circleId: input.circleId,
      name: input.name,
      price: input.price,
      description: input.description,
      // image_path は NOT NULL のため未指定時は空文字を入れる (フロントは空=画像なし扱い)
      imagePath: input.imagePath ?? "",
      additionalInfo: input.additionalInfo,
      stockQuantity: input.stockQuantity ?? 0,
      soldOut: input.soldOut ?? false,
      defaultToppingIds: JSON.stringify(input.defaultToppingIds ?? []),
    });

    // トッピングを関連付け
    if (input.toppingIds && input.toppingIds.length > 0) {
      await db.insert(menuTopping).values(
        input.toppingIds.map((toppingId) => ({
          id: nanoid(),
          menuId: id,
          toppingId,
        }))
      );
    }

    return c.json({ id }, 201);
  }
);

// メニュー更新
menuRoutes.put(
  "/:id",
  zBody(
    z.object({
      name: z.string().min(1).optional(),
      price: z.number().optional(), // 負値許可 (割引メニュー)
      description: z.string().optional(),
      imagePath: z.string().optional(),
      additionalInfo: z.string().optional(),
      stockQuantity: z.number().min(0).optional(),
      soldOut: z.boolean().optional(),
      toppingIds: z.array(z.string()).optional(),
      defaultToppingIds: z.array(z.string()).optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    // Get circleId first
    const existingMenu = await db.select().from(menu).where(eq(menu.id, id));
    if (existingMenu.length === 0) apiError("NOT_FOUND", "見つかりません");
    
    if (!(await hasPermission(c, existingMenu[0]!.circleId, "menu:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const updates: Partial<typeof menu.$inferSelect> = {};

    if (input.name !== undefined) updates.name = input.name;
    if (input.price !== undefined) updates.price = input.price;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.imagePath !== undefined) updates.imagePath = input.imagePath;
    if (input.additionalInfo !== undefined)
      updates.additionalInfo = input.additionalInfo;
    if (input.stockQuantity !== undefined)
      updates.stockQuantity = input.stockQuantity;
    if (input.soldOut !== undefined) updates.soldOut = input.soldOut;
    if (input.defaultToppingIds !== undefined)
      updates.defaultToppingIds = JSON.stringify(input.defaultToppingIds);

    if (Object.keys(updates).length > 0) {
      await db.update(menu).set(updates).where(eq(menu.id, id));
    }

    // トッピングの更新
    if (input.toppingIds !== undefined) {
      // 既存のトッピング関連を削除
      await db.delete(menuTopping).where(eq(menuTopping.menuId, id));

      // 新しいトッピング関連を追加
      if (input.toppingIds.length > 0) {
        await db.insert(menuTopping).values(
          input.toppingIds.map((toppingId) => ({
            id: nanoid(),
            menuId: id,
            toppingId,
          }))
        );
      }
    }

    return c.json({ success: true });
  }
);

// メニュー削除
menuRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const existingMenu = await db.select().from(menu).where(eq(menu.id, id));
  if (existingMenu.length === 0) apiError("NOT_FOUND", "見つかりません");
  
  if (!(await hasPermission(c, existingMenu[0]!.circleId, "menu:delete"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  // トッピング関連を削除
  await db.delete(menuTopping).where(eq(menuTopping.menuId, id));

  // メニューを削除
  await db.delete(menu).where(eq(menu.id, id));

  return c.json({ success: true });
});

// 在庫更新
menuRoutes.patch(
  "/:id/stock",
  zBody(
    z.object({
      stockQuantity: z.number().min(0),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const existingMenu = await db.select().from(menu).where(eq(menu.id, id));
    if (existingMenu.length === 0) apiError("NOT_FOUND", "見つかりません");
    
    if (!(await hasPermission(c, existingMenu[0]!.circleId, "stock:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    // 2026-07-06 (L-4): 在庫補充時にsoldOutを戻さない非対称を是正。
    // 注文フロー(order.ts)は在庫が0になるとsoldOut=trueにするため、補充時(stockQuantity>0)は
    // soldOut=falseも併せて更新し「売切」表示を解除する。stockQuantity===0の場合は
    // 0=無制限/未管理の意味も持つ既存挙動を尊重し、soldOutには触れない。
    const stockUpdate: Partial<typeof menu.$inferSelect> = {
      stockQuantity: input.stockQuantity,
    };
    if (input.stockQuantity > 0) {
      stockUpdate.soldOut = false;
    }

    await db.update(menu).set(stockUpdate).where(eq(menu.id, id));

    return c.json({ success: true });
  }
);

export default menuRoutes;

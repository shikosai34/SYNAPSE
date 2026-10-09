import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { menu, menuTopping, topping } from "@fesflow/db";
import { eq, inArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";

const menuRoutes = new Hono<AppEnv>();

// メニュー一覧取得（toppingも含む）
menuRoutes.get("/", async (c) => {
  const db = c.get("db");
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
  const db = c.get("db");
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
      category: z.string().max(100).optional(),
      // 価格は負値も許可 (割引メニュー等を表現するため。2026-07-07 に min(0) を撤廃)。
      price: z.number(),
      description: z.string().optional(),
      // 画像は任意。未指定でメニュー追加できるようにする (2026-07-06: 画像なしだと
      // imagePath が送られず 400 Bad Request になっていた不具合の修正)。
      imagePath: z.string().optional(),
      additionalInfo: z.string().optional(),
      stockQuantity: z.number().min(0).optional(),
      inventoryEnabled: z.boolean().optional(),
      soldOut: z.boolean().optional(),
      toppingIds: z.array(z.string()).optional(),
      // 既定トッピング (レジで自動適用)
      defaultToppingIds: z.array(z.string()).optional(),
      toppingWizardEnabled: z.boolean().optional(),
      toppingCategoryMinimums: z.record(z.string(), z.number().int().min(0).max(20)).optional(),
      toppingCategoryMaximums: z.record(z.string(), z.number().int().min(1).max(20)).optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const input = c.req.valid("json");

    if (!(await hasPermission(c, input.circleId, "menu:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const id = ulid();

    await db.insert(menu).values({
      id,
      circleId: input.circleId,
      name: input.name,
      category: input.category?.trim() ?? "",
      price: input.price,
      description: input.description,
      // image_path は NOT NULL のため未指定時は空文字を入れる (フロントは空=画像なし扱い)
      imagePath: input.imagePath ?? "",
      additionalInfo: input.additionalInfo,
      stockQuantity: input.stockQuantity ?? 0,
      inventoryEnabled: input.inventoryEnabled ?? false,
      soldOut: input.inventoryEnabled === true && (input.stockQuantity ?? 0) <= 0
        ? true
        : input.soldOut ?? false,
      defaultToppingIds: JSON.stringify(input.defaultToppingIds ?? []),
      toppingWizardEnabled: input.toppingWizardEnabled ?? false,
      toppingCategoryMinimums: JSON.stringify(input.toppingCategoryMinimums ?? {}),
      toppingCategoryMaximums: JSON.stringify(input.toppingCategoryMaximums ?? {}),
    });

    // トッピングを関連付け
    if (input.toppingIds && input.toppingIds.length > 0) {
      await db.insert(menuTopping).values(
        input.toppingIds.map((toppingId) => ({
          id: ulid(),
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
      category: z.string().max(100).optional(),
      price: z.number().optional(), // 負値許可 (割引メニュー)
      description: z.string().optional(),
      imagePath: z.string().optional(),
      additionalInfo: z.string().optional(),
      stockQuantity: z.number().min(0).optional(),
      inventoryEnabled: z.boolean().optional(),
      soldOut: z.boolean().optional(),
      toppingIds: z.array(z.string()).optional(),
      defaultToppingIds: z.array(z.string()).optional(),
      toppingWizardEnabled: z.boolean().optional(),
      toppingCategoryMinimums: z.record(z.string(), z.number().int().min(0).max(20)).optional(),
      toppingCategoryMaximums: z.record(z.string(), z.number().int().min(1).max(20)).optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
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
    if (input.category !== undefined) updates.category = input.category.trim();
    if (input.price !== undefined) updates.price = input.price;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.imagePath !== undefined) updates.imagePath = input.imagePath;
    if (input.additionalInfo !== undefined)
      updates.additionalInfo = input.additionalInfo;
    if (input.stockQuantity !== undefined)
      updates.stockQuantity = input.stockQuantity;
    if (input.inventoryEnabled !== undefined)
      updates.inventoryEnabled = input.inventoryEnabled;
    if (input.soldOut !== undefined) updates.soldOut = input.soldOut;
    if (input.defaultToppingIds !== undefined)
      updates.defaultToppingIds = JSON.stringify(input.defaultToppingIds);
    if (input.toppingWizardEnabled !== undefined)
      updates.toppingWizardEnabled = input.toppingWizardEnabled;
    if (input.toppingCategoryMinimums !== undefined)
      updates.toppingCategoryMinimums = JSON.stringify(input.toppingCategoryMinimums);
    if (input.toppingCategoryMaximums !== undefined)
      updates.toppingCategoryMaximums = JSON.stringify(input.toppingCategoryMaximums);

    // 2026-09-27: ON商品は残数0なら必ず売切だが、残数がある場合は運営者の手動売切を
    // 尊重する。管理開始や在庫補充時だけ在庫起因の売切を解除し、説明編集では状態を変えない。
    const inventoryEnabled = input.inventoryEnabled ?? existingMenu[0]!.inventoryEnabled;
    const stockQuantity = input.stockQuantity ?? existingMenu[0]!.stockQuantity;
    if (inventoryEnabled) {
      if (stockQuantity <= 0) {
        updates.soldOut = true;
      } else if (
        (input.inventoryEnabled === true && !existingMenu[0]!.inventoryEnabled) ||
        (input.stockQuantity !== undefined && stockQuantity > existingMenu[0]!.stockQuantity)
      ) {
        updates.soldOut = false;
      }
    } else if (
      input.inventoryEnabled === false &&
      existingMenu[0]!.inventoryEnabled &&
      stockQuantity <= 0
    ) {
      // 2026-09-27: 在庫ONが0個で自動設定した売切は、管理をOFFに戻した時に解除する。
      // 在庫が残っている場合は手動売切の可能性があるため状態を維持する。
      updates.soldOut = false;
    }

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
            id: ulid(),
            menuId: id,
            toppingId,
          }))
        );
      }
    }

    return c.json({ success: true });
  }
);

// 2026-09-27: 在庫管理の開始/停止 (Stock画面からの操作)。在庫を編集できる既存stock:write権限で
// 商品単位のopt-inも行えるよう、メニュー編集権限のない在庫担当者にも専用導線を提供する。
menuRoutes.patch(
  "/:id/inventory",
  zBody(z.object({ inventoryEnabled: z.boolean() })),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const { inventoryEnabled } = c.req.valid("json");
    const existing = await db.select().from(menu).where(eq(menu.id, id));
    if (existing.length === 0) apiError("NOT_FOUND", "見つかりません");
    if (!(await hasPermission(c, existing[0]!.circleId, "stock:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const updates: Partial<typeof menu.$inferSelect> = { inventoryEnabled };
    if (inventoryEnabled && existing[0]!.stockQuantity <= 0) {
      updates.soldOut = true;
    } else if (inventoryEnabled && !existing[0]!.inventoryEnabled) {
      // 2026-09-27: 正数在庫で管理を開始する時だけ初期状態を販売中にする。
      updates.soldOut = false;
    } else if (existing[0]!.inventoryEnabled && existing[0]!.stockQuantity <= 0) {
      // ON中の0在庫からOFFへ戻す時だけ、自動売切を解除する。
      updates.soldOut = false;
    }
    await db.update(menu).set(updates).where(eq(menu.id, id));
    return c.json({ success: true });
  },
);

// メニュー削除
menuRoutes.delete("/:id", async (c) => {
  const db = c.get("db");
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
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const existingMenu = await db.select().from(menu).where(eq(menu.id, id));
    if (existingMenu.length === 0) apiError("NOT_FOUND", "見つかりません");

    if (!(await hasPermission(c, existingMenu[0]!.circleId, "stock:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    // 2026-09-27: ON商品の残数0は売切として可視化し、補充時は表示も自動解除する。
    // OFF商品の既存手動売切状態は在庫数変更で変えない。
    const inventoryEnabled = existingMenu[0]!.inventoryEnabled;
    const stockUpdate: Partial<typeof menu.$inferSelect> = {
      stockQuantity: input.stockQuantity,
    };
    if (inventoryEnabled) {
      stockUpdate.soldOut = input.stockQuantity <= 0;
    } else if (input.stockQuantity > 0) {
      // 2026-07-06 (L-4): 在庫補充時にsoldOutを戻さない非対称を是正。
      // 注文フロー(order.ts)は在庫が0になるとsoldOut=trueにするため、補充時(stockQuantity>0)は
      // soldOut=falseも併せて更新し「売切」表示を解除する。stockQuantity===0の場合は
      // 0=無制限/未管理の意味も持つ既存挙動を尊重し、soldOutには触れない。
      stockUpdate.soldOut = false;
    }

    await db.update(menu).set(stockUpdate).where(eq(menu.id, id));

    return c.json({ success: true });
  }
);

export default menuRoutes;

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  order,
  orderItem,
  orderItemTopping,
  menu,
  topping,
  userStamp,
  circle,
  eventUser,
} from "@fesflow/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasPermission } from "../utils/auth";

const orderRoutes = new Hono();

// 注文番号を生成（サークル内で連番）
async function generateOrderNumber(circleId: string): Promise<string> {
  // 今日の日本時間の開始時刻を取得
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // JST is UTC+9
  const jstNow = new Date(now.getTime() + jstOffset);
  const todayJST = new Date(
    jstNow.getFullYear(),
    jstNow.getMonth(),
    jstNow.getDate()
  );
  const todayUTC = new Date(todayJST.getTime() - jstOffset);

  const todayOrders = await db
    .select({ orderNumber: order.orderNumber })
    .from(order)
    .where(
      and(
        eq(order.circleId, circleId),
        sql`${order.createdAt} >= ${todayUTC.getTime()}`
      )
    );

  const nextNumber = todayOrders.length + 1;
  // サークルID先頭4文字 + 日付 + 連番で一意性を確保
  const dateStr = `${(jstNow.getMonth() + 1)
    .toString()
    .padStart(2, "0")}${jstNow.getDate().toString().padStart(2, "0")}`;
  return `${circleId.slice(0, 4)}-${dateStr}-${String(nextNumber).padStart(
    3,
    "0"
  )}`;
}

// 注文一覧取得
orderRoutes.get("/", async (c) => {
  const circleId = c.req.query("circleId");
  const status = c.req.query("status");

  if (!circleId) {
    return c.json({ error: "circleIdが必要です" }, 400);
  }

  let query = db
    .select()
    .from(order)
    .where(eq(order.circleId, circleId))
    .orderBy(desc(order.createdAt));

  const orders = await query;

  // statusでフィルタリング
  const filteredOrders = status
    ? orders.filter((o) => o.status === status)
    : orders;

  // 各注文のアイテムを取得
  const orderIds = filteredOrders.map((o) => o.id);

  if (orderIds.length === 0) {
    return c.json([]);
  }

  const items = await db
    .select()
    .from(orderItem)
    .where(inArray(orderItem.orderId, orderIds));

  // 注文にアイテムを追加
  const ordersWithItems = filteredOrders.map((o) => ({
    ...o,
    items: items.filter((i) => i.orderId === o.id),
  }));

  return c.json(ordersWithItems);
});

// 注文取得
orderRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const orders = await db.select().from(order).where(eq(order.id, id));

  if (orders.length === 0) {
    return c.json({ error: "注文が見つかりません" }, 404);
  }

  const foundOrder = orders[0]!;

  // アイテムを取得
  const items = await db
    .select()
    .from(orderItem)
    .where(eq(orderItem.orderId, id));

  // 各アイテムのトッピングを取得
  const itemIds = items.map((i) => i.id);
  const itemToppings =
    itemIds.length > 0
      ? await db
          .select()
          .from(orderItemTopping)
          .where(inArray(orderItemTopping.orderItemId, itemIds))
      : [];

  const toppingIds = [...new Set(itemToppings.map((it) => it.toppingId))];
  const toppings =
    toppingIds.length > 0
      ? await db.select().from(topping).where(inArray(topping.id, toppingIds))
      : [];

  // アイテムにトッピングを追加
  const itemsWithToppings = items.map((item) => {
    const itemToppingIds = itemToppings
      .filter((it) => it.orderItemId === item.id)
      .map((it) => it.toppingId);
    const itemToppingsData = toppings.filter((t) =>
      itemToppingIds.includes(t.id)
    );
    return {
      ...item,
      toppings: itemToppingsData,
    };
  });

  return c.json({
    ...foundOrder,
    items: itemsWithToppings,
  });
});

// 注文番号で取得
orderRoutes.get("/by-number/:orderNumber", async (c) => {
  const orderNumber = c.req.param("orderNumber");
  const circleId = c.req.query("circleId");

  if (!circleId) {
    return c.json({ error: "circleIdが必要です" }, 400);
  }

  const orders = await db
    .select()
    .from(order)
    .where(
      and(eq(order.circleId, circleId), eq(order.orderNumber, orderNumber))
    );

  if (orders.length === 0) {
    return c.json({ error: "注文が見つかりません" }, 404);
  }

  return c.json(orders[0]);
});

// 注文作成
orderRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      circleId: z.string(),
      cashierId: z.string().optional(),
      userId: z.string(), // ゲストID (2026-07-04: リストバンド/QR必須化のため必須化)
      peopleCount: z.number().min(1).default(1),
      items: z.array(
        z.object({
          menuId: z.string(),
          quantity: z.number().min(1),
          toppingIds: z.array(z.string()).optional(),
        })
      ),
    })
  ),
  async (c) => {
    try {
      const input = c.req.valid("json");
      const orderId = nanoid();

      // 2026-07-04: D1 の外部キー制約エラー回避のため、必要に応じて eventUser を自動作成する
      const circles = await db
        .select()
        .from(circle)
        .where(eq(circle.id, input.circleId));
      if (circles.length === 0) {
        return c.json({ error: `サークル ${input.circleId} が存在しません` }, 404);
      }
      const eventId = circles[0]!.eventId;

      const existingUser = await db
        .select()
        .from(eventUser)
        .where(eq(eventUser.id, input.userId));
      if (existingUser.length === 0) {
        const newDisplayId = Math.floor(100 + Math.random() * 900);
        await db.insert(eventUser).values({
          id: input.userId,
          eventId: eventId,
          displayId: newDisplayId,
          status: "available",
        });
      }

      // 注文番号を生成
      const orderNumber = await generateOrderNumber(input.circleId);

      // メニューの価格を取得
      const menuIds = input.items.map((i) => i.menuId);
      const menus = await db
        .select()
        .from(menu)
        .where(inArray(menu.id, menuIds));

      // トッピングの価格を取得
      const allToppingIds = input.items.flatMap((i) => i.toppingIds || []);
      const toppings =
        allToppingIds.length > 0
          ? await db
              .select()
              .from(topping)
              .where(inArray(topping.id, allToppingIds))
          : [];

      // 合計金額を計算
      let totalPrice = 0;
      const orderItems: {
        id: string;
        orderId: string;
        menuId: string;
        menuName: string;
        menuPrice: number;
        quantity: number;
        toppingIds?: string[];
      }[] = [];

      for (const item of input.items) {
        const menuItem = menus.find((m) => m.id === item.menuId);
        if (!menuItem) {
          return c.json(
            { error: `メニュー ${item.menuId} が見つかりません` },
            404
          );
        }

        const itemToppings = toppings.filter((t) =>
          (item.toppingIds || []).includes(t.id)
        );
        const toppingTotal = itemToppings.reduce((sum, t) => sum + t.price, 0);
        const unitPrice = menuItem.price + toppingTotal;
        const subtotal = unitPrice * item.quantity;

        orderItems.push({
          id: nanoid(),
          orderId,
          menuId: item.menuId,
          menuName: menuItem.name,
          menuPrice: menuItem.price,
          quantity: item.quantity,
          toppingIds: item.toppingIds,
        });

        totalPrice += subtotal;
      }

      // 注文を作成
      await db.insert(order).values({
        id: orderId,
        circleId: input.circleId,
        cashierId: input.cashierId,
        userId: input.userId, // ゲストIDを保存
        orderNumber,
        peopleCount: input.peopleCount,
        status: "pending",
        totalPrice,
        completed: false,
      });

      // 注文アイテムを作成
      for (const item of orderItems) {
        await db.insert(orderItem).values({
          id: item.id,
          orderId: item.orderId,
          menuId: item.menuId,
          menuName: item.menuName,
          menuPrice: item.menuPrice,
          quantity: item.quantity,
        });

        // トッピングを関連付け
        if (item.toppingIds && item.toppingIds.length > 0) {
          for (const toppingId of item.toppingIds) {
            const toppingItem = toppings.find((t) => t.id === toppingId);
            if (toppingItem) {
              await db.insert(orderItemTopping).values({
                id: nanoid(),
                orderItemId: item.id,
                toppingId,
                toppingName: toppingItem.name,
                toppingPrice: toppingItem.price,
              });
            }
          }
        }
      }

      return c.json({ id: orderId, orderNumber }, 201);
    } catch (error) {
      console.error("Order creation error:", error);
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "注文の作成に失敗しました",
        },
        500
      );
    }
  }
);

// 注文ステータス更新
orderRoutes.patch(
  "/:id/status",
  zValidator(
    "json",
    z.object({
      status: z.enum([
        "pending",
        "preparing",
        "ready",
        "completed",
        "cancelled",
      ]),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const existingOrder = await db.select().from(order).where(eq(order.id, id));
    if (existingOrder.length === 0) return c.json({ error: "見つかりません" }, 404);
    
    const targetOrder = existingOrder[0]!;

    if (!(await hasPermission(c, targetOrder.circleId, "order:write"))) {
      return c.json({ error: "権限がありません" }, 403);
    }

    // pending -> preparing に変わった場合、スタンプを付与
    if (targetOrder.status === "pending" && input.status === "preparing" && targetOrder.userId) {
      // 既にスタンプを獲得しているか確認
      const existingStamp = await db.select().from(userStamp).where(
        and(
          eq(userStamp.userId, targetOrder.userId),
          eq(userStamp.circleId, targetOrder.circleId)
        )
      );

      if (existingStamp.length === 0) {
        await db.insert(userStamp).values({
          id: nanoid(),
          userId: targetOrder.userId,
          circleId: targetOrder.circleId,
        });
      }
    }

    await db
      .update(order)
      .set({ status: input.status })
      .where(eq(order.id, id));

    return c.json({ success: true });
  }
);

// 注文完了
orderRoutes.post("/:id/complete", async (c) => {
  const id = c.req.param("id");

  const existingOrder = await db.select().from(order).where(eq(order.id, id));
  if (existingOrder.length === 0) return c.json({ error: "見つかりません" }, 404);
  
  const targetOrder = existingOrder[0]!;

  if (!(await hasPermission(c, targetOrder.circleId, "order:write"))) {
    return c.json({ error: "権限がありません" }, 403);
  }

  await db
    .update(order)
    .set({ status: "completed", completed: true, completedAt: new Date() })
    .where(eq(order.id, id));

  return c.json({ success: true });
});

// 予想待ち時間設定
orderRoutes.patch(
  "/:id/estimated-time",
  zValidator(
    "json",
    z.object({
      estimatedTime: z.number().min(0),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const existingOrder = await db.select().from(order).where(eq(order.id, id));
    if (existingOrder.length === 0) return c.json({ error: "見つかりません" }, 404);
    
    const targetOrder = existingOrder[0]!;

    if (!(await hasPermission(c, targetOrder.circleId, "order:write"))) {
      return c.json({ error: "権限がありません" }, 403);
    }

    await db
      .update(order)
      .set({ estimatedTime: input.estimatedTime })
      .where(eq(order.id, id));

    return c.json({ success: true });
  }
);

// 売上統計
orderRoutes.get("/stats/sales", async (c) => {
  const circleId = c.req.query("circleId");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");

  if (!circleId) {
    return c.json({ error: "circleIdが必要です" }, 400);
  }

  if (!(await hasPermission(c, circleId, "sales:read"))) {
    return c.json({ error: "権限がありません" }, 403);
  }

  let query = db
    .select()
    .from(order)
    .where(and(eq(order.circleId, circleId), eq(order.status, "completed")));

  const orders = await query;

  // 日付でフィルタリング
  let filteredOrders = orders;
  if (dateFrom) {
    const from = new Date(dateFrom);
    filteredOrders = filteredOrders.filter(
      (o) => new Date(o.createdAt!) >= from
    );
  }
  if (dateTo) {
    const to = new Date(dateTo);
    filteredOrders = filteredOrders.filter((o) => new Date(o.createdAt!) <= to);
  }

  const totalSales = filteredOrders.reduce(
    (sum, o) => sum + (o.totalPrice || 0),
    0
  );
  const totalOrders = filteredOrders.length;
  const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  return c.json({
    totalSales,
    totalOrders,
    averageOrderValue,
  });
});

export default orderRoutes;

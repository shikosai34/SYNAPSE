import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  db,
  preOrder,
  preOrderItem,
  order,
  orderItem,
  menu,
  wristband,
  eventUser,
  userStamp,
  circle,
} from "@fesflow/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

const preOrderRoutes = new Hono();

// 注文番号生成関数 (order.ts と同様の処理)
async function generateOrderNumber(circleId: string): Promise<string> {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
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
  const dateStr = `${(jstNow.getMonth() + 1)
    .toString()
    .padStart(2, "0")}${jstNow.getDate().toString().padStart(2, "0")}`;
  return `${circleId.slice(0, 4)}-${dateStr}-${String(nextNumber).padStart(
    3,
    "0"
  )}`;
}

// 事前オーダー作成 (ユーザー端末側)
preOrderRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      userId: z.string(),
      circleId: z.string(),
      items: z.array(
        z.object({
          menuId: z.string(),
          quantity: z.number().min(1).default(1),
        })
      ),
    })
  ),
  async (c) => {
    try {
      const { userId, circleId, items } = c.req.valid("json");
      const preOrderId = nanoid();

      // 2026-07-04: 新規スマホユーザーの外部キーエラー回避のため、サークルの eventId を取得し、
      // 必要に応じて eventUser を自動シード挿入する。
      const circles = await db
        .select()
        .from(circle)
        .where(eq(circle.id, circleId));
      if (circles.length === 0) {
        return c.json({ error: `サークル ${circleId} が存在しません` }, 404);
      }
      const eventId = circles[0]!.eventId;

      const existingUser = await db
        .select()
        .from(eventUser)
        .where(eq(eventUser.id, userId));

      if (existingUser.length === 0) {
        const newDisplayId = Math.floor(100 + Math.random() * 900);
        await db.insert(eventUser).values({
          id: userId,
          eventId: eventId,
          displayId: newDisplayId,
          status: "available",
        });
      }

      // メニュー取得
      const menuIds = items.map((i) => i.menuId);
      const menus = await db
        .select()
        .from(menu)
        .where(inArray(menu.id, menuIds));

      let totalPrice = 0;
      const itemList: { id: string; menuId: string; quantity: number }[] = [];

      for (const item of items) {
        const m = menus.find((menuItem) => menuItem.id === item.menuId);
        if (!m) {
          return c.json({ error: `メニュー ${item.menuId} が存在しません` }, 404);
        }
        totalPrice += m.price * item.quantity;
        itemList.push({
          id: nanoid(),
          menuId: item.menuId,
          quantity: item.quantity,
        });
      }

      // 事前オーダー挿入
      await db.insert(preOrder).values({
        id: preOrderId,
        userId,
        circleId,
        totalPrice,
        status: "pending",
      });

      // 事前オーダーアイテム挿入
      for (const item of itemList) {
        await db.insert(preOrderItem).values({
          id: item.id,
          preOrderId,
          menuId: item.menuId,
          quantity: item.quantity,
        });
      }

      return c.json({ id: preOrderId, totalPrice }, 201);
    } catch (error) {
      console.error("PreOrder creation error:", error);
      return c.json({ error: "事前オーダーの作成に失敗しました" }, 500);
    }
  }
);

// コード (リストバンドIDまたはユーザーID) から該当する未受取事前オーダーを取得
preOrderRoutes.get("/user/:code", async (c) => {
  const code = c.req.param("code");
  const circleId = c.req.query("circleId");

  // 1. ユーザーIDの特定
  let targetUserId: string | null = null;

  const wbs = await db.select().from(wristband).where(eq(wristband.id, code));
  if (wbs.length > 0) {
    targetUserId = wbs[0]!.userId;
  } else {
    const users = await db.select().from(eventUser).where(eq(eventUser.id, code));
    if (users.length > 0) {
      targetUserId = users[0]!.id;
    }
  }

  if (!targetUserId) {
    return c.json([]);
  }


  // 2. pending 状態の事前オーダーを取得
  let conditions = [
    eq(preOrder.userId, targetUserId),
    eq(preOrder.status, "pending"),
  ];
  if (circleId) {
    conditions.push(eq(preOrder.circleId, circleId));
  }

  const preOrders = await db
    .select()
    .from(preOrder)
    .where(and(...conditions))
    .orderBy(desc(preOrder.createdAt));

  if (preOrders.length === 0) {
    return c.json([]);
  }

  // アイテム詳細の紐付け
  const preOrderIds = preOrders.map((po) => po.id);
  const items = await db
    .select()
    .from(preOrderItem)
    .where(inArray(preOrderItem.preOrderId, preOrderIds));

  const menuIds = [...new Set(items.map((i) => i.menuId))];
  const menus =
    menuIds.length > 0
      ? await db.select().from(menu).where(inArray(menu.id, menuIds))
      : [];

  const result = preOrders.map((po) => ({
    ...po,
    items: items
      .filter((i) => i.preOrderId === po.id)
      .map((i) => ({
        ...i,
        menu: menus.find((m) => m.id === i.menuId),
      })),
  }));

  return c.json(result);
});

// 店頭レジでの確定処理 (正規注文への引き継ぎ)
preOrderRoutes.post(
  "/:id/claim",
  zValidator(
    "json",
    z.object({
      cashierId: z.string().optional(),
    })
  ),
  async (c) => {
    try {
      const id = c.req.param("id");
      const { cashierId } = c.req.valid("json");

      const pos = await db.select().from(preOrder).where(eq(preOrder.id, id));
      if (pos.length === 0) {
        return c.json({ error: "事前オーダーが見つかりません" }, 404);
      }
      const po = pos[0]!;

      if (po.status !== "pending") {
        return c.json({ error: "この事前オーダーは既に処理されているかキャンセルされています" }, 400);
      }

      // アイテム取得
      const items = await db
        .select()
        .from(preOrderItem)
        .where(eq(preOrderItem.preOrderId, po.id));

      const menuIds = items.map((i) => i.menuId);
      const menus = await db
        .select()
        .from(menu)
        .where(inArray(menu.id, menuIds));

      // 正規注文を作成
      const newOrderId = nanoid();
      const orderNumber = await generateOrderNumber(po.circleId);

      await db.insert(order).values({
        id: newOrderId,
        circleId: po.circleId,
        cashierId,
        userId: po.userId,
        orderNumber,
        peopleCount: 1,
        totalPrice: po.totalPrice,
        status: "preparing", // 受取確定と同時に調理開始
        completed: false,
      });

      // 注文アイテムを作成
      for (const item of items) {
        const m = menus.find((menuItem) => menuItem.id === item.menuId);
        if (m) {
          await db.insert(orderItem).values({
            id: nanoid(),
            orderId: newOrderId,
            menuId: m.id,
            menuName: m.name,
            menuPrice: m.price,
            quantity: item.quantity,
          });
        }
      }

      // 事前オーダーのステータス更新
      await db
        .update(preOrder)
        .set({ status: "completed" })
        .where(eq(preOrder.id, po.id));

      // スタンプ付与
      if (po.userId) {
        const existingStamp = await db.select().from(userStamp).where(
          and(
            eq(userStamp.userId, po.userId),
            eq(userStamp.circleId, po.circleId)
          )
        );
        if (existingStamp.length === 0) {
          await db.insert(userStamp).values({
            id: nanoid(),
            userId: po.userId,
            circleId: po.circleId,
          });
        }
      }

      return c.json({ success: true, orderId: newOrderId, orderNumber });
    } catch (error) {
      console.error("PreOrder claim error:", error);
      return c.json({ error: "受取確定処理に失敗しました" }, 500);
    }
  }
);

export default preOrderRoutes;

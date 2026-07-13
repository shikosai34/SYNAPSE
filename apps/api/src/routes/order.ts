import { Hono } from "hono";
import { zBody } from "../z-validator";
import { AppError, apiError } from "../http-error";
import { z } from "zod";
import {
  order,
  orderItem,
  orderItemTopping,
  menu,
  menuTopping,
  topping,
  userStamp,
  circle,
  eventUser,
  type DB,
} from "@fesflow/db";
import { eq, and, desc, sql, inArray, gte } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";

const orderRoutes = new Hono<AppEnv>();

// 2026-07-05: 注文ステータスの許可された遷移表。
// completed/cancelled は終端状態でありそこからの遷移は禁止する。
// 任意の非終端状態から cancelled へは遷移可能。
const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ["preparing", "ready", "completed", "cancelled"],
  preparing: ["ready", "completed", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

// 注文番号を生成（サークル内で連番）
// 2026-07-08 (Phase5): db をモジュール Proxy ではなく引数で受け取る (Context を持たない
// トップレベル関数のため、計画通り db を明示的な引数にした)。
async function generateOrderNumber(db: DB, circleId: string): Promise<string> {
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
  const db = c.get("db");
  const circleId = c.req.query("circleId");
  const status = c.req.query("status");

  if (!circleId) {
    apiError("BAD_REQUEST", "circleIdが必要です");
  }

  // 2026-07-05: 一覧は他サークルの注文状況・売上動向が漏洩しうるためスタッフ権限必須にする
  // (register の Sales/Backyard/EventDashboard のみが利用しており来場者導線では使われていない)
  if (!(await hasPermission(c, circleId, "order:read"))) {
    apiError("FORBIDDEN", "権限がありません");
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
  const db = c.get("db");
  const id = c.req.param("id");

  const orders = await db.select().from(order).where(eq(order.id, id));

  if (orders.length === 0) {
    apiError("NOT_FOUND", "注文が見つかりません");
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

  // 2026-07-05: このエンドポイントは来場者(apps/visitor の MyPage)が自分の注文IDで
  // ポーリングするため無認可のまま維持するが、cashierId 等スタッフ向けの内部情報は
  // 最小化のため除外する（注文IDを知る者に限定される設計を前提に情報漏洩を抑える）。
  const { cashierId: _cashierId, ...safeOrder } = foundOrder;

  return c.json({
    ...safeOrder,
    items: itemsWithToppings,
  });
});

// 注文番号で取得
orderRoutes.get("/by-number/:orderNumber", async (c) => {
  const db = c.get("db");
  const orderNumber = c.req.param("orderNumber");
  const circleId = c.req.query("circleId");

  if (!circleId) {
    apiError("BAD_REQUEST", "circleIdが必要です");
  }

  // 2026-07-05: フロント確認の結果、register/visitor いずれにも呼び出し箇所が無く
  // レジ導線専用のルックアップ（注文番号+circleId指定）であるため order:read を必須化する。
  if (!(await hasPermission(c, circleId, "order:read"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  const orders = await db
    .select()
    .from(order)
    .where(
      and(eq(order.circleId, circleId), eq(order.orderNumber, orderNumber))
    );

  if (orders.length === 0) {
    apiError("NOT_FOUND", "注文が見つかりません");
  }

  return c.json(orders[0]);
});

// 注文作成
orderRoutes.post(
  "/",
  zBody(
    z.object({
      circleId: z.string(),
      cashierId: z.string().optional(),
      userId: z.string(), // ゲストID (2026-07-04: リストバンド/QR必須化のため必須化)
      peopleCount: z.number().min(1).default(1),
      // 支払い方法 (2026-07-12): レジで選択された方法。省略時はサークルの対応方法が
      // 1つならサーバが補完する (単一方法はレジで選択させないため)。
      paymentMethod: z.string().max(30).optional(),
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
    const db = c.get("db");
    try {
      const input = c.req.valid("json");
      const orderId = ulid();

      // 2026-07-04: D1 の外部キー制約エラー回避のため、必要に応じて eventUser を自動作成する
      const circles = await db
        .select()
        .from(circle)
        .where(eq(circle.id, input.circleId));
      if (circles.length === 0) {
        apiError("NOT_FOUND", `サークル ${input.circleId} が存在しません`);
      }
      const eventId = circles[0]!.eventId;

      // サークル設定から注文モードを解決する。
      //   "pending"    : 未着手で受付 (既定・従来挙動、厨房が調理開始→完成)
      //   "preparing"  : 最初から調理中として受付
      //   "completed"  : 受付と同時に即完成 (厨房を経由しない模擬店向け)
      let orderFlowMode: "pending" | "preparing" | "completed" = "pending";
      try {
        const parsed = JSON.parse(circles[0]!.settings || "{}");
        if (
          parsed?.orderFlowMode === "preparing" ||
          parsed?.orderFlowMode === "completed"
        ) {
          orderFlowMode = parsed.orderFlowMode;
        }
      } catch (_) {
        // 設定が壊れていても既定(pending)で継続する
      }

      const existingUser = await db
        .select()
        .from(eventUser)
        .where(eq(eventUser.id, input.userId));
      if (existingUser.length === 0) {
        // 2026-07-06: 「発行しないと使えない」方針。任意の userId から eventUser を
        // 自動作成する経路(自己発行の抜け穴)を撤去。正規の来場者IDは受付での発行
        // (POST /wristbands/issue) か物理バンドのスキャン(lookup)でのみ得られる。
        // 未発行の userId での注文は拒否する。
        apiError(
          "FORBIDDEN",
          "リストバンドが発行されていません。受付でリストバンドの発行を受けるか、店頭でスタッフにお申し付けください。",
        );
      } else if (existingUser[0]!.eventId !== eventId) {
        // 2026-07-06: クロスイベント混入対策 (H-3, ベストエフォート)。
        // userId は認証を伴わないベアラー値のため、既存の userId を任意に指定して
        // 他人へのなりすましスタンプ付与/抽選不正を狙える。完全な防止にはセッションが
        // 必要でありスコープ外だが、最低限「他イベントの userId を注文に使う」経路は
        // ここで塞ぐ。同一イベント内でのなりすましは本対応では防げない(残存リスク)。
        apiError("BAD_REQUEST", "ユーザーとサークルのイベントが一致しません");
      }

      // 注文番号を生成
      const orderNumber = await generateOrderNumber(db, input.circleId);

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

      // 2026-07-05: 指定トッピングが対象メニューに実際に紐付いているかを検証するため
      // menu_topping の関連を取得しておく
      const menuToppingLinks =
        allToppingIds.length > 0
          ? await db
              .select()
              .from(menuTopping)
              .where(inArray(menuTopping.menuId, menuIds))
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
      // 在庫管理対象(stockQuantity > 0)のメニューごとの必要数を集計する
      const stockNeeded = new Map<string, number>();

      for (const item of input.items) {
        const menuItem = menus.find((m) => m.id === item.menuId);
        if (!menuItem) {
          apiError("NOT_FOUND", `メニュー ${item.menuId} が見つかりません`);
        }

        // 2026-07-05: クロスサークルIDOR対策。他サークルのメニューが混入していないか検証する
        if (menuItem.circleId !== input.circleId) {
          apiError("BAD_REQUEST", `メニュー ${menuItem.name} は指定サークルに属していません`);
        }

        // 2026-07-05: 売り切れメニューの注文をハードゲートで拒否する
        if (menuItem.soldOut) {
          apiError("BAD_REQUEST", `${menuItem.name}は売り切れです`);
        }

        const itemToppings = toppings.filter((t) =>
          (item.toppingIds || []).includes(t.id)
        );

        // 指定トッピングIDがすべて解決できているか（存在確認）
        if (itemToppings.length !== (item.toppingIds || []).length) {
          apiError("BAD_REQUEST", "存在しないトッピングが指定されています");
        }

        for (const t of itemToppings) {
          // クロスサークルIDOR対策
          if (t.circleId !== input.circleId) {
            apiError("BAD_REQUEST", `トッピング ${t.name} は指定サークルに属していません`);
          }
          // 売り切れトッピングの拒否
          if (t.soldOut) {
            apiError("BAD_REQUEST", `${t.name}は売り切れです`);
          }
          // 対象メニューに実際に紐付いているか確認
          const isLinked = menuToppingLinks.some(
            (mt) => mt.menuId === menuItem.id && mt.toppingId === t.id
          );
          if (!isLinked) {
            apiError("BAD_REQUEST", `トッピング ${t.name} はメニュー ${menuItem.name} に紐付いていません`);
          }
        }

        // 2026-07-05: 在庫が管理されているメニュー(stockQuantity > 0)のみ在庫チェック対象とする。
        // stockQuantity === 0 は在庫無制限/未管理を意味し、チェック・減算をスキップする。
        if (menuItem.stockQuantity > 0) {
          const alreadyNeeded = stockNeeded.get(menuItem.id) || 0;
          const totalNeeded = alreadyNeeded + item.quantity;
          stockNeeded.set(menuItem.id, totalNeeded);

          if (menuItem.stockQuantity < totalNeeded) {
            apiError("BAD_REQUEST", `${menuItem.name}の在庫が不足しています`);
          }
        }

        const toppingTotal = itemToppings.reduce((sum, t) => sum + t.price, 0);
        const unitPrice = menuItem.price + toppingTotal;
        const subtotal = unitPrice * item.quantity;

        orderItems.push({
          id: ulid(),
          orderId,
          menuId: item.menuId,
          menuName: menuItem.name,
          menuPrice: menuItem.price,
          quantity: item.quantity,
          toppingIds: item.toppingIds,
        });

        totalPrice += subtotal;
      }

      // 2026-07-13 (D1トランザクション対応): D1のトランザクションが機能するため、
      // 以下の在庫減算、注文作成、アイテム/トッピング挿入、スタンプ付与の全クエリを
      // db.transaction 内でアトミックに実行します。
      // エラー時は自動でロールバックされるため、ベストエフォートな在庫戻し処理は不要になりました。
      let resolvedPayment: string | undefined = input.paymentMethod?.trim() || undefined;
      if (!resolvedPayment) {
        try {
          const parsed = JSON.parse(circles[0]!.settings || "{}");
          const accepted: unknown = parsed?.acceptedPayments;
          if (Array.isArray(accepted) && accepted.length === 1 && typeof accepted[0] === "string") {
            resolvedPayment = accepted[0];
          }
        } catch {
          /* settings が壊れていても注文は通す */
        }
      }

      await db.transaction(async (tx) => {
        // 1. 在庫管理メニューの在庫をガード付きUPDATEで減算する
        for (const [menuId, neededQty] of stockNeeded.entries()) {
          const result = await tx
            .update(menu)
            .set({
              stockQuantity: sql`${menu.stockQuantity} - ${neededQty}`,
            })
            .where(and(eq(menu.id, menuId), gte(menu.stockQuantity, neededQty)))
            .returning({ stockQuantity: menu.stockQuantity });

          if (result.length === 0) {
            const menuItem = menus.find((m) => m.id === menuId);
            apiError("BAD_REQUEST", `${menuItem?.name ?? menuId}の在庫が不足しています`);
          }

          // 減算の結果 在庫が0になった場合は soldOut も併せてセットする
          if (result[0]!.stockQuantity <= 0) {
            await tx
              .update(menu)
              .set({ soldOut: true })
              .where(eq(menu.id, menuId));
          }
        }

        // 2. 注文を作成 (注文モードに応じて初期ステータスを決定)
        const isDirectComplete = orderFlowMode === "completed";
        await tx.insert(order).values({
          id: orderId,
          circleId: input.circleId,
          cashierId: input.cashierId,
          userId: input.userId, // ゲストIDを保存
          orderNumber,
          peopleCount: input.peopleCount,
          status: orderFlowMode,
          totalPrice,
          paymentMethod: resolvedPayment,
          completed: isDirectComplete,
          completedAt: isDirectComplete ? new Date() : undefined,
        });

        // 3. 未着手以外(調理中/即完成)で受け付けた場合、この時点でスタンプを付与する。
        if (orderFlowMode !== "pending" && input.userId) {
          const existingStamp = await tx
            .select()
            .from(userStamp)
            .where(
              and(
                eq(userStamp.userId, input.userId),
                eq(userStamp.circleId, input.circleId)
              )
            );
          if (existingStamp.length === 0) {
            await tx.insert(userStamp).values({
              id: ulid(),
              userId: input.userId,
              circleId: input.circleId,
            });
          }
        }

        // 4. 注文アイテムを作成
        for (const item of orderItems) {
          await tx.insert(orderItem).values({
            id: item.id,
            orderId: item.orderId,
            menuId: item.menuId,
            menuName: item.menuName,
            menuPrice: item.menuPrice,
            quantity: item.quantity,
          });

          // 5. トッピングを関連付け
          if (item.toppingIds && item.toppingIds.length > 0) {
            for (const toppingId of item.toppingIds) {
              const toppingItem = toppings.find((t) => t.id === toppingId);
              if (toppingItem) {
                await tx.insert(orderItemTopping).values({
                  id: ulid(),
                  orderItemId: item.id,
                  toppingId,
                  toppingName: toppingItem.name,
                  toppingPrice: toppingItem.price,
                });
              }
            }
          }
        }
      });

      return c.json({ id: orderId, orderNumber }, 201);
    } catch (error) {
      // Phase4: apiError/AppError による意図的な 4xx (NOT_FOUND/BAD_REQUEST/FORBIDDEN 等) を
      // ここで握りつぶして 500 に丸めないよう、AppError はそのまま再 throw して onError に委ねる。
      if (error instanceof AppError) throw error;
      console.error("Order creation error:", error);
      apiError("INTERNAL", "注文の作成に失敗しました");
    }
  }
);

// 注文ステータス更新
orderRoutes.patch(
  "/:id/status",
  zBody(
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
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const existingOrder = await db.select().from(order).where(eq(order.id, id));
    if (existingOrder.length === 0) apiError("NOT_FOUND", "見つかりません");

    const targetOrder = existingOrder[0]!;

    if (!(await hasPermission(c, targetOrder.circleId, "order:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    // 2026-07-05: 不正なステータス遷移を禁止する（completed/cancelled は終端状態で、そこからの遷移不可）
    const allowedNextStatuses = ORDER_STATUS_TRANSITIONS[targetOrder.status] ?? [];
    if (
      targetOrder.status !== input.status &&
      !allowedNextStatuses.includes(input.status)
    ) {
      apiError("BAD_REQUEST", `${targetOrder.status} から ${input.status} への変更はできません`);
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
          id: ulid(),
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
  const db = c.get("db");
  const id = c.req.param("id");

  const existingOrder = await db.select().from(order).where(eq(order.id, id));
  if (existingOrder.length === 0) apiError("NOT_FOUND", "見つかりません");
  
  const targetOrder = existingOrder[0]!;

  if (!(await hasPermission(c, targetOrder.circleId, "order:write"))) {
    apiError("FORBIDDEN", "権限がありません");
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
  zBody(
    z.object({
      estimatedTime: z.number().min(0),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const existingOrder = await db.select().from(order).where(eq(order.id, id));
    if (existingOrder.length === 0) apiError("NOT_FOUND", "見つかりません");

    const targetOrder = existingOrder[0]!;

    if (!(await hasPermission(c, targetOrder.circleId, "order:write"))) {
      apiError("FORBIDDEN", "権限がありません");
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
  const db = c.get("db");
  const circleId = c.req.query("circleId");
  const dateFrom = c.req.query("dateFrom");
  const dateTo = c.req.query("dateTo");

  if (!circleId) {
    apiError("BAD_REQUEST", "circleIdが必要です");
  }

  if (!(await hasPermission(c, circleId, "sales:read"))) {
    apiError("FORBIDDEN", "権限がありません");
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

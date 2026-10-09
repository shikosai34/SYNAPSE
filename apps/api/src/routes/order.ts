import { Hono } from "hono";
import { zBody } from "../z-validator";
import { AppError, apiError } from "../http-error";
import { z } from "zod";
import { createOrderSchema, type CreateOrderResult } from "@fesflow/config/order-contract";
import {
  order,
  orderItem,
  orderItemTopping,
  menu,
  menuTopping,
  topping,
  circle,
  event,
  eventUser,
  wristband,
  orderCommit,
} from "@fesflow/db";
import { eq, and, or, desc, inArray, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import { commitOrder, committedOrder, orderCommand } from "../services/order-commit";
import { updateOrderStatus } from "../services/order-status";
import { validateToppingCategorySelection } from "../utils/topping-wizard";
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

  // 2026-10-03 (#22): 状態で厨房が絞り込む注文を、配列化前にD1で限定する。
  const query = db
    .select()
    .from(order)
    .where(status
      ? and(eq(order.circleId, circleId), eq(order.status, status))
      : eq(order.circleId, circleId))
    .orderBy(desc(order.createdAt));

  const orders = await query;

  // 各注文のアイテムを取得
  const orderIds = orders.map((o) => o.id);

  if (orderIds.length === 0) {
    return c.json([]);
  }

  const items = await db
    .select()
    .from(orderItem)
    // 2026-10-08: 副問い合わせをINの括弧内に置く。DrizzleのinArrayへSQL断片を渡すと括弧が補われず構文エラーになる。
    .where(sql`${orderItem.orderId} IN (SELECT value FROM json_each(${JSON.stringify(orderIds)}))`);

  const itemIds = items.map((i) => i.id);
  const allItemToppings = itemIds.length > 0
    ? await db
        .select()
        .from(orderItemTopping)
        .where(sql`${orderItemTopping.orderItemId} IN (SELECT value FROM json_each(${JSON.stringify(itemIds)}))`)
    : [];

  // 注文にアイテムを追加
  const toppingsByItem = new Map<string, typeof allItemToppings>();
  for (const itemTopping of allItemToppings) {
    const list = toppingsByItem.get(itemTopping.orderItemId) ?? [];
    list.push(itemTopping);
    toppingsByItem.set(itemTopping.orderItemId, list);
  }
  const itemsByOrder = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }
  const ordersWithItems = orders.map((o) => ({
    ...o,
    items: (itemsByOrder.get(o.id) ?? []).map((item) => ({
      ...item,
      toppings: (toppingsByItem.get(item.id) ?? [])
        .map((t) => ({
          ...t,
          name: t.toppingName,
          price: t.toppingPrice,
        })),
    })),
  }));

  return c.json(ordersWithItems);
});

// 来場者本人の注文履歴 (レジを通った注文) を取得
// 2026-07-13: 来場者アプリの注文履歴画面から、自分がレジを通した過去注文を参照するため新設。
// - userId 解決は pre-orders/user/:code と同一 (リストバンドID or eventUser.id をベアラーとして受ける)。
//   来場者導線を壊さないため hasPermission による認可は課さない (QR/リストバンドの保持自体が
//   実質的な認証で、応答も本人の注文に限定される)。
// - ただし order には cashierId / paymentMethod 等のレジ内部情報が含まれるため、
//   来場者へは注文本人が必要とする項目のみを明示的に返し、内部情報は最小化する。
// - まだレジを通していない事前注文 (pending) は /api/pre-orders/user/:code 側で取得する。
orderRoutes.get("/user/:code", async (c) => {
  const db = c.get("db");
  const code = c.req.param("code");

  // 1. userId の特定 (pre_order.ts の /user/:code と同一ロジック)
  let targetUserId: string | null = null;
  const wbs = await db
    .select()
    .from(wristband)
    .where(
      and(
        eq(wristband.id, code),
        or(eq(wristband.status, "active"), eq(wristband.status, "smartphone"))
      )
    );
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

  // 2. 当該ユーザーの注文を新しい順に取得
  const orders = await db
    .select()
    .from(order)
    .where(eq(order.userId, targetUserId))
    .orderBy(desc(order.createdAt));

  if (orders.length === 0) {
    return c.json([]);
  }

  // 3. アイテム / トッピング(スナップショット) / サークル名を紐付け
  const orderIds = orders.map((o) => o.id);
  const items = await db
    .select()
    .from(orderItem)
    .where(inArray(orderItem.orderId, orderIds));

  const itemIds = items.map((i) => i.id);
  const itemToppings =
    itemIds.length > 0
      ? await db
          .select()
          .from(orderItemTopping)
          .where(inArray(orderItemTopping.orderItemId, itemIds))
      : [];

  const circleIds = [...new Set(orders.map((o) => o.circleId))];
  const circles =
    circleIds.length > 0
      ? await db.select().from(circle).where(inArray(circle.id, circleIds))
      : [];

  // cashierId / paymentMethod / updatedAt 等の内部情報は含めず、本人向けの項目のみ返す。
  const result = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    totalPrice: o.totalPrice,
    peopleCount: o.peopleCount,
    circleId: o.circleId,
    circleName: circles.find((ci) => ci.id === o.circleId)?.name ?? null,
    createdAt: o.createdAt,
    completedAt: o.completedAt,
    estimatedTime: o.estimatedTime,
    items: items
      .filter((i) => i.orderId === o.id)
      .map((i) => ({
        id: i.id,
        menuId: i.menuId,
        menuName: i.menuName,
        menuPrice: i.menuPrice,
        quantity: i.quantity,
        toppings: itemToppings
          .filter((it) => it.orderItemId === i.id)
          .map((it) => ({
            id: it.toppingId,
            name: it.toppingName,
            price: it.toppingPrice,
          })),
      })),
  }));

  return c.json(result);
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
  zBody(createOrderSchema),
  async (c) => {
    const db = c.get("db");
    try {
      const input = c.req.valid("json");
      const orderId = ulid();
      // 2026-10-03: 再送結果は在庫/価格の再検証前に返し、成功後のレスポンス紛失にも対応する。
      const command = await orderCommand(`pos:${input.circleId}:${input.userId}`, c.req.header("Idempotency-Key"), input);

      // 2026-10-03: 再送照会と注文コンテキストを1つのJOINにまとめ、D1の直列readを1回減らす。
      // 保存済み注文は再検証より先に返す。サークル削除後の再送だけは下のfallback照会で維持する。
      const contextRows = await db
        .select({
          circle: { id: circle.id, eventId: circle.eventId, settings: circle.settings },
          event: {
            id: event.id,
            deletedAt: event.deletedAt,
            billingStatus: event.billingStatus,
            lifecycleStatus: event.lifecycleStatus,
            endDate: event.endDate,
          },
          user: { id: eventUser.id, eventId: eventUser.eventId, status: eventUser.status },
          committed: { id: order.id, orderNumber: order.orderNumber, fingerprint: orderCommit.fingerprint },
        })
        .from(circle)
        .leftJoin(event, eq(event.id, circle.eventId))
        .leftJoin(eventUser, eq(eventUser.id, input.userId))
        .leftJoin(orderCommit, eq(orderCommit.key, command.key))
        .leftJoin(order, eq(order.id, orderCommit.orderId))
        .where(eq(circle.id, input.circleId))
        .limit(1);
      if (contextRows.length === 0) {
        const saved = await committedOrder(c.env.DB, command);
        if (saved) return c.json(saved, 201);
        apiError("NOT_FOUND", `サークル ${input.circleId} が存在しません`);
      }
      const context = contextRows[0]!;
      if (context.committed?.id) {
        if (context.committed.fingerprint !== command.fingerprint) {
          apiError("CONFLICT", "同じ注文キーで内容を変更することはできません");
        }
        return c.json({ id: context.committed.id, orderNumber: context.committed.orderNumber }, 201);
      }
      const eventId = context.circle.eventId;

      // 開催状態・利用停止・来場者BANは同じJOIN結果で確認し、いずれも注文確定時にも再検証する。
      const eventRow = context.event;
      if (!eventRow?.id || eventRow.deletedAt) {
        apiError("BAD_REQUEST", "このイベントは終了しています");
      }
      if (eventRow.billingStatus === "suspended") {
        apiError("BAD_REQUEST", "このイベントは現在停止中のため注文を受け付けていません");
      }
      // 開催ライフサイクル状態が live 以外なら注文を受け付けない (状態が正本)。
      const lifecycle = eventRow.lifecycleStatus;
      if (lifecycle === "upcoming") {
        apiError("BAD_REQUEST", "このイベントはまだ開催前のため注文を受け付けていません");
      }
      if (lifecycle === "ended" || lifecycle === "archived") {
        apiError("BAD_REQUEST", "このイベントは終了しているため注文を受け付けていません");
      }
      // 期間(endDate)超過は自動締切のセーフティネット (状態を live のままにしていても止まる)。
      const eventEnd = eventRow.endDate;
      if (eventEnd && eventEnd.getTime() < Date.now()) {
        apiError("BAD_REQUEST", "このイベントは開催期間を終了しているため注文を受け付けていません");
      }

      // サークル設定から注文モードを解決する。
      //   "pending"    : 未着手で受付 (既定・従来挙動、厨房が調理開始→完成)
      //   "preparing"  : 最初から調理中として受付
      //   "completed"  : 受付と同時に即完成 (厨房を経由しない模擬店向け)
      let orderFlowMode: "pending" | "preparing" | "completed" = "pending";
      try {
        const parsed = JSON.parse(context.circle.settings || "{}");
        if (
          parsed?.orderFlowMode === "preparing" ||
          parsed?.orderFlowMode === "completed"
        ) {
          orderFlowMode = parsed.orderFlowMode;
        }
      } catch (_) {
        // 設定が壊れていても既定(pending)で継続する
      }

      const existingUser = context.user;
      if (!existingUser?.id) {
        // 2026-07-06: 「発行しないと使えない」方針。任意の userId から eventUser を
        // 自動作成する経路(自己発行の抜け穴)を撤去。正規の来場者IDは受付での発行
        // (POST /wristbands/issue) か物理バンドのスキャン(lookup)でのみ得られる。
        // 未発行の userId での注文は拒否する。
        apiError(
          "FORBIDDEN",
          "リストバンドが発行されていません。受付でリストバンドの発行を受けるか、店頭でスタッフにお申し付けください。",
        );
      } else if (existingUser.status === "banned") {
        // 2026-07-15: BAN された来場者の注文を拒否する。従来 status:"banned" は
        // 更新APIのenum値としてのみ存在し、どこでも検査されず「BANできない」状態だった。
        apiError("FORBIDDEN", "このリストバンドは利用できません。受付・本部にお問い合わせください。");
      } else if (existingUser.eventId !== eventId) {
        // 2026-07-06: クロスイベント混入対策 (H-3, ベストエフォート)。
        // userId は認証を伴わないベアラー値のため、既存の userId を任意に指定して
        // 他人へのなりすましスタンプ付与/抽選不正を狙える。完全な防止にはセッションが
        // 必要でありスコープ外だが、最低限「他イベントの userId を注文に使う」経路は
        // ここで塞ぐ。同一イベント内でのなりすましは本対応では防げない(残存リスク)。
        apiError("BAD_REQUEST", "ユーザーとサークルのイベントが一致しません");
      }


      // メニューの価格を取得
      const menuIds = input.items.map((i) => i.menuId);
      const allToppingIds = input.items.flatMap((i) => i.toppingIds || []);
      // 2026-07-05: 指定トッピングが対象メニューに実際に紐付いているかを検証するため
      // menu_topping の関連を取得しておく。2026-10-03: 独立した読取を同時に開始する。
      const [menus, toppings, menuToppingLinks] = await Promise.all([
        db.select().from(menu).where(inArray(menu.id, menuIds)),
        allToppingIds.length > 0
          ? db.select().from(topping).where(inArray(topping.id, allToppingIds))
          : Promise.resolve([]),
        allToppingIds.length > 0
          ? db.select().from(menuTopping).where(inArray(menuTopping.menuId, menuIds))
          : Promise.resolve([]),
      ]);

      // 合計金額を計算
      let totalPrice = 0;
      const orderItems: {
        id: string;
        orderId: string;
        menuId: string;
        menuName: string;
        menuPrice: number;
        quantity: number;
        inventoryEnabled: boolean;
        toppingIds?: string[];
      }[] = [];
      // 商品ごとに在庫管理が有効なメニューの必要数を集計する。数量0も在庫切れとして扱う。
      const stockNeeded = new Map<string, number>();
      // トッピングも同様に在庫管理する (2026-07-15)。1つのトッピングが複数アイテムに
      // 跨って選択され得るため、必要数はアイテム横断で合算する。
      const toppingStockNeeded = new Map<string, number>();

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

          // 在庫管理対象(stockQuantity > 0)のトッピングのみ集計・チェックする。
          // stockQuantity === 0 は無制限/未管理を意味し、減算しない (メニューと同じ意味論)。
          if (t.stockQuantity > 0) {
            const already = toppingStockNeeded.get(t.id) || 0;
            const totalNeeded = already + item.quantity;
            toppingStockNeeded.set(t.id, totalNeeded);
            if (t.stockQuantity < totalNeeded) {
              apiError("BAD_REQUEST", `${t.name}の在庫が不足しています`);
            }
          }
        }

        const availableMenuToppings = toppings.filter((topping) =>
          menuToppingLinks.some((link) => link.menuId === menuItem.id && link.toppingId === topping.id)
        );
        const selectionViolation = validateToppingCategorySelection(menuItem, itemToppings, availableMenuToppings);
        if (selectionViolation) {
          const label = selectionViolation.category || "未分類";
          const requirement = selectionViolation.reason === "minimum"
            ? `最低${selectionViolation.minimum}個選んでください`
            : `${selectionViolation.maximum}個まで選べます`;
          apiError("BAD_REQUEST", `${menuItem.name}: 「${label}」は${requirement}`);
        }

        // 2026-09-27: 在庫を商品単位の opt-in にする。ONなら数量0も在庫切れなので
        // ガードと減算対象に含め、OFFの商品は残数にかかわらず在庫を消費しない。
        if (menuItem.inventoryEnabled) {
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
          inventoryEnabled: menuItem.inventoryEnabled,
          toppingIds: item.toppingIds,
        });

        totalPrice += subtotal;
      }

      // 2026-10-03: 在庫減算は注文/明細と同じD1 batchで実施する。逐次補償は不要。
      // 支払い方法の解決 (2026-07-12): 明示指定を優先し、無ければサークルの対応方法が
      // ちょうど1つのときだけそれを補完する (単一方法はレジで選択させないため)。
      let resolvedPayment: string | undefined = input.paymentMethod?.trim() || undefined;
      if (!resolvedPayment) {
        try {
          const parsed = JSON.parse(context.circle.settings || "{}");
          const accepted: unknown = parsed?.acceptedPayments;
          if (Array.isArray(accepted) && accepted.length === 1 && typeof accepted[0] === "string") {
            resolvedPayment = accepted[0];
          }
        } catch {
          /* settings が壊れていても注文は通す */
        }
      }

      const committed = await commitOrder(c.env.DB, command, {
        id: orderId, circleId: input.circleId, userId: input.userId,
        cashierId: input.cashierId, peopleCount: input.peopleCount,
        totalPrice, paymentMethod: resolvedPayment, status: orderFlowMode,
        items: orderItems.map((item) => ({ ...item,
          toppings: (item.toppingIds ?? []).map((id) => {
            const t = toppings.find((row) => row.id === id)!;
            return { toppingId: t.id, toppingName: t.name, toppingPrice: t.price };
          }),
        })),
      });
      return c.json(committed satisfies CreateOrderResult, 201);
    } catch (error) {
      // Phase4: apiError/AppError による意図的な 4xx (NOT_FOUND/BAD_REQUEST/FORBIDDEN 等) を
      // ここで握りつぶして 500 に丸めないよう、AppError はそのまま再 throw して onError に委ねる。
      if (error instanceof AppError) throw error;
      // 2026-10-03: SQLやbind値をレスポンス/ログへ流さず、共通ハンドラのrequestIdで追跡する。
      throw error;
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

    const existingOrder = await db
      .select({
        id: order.id,
        circleId: order.circleId,
        userId: order.userId,
        status: order.status,
        eventId: circle.eventId,
      })
      .from(order)
      // 2026-10-03: 権限判定に必要なeventIdも同じreadで取得し、auth gate内のcircle照会を避ける。
      .leftJoin(circle, eq(circle.id, order.circleId))
      .where(eq(order.id, id));
    if (existingOrder.length === 0) apiError("NOT_FOUND", "見つかりません");

    const targetOrder = existingOrder[0]!;

    if (!(await hasPermission(c, targetOrder.circleId, "order:write", targetOrder.eventId ?? undefined))) {
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

    const transitioned = await updateOrderStatus(c.env.DB, {
      orderId: id,
      expectedStatus: targetOrder.status,
      nextStatus: input.status,
      stamp: targetOrder.status === "pending" && input.status === "preparing" && targetOrder.userId
        ? { id: ulid(), userId: targetOrder.userId, circleId: targetOrder.circleId }
        : undefined,
    });
    if (!transitioned) {
      apiError("CONFLICT", "他の操作で注文状態が更新されました。最新の状態を読み直してください");
    }

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

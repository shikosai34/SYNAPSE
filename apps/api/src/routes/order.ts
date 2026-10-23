import { Hono, type Context } from "hono";
import { zBody } from "../z-validator";
import { AppError, apiError } from "../http-error";
import { z } from "zod";
import { createOrderSchema, type CreateOrderResult } from "@fesflow/config/order-contract";
import {
  order,
  orderRefund,
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
  coupon,
  discount,
  registerDisplaySession,
} from "@fesflow/db";
import { eq, and, or, desc, inArray, sql, lte, gt, isNull, isNotNull, ne } from "drizzle-orm";
import { ulid } from "ulidx";
import { getSession, hasPermission } from "../utils/auth";
import { commitOrder, committedOrder, orderCommand } from "../services/order-commit";
import { updateOrderStatus } from "../services/order-status";
import { validateToppingCategorySelection } from "../utils/topping-wizard";
import { calculateDiscount } from "../utils/discount";
import { calculateBundleDiscounts, type AppliedBundle } from "@fesflow/config/bundle-discount";
import { loadActiveBundleRules } from "../utils/bundle-discount";
import type { AppEnv } from "../types";
import { registerDisplaySnapshotSchema } from "@fesflow/config/register-display-contract";
import { notifyCircleLowStock, notifyVisitorOrderComplete } from "../services/web-push";

const orderRoutes = new Hono<AppEnv>();

// 2026-10-21: 在庫画面の既定警告ラインに合わせ、残り2点以下へ入った時に一度だけ知らせる。
const LOW_STOCK_ALERT_THRESHOLD = 2;

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

const createRegisterDisplaySchema = z.object({
  circleId: z.string().min(1),
  snapshot: registerDisplaySnapshotSchema,
});
const updateRegisterDisplaySchema = z.object({
  snapshot: registerDisplaySnapshotSchema,
  revision: z.number().int().min(1),
});
const REGISTER_DISPLAY_LIFETIME_MS = 12 * 60 * 60 * 1000;

async function hashRegisterDisplayToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getActiveRegisterDisplay(db: ReturnType<typeof import("@fesflow/db").createDb>, id: string) {
  const rows = await db.select().from(registerDisplaySession).where(eq(registerDisplaySession.id, id)).limit(1);
  const session = rows[0];
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

async function includeOrderItems(
  db: ReturnType<typeof import("@fesflow/db").createDb>,
  orders: (typeof order.$inferSelect)[],
) {
  if (orders.length === 0) return [];
  const orderIds = orders.map((row) => row.id);
  const items = await db.select().from(orderItem)
    .where(sql`${orderItem.orderId} IN (SELECT value FROM json_each(${JSON.stringify(orderIds)}))`);
  const itemIds = items.map((row) => row.id);
  const toppings = itemIds.length > 0
    ? await db.select().from(orderItemTopping)
        .where(sql`${orderItemTopping.orderItemId} IN (SELECT value FROM json_each(${JSON.stringify(itemIds)}))`)
    : [];
  const refunds = await db.select().from(orderRefund)
    .where(sql`${orderRefund.orderId} IN (SELECT value FROM json_each(${JSON.stringify(orderIds)}))`);
  const refundsByOrder = new Map(refunds.map((refund) => [refund.orderId, refund]));
  const toppingsByItem = new Map<string, typeof toppings>();
  for (const topping of toppings) {
    const list = toppingsByItem.get(topping.orderItemId) ?? [];
    list.push(topping);
    toppingsByItem.set(topping.orderItemId, list);
  }
  const itemsByOrder = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }
  return orders.map((row) => ({
    ...row,
    refund: refundsByOrder.get(row.id) ?? null,
    items: (itemsByOrder.get(row.id) ?? []).map((item) => ({
      ...item,
      toppings: (toppingsByItem.get(item.id) ?? []).map((topping) => ({
        ...topping,
        name: topping.toppingName,
        price: topping.toppingPrice,
      })),
    })),
  }));
}

// 2026-10-21: 顧客表示の共有は注文情報を絞った投影用APIに分け、会計・来場者情報を返さない。
orderRoutes.get("/projector", async (c) => {
  const circleId = c.req.query("circleId");
  if (!circleId) apiError("BAD_REQUEST", "circleIdが必要です");
  if (!(await hasPermission(c, circleId, "order:read"))) apiError("FORBIDDEN", "権限がありません");

  const rows = await c.get("db").select({
    orderNumber: order.orderNumber,
    status: order.status,
    receivedAt: order.receivedAt,
    createdAt: order.createdAt,
  }).from(order).where(and(
    eq(order.circleId, circleId),
    inArray(order.status, ["pending", "preparing", "ready", "completed"]),
  )).orderBy(order.createdAt);
  return c.json(rows);
});

// 2026-10-21: 表示リンクの秘密値はURL fragmentにだけ置き、WorkerのURLログへ残さない。
orderRoutes.post("/register-displays", zBody(createRegisterDisplaySchema), async (c) => {
  const db = c.get("db");
  const { circleId, snapshot } = c.req.valid("json");
  if (!(await hasPermission(c, circleId, "order:write"))) apiError("FORBIDDEN", "権限がありません");

  const now = Date.now();
  const id = ulid();
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const expiresAt = now + REGISTER_DISPLAY_LIFETIME_MS;

  // 期限切れ・終了済みセッションは新規作成時に回収し、端末ごとのカート履歴を残さない。
  await db.delete(registerDisplaySession).where(or(
    lte(registerDisplaySession.expiresAt, new Date(now)),
    isNotNull(registerDisplaySession.revokedAt),
  ));
  await db.insert(registerDisplaySession).values({
    id,
    circleId,
    tokenHash: await hashRegisterDisplayToken(token),
    snapshot: JSON.stringify(snapshot),
    revision: 1,
    expiresAt: new Date(expiresAt),
  });

  return c.json({ id, token, revision: 1, expiresAt }, 201);
});

orderRoutes.put("/register-displays/:id/snapshot", zBody(updateRegisterDisplaySchema), async (c) => {
  const db = c.get("db");
  const session = await getActiveRegisterDisplay(db, c.req.param("id"));
  if (!session) apiError("NOT_FOUND", "共有画面は終了しました");
  if (!(await hasPermission(c, session.circleId, "order:write"))) apiError("FORBIDDEN", "権限がありません");

  const { snapshot, revision } = c.req.valid("json");
  const rows = await db.update(registerDisplaySession).set({
    snapshot: JSON.stringify(snapshot),
    revision,
    updatedAt: new Date(),
  }).where(and(
    eq(registerDisplaySession.id, session.id),
    lte(registerDisplaySession.revision, revision - 1),
    isNull(registerDisplaySession.revokedAt),
    gt(registerDisplaySession.expiresAt, new Date()),
  )).returning({ id: registerDisplaySession.id });
  if (rows.length === 0) {
    const current = await getActiveRegisterDisplay(db, session.id);
    if (!current || current.revision < revision) apiError("NOT_FOUND", "共有画面は終了しました");
    // 2026-10-21: 遅れて届いた古いスナップショットは無視し、画面を巻き戻さない。
  }
  return c.json({ success: true });
});

orderRoutes.delete("/register-displays/:id", async (c) => {
  const db = c.get("db");
  const session = await getActiveRegisterDisplay(db, c.req.param("id"));
  if (!session) return c.json({ success: true });
  if (!(await hasPermission(c, session.circleId, "order:write"))) apiError("FORBIDDEN", "権限がありません");

  await db.update(registerDisplaySession).set({ revokedAt: new Date() }).where(and(
    eq(registerDisplaySession.id, session.id),
    isNull(registerDisplaySession.revokedAt),
  ));
  return c.json({ success: true });
});

orderRoutes.get("/register-displays/:id/snapshot", async (c) => {
  const id = c.req.param("id");
  const authorization = c.req.header("Authorization") ?? "";
  const token = /^Bearer\s+([a-f0-9]{64})$/i.exec(authorization)?.[1];
  if (!token) apiError("NOT_FOUND", "共有画面は終了しました");

  const session = await getActiveRegisterDisplay(c.get("db"), id);
  const tokenHash = await hashRegisterDisplayToken(token);
  if (!session || session.tokenHash !== tokenHash) apiError("NOT_FOUND", "共有画面は終了しました");

  let stored: unknown;
  try {
    stored = JSON.parse(session.snapshot);
  } catch {
    apiError("NOT_FOUND", "共有画面は終了しました");
  }
  const snapshot = registerDisplaySnapshotSchema.safeParse(stored);
  if (!snapshot.success) apiError("NOT_FOUND", "共有画面は終了しました");

  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.json({
    snapshot: snapshot.data,
    revision: session.revision,
    updatedAt: session.updatedAt.getTime(),
    expiresAt: session.expiresAt.getTime(),
  });
});

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
    .where(status === "received"
      ? and(eq(order.circleId, circleId), inArray(order.status, ["ready", "completed"]), isNotNull(order.receivedAt))
      : status === "pickup"
        ? and(eq(order.circleId, circleId), inArray(order.status, ["ready", "completed"]), isNull(order.receivedAt))
        : status
          ? and(eq(order.circleId, circleId), eq(order.status, status))
          : eq(order.circleId, circleId))
    .orderBy(desc(order.createdAt));

  const orders = await query;
  return c.json(await includeOrderItems(db, orders));
});

// 2026-10-22: リストバンド確認後、重複作成せず既存モバイル注文の未会計分をレジで案内する。
orderRoutes.get("/mobile/unpaid", async (c) => {
  const db = c.get("db");
  const circleId = c.req.query("circleId");
  const userId = c.req.query("userId");
  if (!circleId || !userId) apiError("BAD_REQUEST", "circleIdとuserIdが必要です");

  const circleRows = await db.select({ eventId: circle.eventId }).from(circle)
    .where(eq(circle.id, circleId)).limit(1);
  const targetCircle = circleRows[0];
  if (!targetCircle) apiError("NOT_FOUND", "サークルが見つかりません");
  if (!(await hasPermission(c, circleId, "order:write", targetCircle.eventId))) {
    apiError("FORBIDDEN", "会計する権限がありません");
  }

  const visitors = await db.select({ eventId: eventUser.eventId }).from(eventUser)
    .where(eq(eventUser.id, userId)).limit(1);
  if (!visitors[0] || visitors[0].eventId !== targetCircle.eventId) return c.json([]);

  const orders = await db.select().from(order).where(and(
    eq(order.circleId, circleId),
    eq(order.userId, userId),
    eq(order.source, "mobile"),
    eq(order.paymentStatus, "unpaid"),
    ne(order.status, "cancelled"),
  )).orderBy(desc(order.createdAt));
  return c.json(await includeOrderItems(db, orders));
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

  // cashierId / paymentMethod / updatedAt 等は除外し、来場者に必要な会計状態だけ返す。
  const result = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    totalPrice: o.totalPrice,
    peopleCount: o.peopleCount,
    circleId: o.circleId,
    circleName: circles.find((ci) => ci.id === o.circleId)?.name ?? null,
    createdAt: o.createdAt,
    completedAt: o.completedAt,
    receivedAt: o.receivedAt,
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
const handleCreateOrder = async (
  c: Context<AppEnv>,
  source: "pos" | "mobile",
  input: z.infer<typeof createOrderSchema>,
) => {
    const db = c.get("db");
    try {
      const orderId = ulid();
      // 2026-10-03: 再送結果は在庫/価格の再検証前に返し、成功後のレスポンス紛失にも対応する。
      const command = await orderCommand(`${source}:${input.circleId}:${input.userId}`, c.req.header("Idempotency-Key"), input);

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

      // 2026-10-17: API経路で注文元を固定し、モバイル注文はレジ担当者情報を引き継がない。
      // 2026-10-22: 会計担当者はクライアント申告を信用せず、認証済みセッションから記録する。
      const cashierId = source === "pos" ? (await getSession(c))?.user.email ?? null : null;
      if (source === "mobile") {
        let settings: { mobileOrderEnabled?: boolean } = {};
        try {
          settings = JSON.parse(context.circle.settings || "{}") as typeof settings;
        } catch {
          settings = {};
        }
        if (settings.mobileOrderEnabled !== true) {
          apiError("FORBIDDEN", "このサークルはモバイルオーダーを受け付けていません");
        }
      }

      let appliedRegisterCoupon: { id: string; discountApplied: number } | undefined;
      let registerDiscountPercent: number | undefined;
      if (input.registerCouponId) {
        if (!(await hasPermission(c, input.circleId, "order:write"))) {
          apiError("FORBIDDEN", "レジ割引を適用する権限がありません");
        }
        const rows = await db.select().from(coupon).where(eq(coupon.id, input.registerCouponId)).limit(1);
        const registerCoupon = rows[0];
        if (!registerCoupon || registerCoupon.circleId !== input.circleId || !registerCoupon.registerOnly) {
          apiError("BAD_REQUEST", "このレジで利用できるクーポンではありません");
        }
        if (registerCoupon.status !== "active" ||
          (registerCoupon.expiresAt && registerCoupon.expiresAt.getTime() < Date.now()) ||
          (registerCoupon.maxRedemptions !== null && registerCoupon.redeemedCount >= registerCoupon.maxRedemptions)) {
          apiError("BAD_REQUEST", "クーポンは無効か、使用上限に達しています");
        }
        if (registerCoupon.kind !== "cart_percentage" || !registerCoupon.discountPercent ||
          registerCoupon.discountPercent < 1 || registerCoupon.discountPercent > 100) {
          apiError("BAD_REQUEST", "レジ専用クーポンの割引設定が不正です");
        }
        appliedRegisterCoupon = { id: registerCoupon.id, discountApplied: 0 };
        registerDiscountPercent = registerCoupon.discountPercent;
      }

      let appliedDiscount: { id: string; discountApplied: number } | undefined;
      let registerDiscount: { kind: "percentage" | "amount"; value: number } | undefined;
      if (input.discountId) {
        if (input.registerCouponId) {
          apiError("BAD_REQUEST", "クーポンと割引は同時に適用できません");
        }
        if (source !== "pos") {
          apiError("BAD_REQUEST", "割引はサークルのレジ注文でのみ利用できます");
        }
        if (!(await hasPermission(c, input.circleId, "order:write"))) {
          apiError("FORBIDDEN", "レジ割引を適用する権限がありません");
        }
        const rows = await db.select().from(discount).where(eq(discount.id, input.discountId)).limit(1);
        const selectedDiscount = rows[0];
        if (!selectedDiscount || selectedDiscount.circleId !== input.circleId || selectedDiscount.status !== "active") {
          apiError("BAD_REQUEST", "このレジで利用できる割引ではありません");
        }
        if ((selectedDiscount.kind !== "percentage" && selectedDiscount.kind !== "amount") ||
          !Number.isInteger(selectedDiscount.value) || selectedDiscount.value <= 0 ||
          (selectedDiscount.kind === "percentage" && selectedDiscount.value > 100)) {
          apiError("BAD_REQUEST", "割引の設定が不正です");
        }
        registerDiscount = { kind: selectedDiscount.kind, value: selectedDiscount.value };
        appliedDiscount = { id: selectedDiscount.id, discountApplied: 0 };
      }

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
        if (source === "pos" && (
          parsed?.orderFlowMode === "preparing" ||
          parsed?.orderFlowMode === "completed"
        )) {
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
        db.select().from(menu).where(and(inArray(menu.id, menuIds), eq(menu.isArchived, false))),
        allToppingIds.length > 0
          ? db.select().from(topping).where(and(inArray(topping.id, allToppingIds), eq(topping.isArchived, false)))
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

      // 2026-10-23: セット割引 (N個で○円) は条件を満たす注文へ自動適用し、手動割引/クーポンより先に引く。
      // 個数条件とセット価格は menuPrice のみで比べるので、トッピング代は割り引かれない (percent_off だけは注文全体が対象)。
      let appliedBundles: AppliedBundle[] = [];
      {
        const bundleResult = calculateBundleDiscounts(
          orderItems.map((item) => ({
            menuId: item.menuId,
            unitPrice: item.menuPrice,
            quantity: item.quantity,
            toppingPrice: (item.toppingIds ?? []).reduce((sum, id) => sum + (toppings.find((row) => row.id === id)?.price ?? 0), 0),
          })),
          await loadActiveBundleRules(db, input.circleId),
        );
        appliedBundles = bundleResult.applied;
        totalPrice = Math.max(0, totalPrice - bundleResult.totalDiscount);
      }

      if (appliedRegisterCoupon) {
        const discountApplied = Math.min(totalPrice, Math.floor((totalPrice * registerDiscountPercent!) / 100));
        if (discountApplied <= 0) {
          apiError("BAD_REQUEST", "割引を適用できる商品小計がありません");
        }
        totalPrice = Math.max(0, totalPrice - discountApplied);
        appliedRegisterCoupon = { ...appliedRegisterCoupon, discountApplied };
      }

      if (appliedDiscount && registerDiscount) {
        const discountApplied = calculateDiscount(totalPrice, registerDiscount.kind, registerDiscount.value);
        totalPrice = Math.max(0, totalPrice - discountApplied);
        appliedDiscount = { ...appliedDiscount, discountApplied };
      }

      // 2026-10-21: 端末に保存した注文の再送時は価格が変わっていないことを確かめ、差額を黙って確定しない。
      if (source === "mobile" && input.expectedTotalPrice !== undefined && totalPrice !== input.expectedTotalPrice) {
        apiError("CONFLICT", "メニュー価格が変更されています。最新の価格を確認してから注文し直してください");
      }

      // 2026-10-03: 在庫減算は注文/明細と同じD1 batchで実施する。逐次補償は不要。
      // 支払い方法の解決 (2026-07-12): 明示指定を優先し、無ければサークルの対応方法が
      // ちょうど1つのときだけそれを補完する (単一方法はレジで選択させないため)。
      // 2026-10-22: モバイル注文時の希望方法を実入金と誤認しないよう、支払い方法はレジ会計時に記録する。
      let resolvedPayment: string | undefined = source === "pos" ? input.paymentMethod?.trim() || undefined : undefined;
      if (source === "pos" && !resolvedPayment) {
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
        cashierId, source, peopleCount: input.peopleCount,
        totalPrice, paymentMethod: resolvedPayment, status: orderFlowMode,
        registerCoupon: appliedRegisterCoupon,
        discount: appliedDiscount,
        bundleDiscounts: appliedBundles,
        items: orderItems.map((item) => ({ ...item,
          toppings: (item.toppingIds ?? []).map((id) => {
            const t = toppings.find((row) => row.id === id)!;
            return { toppingId: t.id, toppingName: t.name, toppingPrice: t.price };
          }),
        })),
      });

      // 2026-10-21: 在庫減算が確定した後だけ、少量在庫に入った商品のスタッフ通知を送る。
      const lowStockItems = [
        ...[...stockNeeded.entries()].flatMap(([menuId, quantity]) => {
          const item = menus.find((row) => row.id === menuId);
          if (!item || !item.inventoryEnabled || item.stockQuantity <= LOW_STOCK_ALERT_THRESHOLD) return [];
          const remaining = item.stockQuantity - quantity;
          return remaining <= LOW_STOCK_ALERT_THRESHOLD ? [{ name: item.name, remaining }] : [];
        }),
        ...[...toppingStockNeeded.entries()].flatMap(([toppingId, quantity]) => {
          const item = toppings.find((row) => row.id === toppingId);
          if (!item || item.stockQuantity <= LOW_STOCK_ALERT_THRESHOLD) return [];
          const remaining = item.stockQuantity - quantity;
          return remaining <= LOW_STOCK_ALERT_THRESHOLD ? [{ name: item.name, remaining }] : [];
        }),
      ];
      if (lowStockItems.length > 0) {
        c.executionCtx.waitUntil(notifyCircleLowStock(c.get("db"), c.env, input.circleId, lowStockItems)
          .catch(() => console.warn("low_stock_notification_failed")));
      }
      if (orderFlowMode === "completed" && input.userId) {
        c.executionCtx.waitUntil(notifyVisitorOrderComplete(c.get("db"), c.env, {
          eventId,
          visitorId: input.userId,
          orderId: committed.id,
          orderNumber: committed.orderNumber,
        }).catch(() => console.warn("order_completion_notification_failed")));
      }
      return c.json(committed satisfies CreateOrderResult, 201);
    } catch (error) {
      // Phase4: apiError/AppError による意図的な 4xx (NOT_FOUND/BAD_REQUEST/FORBIDDEN 等) を
      // ここで握りつぶして 500 に丸めないよう、AppError はそのまま再 throw して onError に委ねる。
      if (error instanceof AppError) throw error;
      // 2026-10-03: SQLやbind値をレスポンス/ログへ流さず、共通ハンドラのrequestIdで追跡する。
      throw error;
    }
};

orderRoutes.post("/", zBody(createOrderSchema), async (c) => handleCreateOrder(c, "pos", c.req.valid("json")));
orderRoutes.post("/mobile", zBody(createOrderSchema), async (c) => handleCreateOrder(c, "mobile", c.req.valid("json")));

// 2026-10-22: 会計は既存モバイル注文の支払い状態だけをCAS更新し、注文・在庫を再作成しない。
orderRoutes.post(
  "/:id/settle",
  zBody(z.object({
    paymentMethod: z.string().trim().min(1).max(30),
  })),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const rows = await db.select({
      id: order.id,
      circleId: order.circleId,
      userId: order.userId,
      source: order.source,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt,
      eventId: circle.eventId,
      circleSettings: circle.settings,
      eventPaymentMethods: event.paymentMethods,
    }).from(order)
      .innerJoin(circle, eq(circle.id, order.circleId))
      .innerJoin(event, eq(event.id, circle.eventId))
      .where(eq(order.id, id)).limit(1);
    const target = rows[0];
    if (!target) apiError("NOT_FOUND", "注文が見つかりません");
    if (!(await hasPermission(c, target.circleId, "order:write", target.eventId))) {
      apiError("FORBIDDEN", "会計する権限がありません");
    }
    const session = await getSession(c);
    if (target.source !== "mobile") apiError("BAD_REQUEST", "モバイル注文だけ会計できます");
    if (target.status === "cancelled") apiError("CONFLICT", "キャンセル済みの注文は会計できません");
    if (target.paymentStatus === "paid") {
      return c.json({
        success: true,
        alreadyPaid: true,
        paidAt: target.paidAt?.toISOString() ?? new Date().toISOString(),
      });
    }

    let eventMethods: string[] = [];
    let acceptedMethods: string[] = [];
    try {
      const parsed: unknown = JSON.parse(target.eventPaymentMethods || "[]");
      if (Array.isArray(parsed)) eventMethods = parsed.filter((value): value is string => typeof value === "string");
    } catch { /* 不正なイベント設定では会計方法を受け付けない */ }
    try {
      const parsed = JSON.parse(target.circleSettings || "{}");
      const configured: unknown = parsed?.acceptedPayments;
      if (Array.isArray(configured)) acceptedMethods = configured.filter((value): value is string => typeof value === "string");
    } catch { /* サークル設定が不正な場合はイベント設定へフォールバック */ }
    const filteredMethods = acceptedMethods.length > 0
      ? acceptedMethods.filter((method) => eventMethods.includes(method))
      : eventMethods;
    const allowedMethods = filteredMethods.length > 0 ? filteredMethods : eventMethods;
    if (!allowedMethods.includes(input.paymentMethod)) {
      apiError("BAD_REQUEST", "このサークルで利用できない支払い方法です");
    }

    const now = Date.now();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE orders SET payment_status='paid', payment_method=?, cashier_id=?, paid_at=?, updated_at=?
        WHERE id=? AND circle_id=? AND source='mobile' AND payment_status='unpaid' AND status!='cancelled'
        RETURNING id`).bind(input.paymentMethod, session?.user.email ?? null, now, now, id, target.circleId),
      // すでに厨房が調理を始めている場合は会計時にスタンプを補完する。
      c.env.DB.prepare(`INSERT INTO user_stamp (id,user_id,circle_id)
        SELECT ?, orders.user_id, orders.circle_id FROM orders
        WHERE orders.id=? AND orders.user_id IS NOT NULL AND orders.payment_status='paid'
          AND orders.status IN ('preparing','ready','completed')
          AND NOT EXISTS (SELECT 1 FROM user_stamp WHERE user_id=orders.user_id AND circle_id=orders.circle_id)
        ON CONFLICT(user_id,circle_id) DO NOTHING`).bind(ulid(), id),
    ]);

    const latest = await db.select({ paymentStatus: order.paymentStatus, status: order.status, paidAt: order.paidAt })
      .from(order).where(eq(order.id, id)).limit(1);
    if (latest[0]?.status === "cancelled") apiError("CONFLICT", "会計中に注文がキャンセルされました");
    if (latest[0]?.paymentStatus !== "paid") {
      if (results[0]?.meta.changes !== 1) apiError("CONFLICT", "注文の状態が変わりました。未会計注文を再読み込みしてください");
      apiError("INTERNAL", "会計状態を確認できませんでした");
    }
    return c.json({
      success: true,
      alreadyPaid: results[0]?.meta.changes !== 1,
      paidAt: latest[0]?.paidAt?.toISOString() ?? new Date(now).toISOString(),
    });
  },
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
      // 2026-10-22: 支払済み注文は現金移動を済ませた担当者の明示操作でのみ返金取消する。
      refundConfirmed: z.boolean().optional(),
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
        orderNumber: order.orderNumber,
        status: order.status,
        totalPrice: order.totalPrice,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
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

    const needsRefund = input.status === "cancelled" && targetOrder.paymentStatus === "paid";
    if (needsRefund && input.refundConfirmed !== true) {
      apiError("BAD_REQUEST", "支払済み注文は、実際に全額返金した後に返金を確認してください");
    }
    if (input.status === "cancelled" && targetOrder.paymentStatus === "refunded") {
      apiError("CONFLICT", "この注文はすでに返金されています");
    }
    const now = Date.now();
    const session = needsRefund ? await getSession(c) : null;

    const transitioned = await updateOrderStatus(c.env.DB, {
      orderId: id,
      expectedStatus: targetOrder.status,
      nextStatus: input.status,
      expectedPaymentStatus: input.status === "cancelled" ? targetOrder.paymentStatus as "paid" | "unpaid" : undefined,
      refund: needsRefund
        ? { id: ulid(), refundedBy: session?.user.email ?? null, refundedAt: now }
        : undefined,
      stamp: targetOrder.status === "pending" && input.status === "preparing" && targetOrder.userId
        ? { id: ulid(), userId: targetOrder.userId, circleId: targetOrder.circleId }
        : undefined,
    });
    if (!transitioned) {
      apiError("CONFLICT", "他の操作で注文状態が更新されました。最新の状態を読み直してください");
    }

    if (input.status === "completed" && targetOrder.userId && targetOrder.eventId) {
      c.executionCtx.waitUntil(notifyVisitorOrderComplete(c.get("db"), c.env, {
        eventId: targetOrder.eventId,
        visitorId: targetOrder.userId,
        orderId: targetOrder.id,
        orderNumber: targetOrder.orderNumber,
      }).catch(() => console.warn("order_completion_notification_failed")));
    }

    return c.json({
      success: true,
      refund: needsRefund ? { amount: targetOrder.totalPrice, refundedAt: new Date(now).toISOString() } : null,
    });
  }
);

// 注文完了
orderRoutes.post("/:id/complete", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");

  const existingOrder = await db.select({
    id: order.id,
    circleId: order.circleId,
    eventId: circle.eventId,
    userId: order.userId,
    orderNumber: order.orderNumber,
    status: order.status,
  }).from(order).leftJoin(circle, eq(circle.id, order.circleId)).where(eq(order.id, id));
  if (existingOrder.length === 0) apiError("NOT_FOUND", "見つかりません");
  
  const targetOrder = existingOrder[0]!;

  if (!(await hasPermission(c, targetOrder.circleId, "order:write"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  // 2026-10-22: 返金・取消済み注文を完了扱いへ戻さず、取消を終端状態として守る。
  const completedOrders = await db
    .update(order)
    .set({ status: "completed", completed: true, completedAt: new Date() })
    .where(and(eq(order.id, id), ne(order.status, "cancelled")))
    .returning({ id: order.id });
  if (completedOrders.length === 0) apiError("CONFLICT", "キャンセル済み注文は完了にできません");

  if (targetOrder.status !== "completed" && targetOrder.userId && targetOrder.eventId) {
    c.executionCtx.waitUntil(notifyVisitorOrderComplete(db, c.env, {
      eventId: targetOrder.eventId,
      visitorId: targetOrder.userId,
      orderId: targetOrder.id,
      orderNumber: targetOrder.orderNumber,
    }).catch(() => console.warn("order_completion_notification_failed")));
  }

  return c.json({ success: true });
});

// 2026-10-21: 完成と受け渡しを別々に残し、受け取り待ちの注文だけを厨房で確定できるようにする。
orderRoutes.post("/:id/received", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const rows = await db.select({
    id: order.id,
    circleId: order.circleId,
    status: order.status,
    receivedAt: order.receivedAt,
  }).from(order).where(eq(order.id, id)).limit(1);
  const target = rows[0];
  if (!target) apiError("NOT_FOUND", "注文が見つかりません");
  if (!(await hasPermission(c, target.circleId, "order:write"))) apiError("FORBIDDEN", "権限がありません");
  if (target.receivedAt) return c.json({ success: true });
  if (target.status !== "ready" && target.status !== "completed") apiError("CONFLICT", "完成した注文だけ受け渡し済みにできます");

  const updated = await db.update(order).set({ receivedAt: new Date() }).where(and(
    eq(order.id, id),
    inArray(order.status, ["ready", "completed"]),
    isNull(order.receivedAt),
  )).returning({ id: order.id });
  if (updated.length === 0) {
    const latest = await db.select({ status: order.status, receivedAt: order.receivedAt }).from(order).where(eq(order.id, id)).limit(1);
    if (!latest[0] || (latest[0].status !== "ready" && latest[0].status !== "completed") || !latest[0].receivedAt) {
      apiError("CONFLICT", "注文の状態が更新されました。最新状態を読み直してください");
    }
  }
  return c.json({ success: true });
});

// 2026-10-21: 来場者が自分の受け取り待ち注文だけを確定できるよう、匿名ベアラーIDと注文所有者を照合する。
orderRoutes.post("/user/:code/:id/received", async (c) => {
  const db = c.get("db");
  const userId = c.req.param("code");
  const id = c.req.param("id");
  const rows = await db.select({
    id: order.id,
    userId: order.userId,
    status: order.status,
    receivedAt: order.receivedAt,
  }).from(order).where(and(eq(order.id, id), eq(order.userId, userId))).limit(1);
  const target = rows[0];
  if (!target) apiError("NOT_FOUND", "注文が見つかりません");
  if (target.receivedAt) return c.json({ success: true });
  if (target.status !== "ready" && target.status !== "completed") apiError("CONFLICT", "受け取り可能な注文だけ確定できます");

  const updated = await db.update(order).set({ receivedAt: new Date() }).where(and(
    eq(order.id, id),
    eq(order.userId, userId),
    inArray(order.status, ["ready", "completed"]),
    isNull(order.receivedAt),
  )).returning({ id: order.id });
  if (updated.length === 0) {
    const latest = await db.select({ status: order.status, receivedAt: order.receivedAt }).from(order)
      .where(and(eq(order.id, id), eq(order.userId, userId))).limit(1);
    if (!latest[0] || !latest[0].receivedAt) apiError("CONFLICT", "注文の状態が更新されました。最新状態を読み直してください");
  }
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
    // 2026-10-22: 売上統計は調理完了ではなく実会計を基準にし、取消注文を除く。
    .where(and(eq(order.circleId, circleId), ne(order.status, "cancelled"), eq(order.paymentStatus, "paid")));

  const orders = await query;

  // 日付でフィルタリング
  let filteredOrders = orders;
  if (dateFrom) {
    const from = new Date(dateFrom);
    filteredOrders = filteredOrders.filter(
      (o) => (o.paidAt ?? o.createdAt) >= from
    );
  }
  if (dateTo) {
    const to = new Date(dateTo);
    filteredOrders = filteredOrders.filter((o) => (o.paidAt ?? o.createdAt) <= to);
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

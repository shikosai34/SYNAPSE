import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  event,
  membership,
  circle,
  order,
  orderRefund,
  orderItem,
  orderItemTopping,
  eventUser,
  circleVisit,
  menu,
  notification,
  userStamp,
  contractPayment,
  eventAnnouncement,
} from "@fesflow/db";
import { eq, and, inArray, isNull, isNotNull, desc, gte, lt } from "drizzle-orm";
import { ulid } from "ulidx";
import { getAdminSession, getSession, hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";
import { VISITOR_AGE_GROUPS } from "@fesflow/config/visitor-profile";
import { notifyVisitors, sendPushToTargets } from "../services/web-push";

const eventRoutes = new Hono<AppEnv>();

// 2026-10-16 (#126): 店舗エリアはイベント共有の安定IDで管理し、サークル設定から参照する。
const storeAreasSchema = z.array(z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(60),
})).max(50).superRefine((areas, ctx) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  areas.forEach((area, index) => {
    const normalizedName = area.name.toLowerCase();
    if (ids.has(area.id)) {
      ctx.addIssue({ code: "custom", path: [index, "id"], message: "店舗エリアIDが重複しています" });
    }
    if (names.has(normalizedName)) {
      ctx.addIssue({ code: "custom", path: [index, "name"], message: "店舗エリア名が重複しています" });
    }
    ids.add(area.id);
    names.add(normalizedName);
  });
});

// イベント一覧取得 (2026-07-04 SaaSマルチテナント制限)
eventRoutes.get("/", async (c) => {
  const db = c.get("db");
  const session = await getSession(c);
  if (!session || !session.user) {
    apiError("UNAUTHORIZED", "認証が必要です");
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

// 2026-10-08: 未入場の来場者が公開イベントを選べるよう、運営一覧とは分けて
// 公開表示に必要な項目だけ返す。運営用一覧の所属ベース認可は維持する。
eventRoutes.get("/public", async (c) => {
  const db = c.get("db");
  const events = await db
    .select({
      id: event.id,
      eventName: event.eventName,
      description: event.description,
      officialWebsiteUrl: event.officialWebsiteUrl,
      logoUrl: event.logoUrl,
    })
    .from(event)
    .where(isNull(event.deletedAt))
    .orderBy(desc(event.startDate));

  return c.json(events);
});

// イベント取得
eventRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const events = await db
    // 2026-10-08: このルートは来場者画面からも認証なしで呼ばれるため、
    // 契約情報・所有者メール・運営メモなどを含むイベント行全体を返さず、画面用項目に限定する。
    .select({
      id: event.id,
      eventName: event.eventName,
      description: event.description,
      officialWebsiteUrl: event.officialWebsiteUrl,
      startDate: event.startDate,
      endDate: event.endDate,
      storeAreas: event.storeAreas,
      lifecycleStatus: event.lifecycleStatus,
      paymentMethods: event.paymentMethods,
      stampRallySettings: event.stampRallySettings,
      lotteryEnabled: event.lotteryEnabled,
      advancedPermissions: event.advancedPermissions,
      logoUrl: event.logoUrl,
      fontFamily: event.fontFamily,
      customFontUrl: event.customFontUrl,
      primaryColor: event.primaryColor,
      primaryTextColor: event.primaryTextColor,
      accentColor: event.accentColor,
      accentTextColor: event.accentTextColor,
      backgroundColor: event.backgroundColor,
      textColor: event.textColor,
      hasPhysicalWristband: event.hasPhysicalWristband,
      allowSelfIssue: event.allowSelfIssue,
    })
    .from(event)
    .where(and(eq(event.id, id), isNull(event.deletedAt)));

  if (events.length === 0) {
    apiError("NOT_FOUND", "イベントが見つかりません");
  }

  return c.json(events[0]);
});

// 2026-10-20: 設定を現在のエリアID・達成条件形式に統一し、旧形式の保存入力を廃止する。
eventRoutes.put(
  "/:id/stamp-rally-settings",
  zBody(z.object({
    settings: z.object({
      enabled: z.boolean(),
      targetAreaIds: z.array(z.string().min(1).max(64)).max(50),
      // 2026-10-19: エリア数と合計店舗数を独立して組み合わせられる条件設定。
      qualification: z.object({
        minQualifiedAreaCount: z.number().int().min(1).max(50).nullable(),
        minDistinctCirclesPerArea: z.object({
          default: z.number().int().min(1).max(100),
          byArea: z.record(z.string().min(1).max(64), z.number().int().min(1).max(100)),
        }),
        requiredAreaIds: z.array(z.string().min(1).max(64)).max(50),
        minTotalDistinctCircles: z.number().int().min(1).max(100).nullable(),
      }),
      rewardTitle: z.string().trim().max(100).optional(),
      // 2026-10-16: 景品別の在庫・交換数を照合し、複数景品を受付できるカタログ。
      rewards: z.array(z.object({
        id: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(100),
        stockQuantity: z.number().int().min(0).max(500_000).nullable(),
      })).min(1).max(20).optional(),
      redemptionLocation: z.string().trim().max(500).optional(),
      rulesUrl: z.string().trim().max(2048).optional(),
    }),
  })),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    if (!(await hasPermission(c, null, "event:write", eventId))) {
      apiError("FORBIDDEN", "このイベントの設定を変更する権限がありません");
    }

    const { settings } = c.req.valid("json");
    const eventRows = await db.select({ storeAreas: event.storeAreas }).from(event)
      .where(and(eq(event.id, eventId), isNull(event.deletedAt))).limit(1);
    if (!eventRows[0]) apiError("NOT_FOUND", "イベントが見つかりません");
    if (settings.rulesUrl) {
      let parsedRulesUrl: URL | null = null;
      try { parsedRulesUrl = new URL(settings.rulesUrl); } catch { /* validation below returns a field error */ }
      if (!parsedRulesUrl || (parsedRulesUrl.protocol !== "http:" && parsedRulesUrl.protocol !== "https:")) {
        apiError("BAD_REQUEST", "ルールURLには http または https のURLを入力してください");
      }
    }

    const targetAreaIds = settings.targetAreaIds;
    let normalized: Record<string, unknown>;
    if (new Set(targetAreaIds).size !== targetAreaIds.length) {
      apiError("BAD_REQUEST", "対象エリアを重複して選択できません");
    }
    let storeAreas: Array<{ id: string }> = [];
    try {
      const parsed: unknown = JSON.parse(eventRows[0]!.storeAreas || "[]");
      if (Array.isArray(parsed)) {
        storeAreas = parsed.filter(
          (area): area is { id: string } =>
            !!area && typeof area === "object" && typeof area.id === "string",
        );
      }
    } catch {
      storeAreas = [];
    }
    const validAreaIds = new Set(storeAreas.map((area) => area.id));
    if (targetAreaIds.some((id) => !validAreaIds.has(id))) {
      apiError(
        "BAD_REQUEST",
        "イベントに登録されていない会場エリアが含まれています",
      );
    }

    const eventCircles = await db
      .select({ id: circle.id, settings: circle.settings })
      .from(circle)
      .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
    const targetCircleCount = eventCircles.filter((row) => {
      try {
        const circleSettings = JSON.parse(row.settings || "{}") as {
          storeAreaId?: unknown;
        };
        return (
          typeof circleSettings.storeAreaId === "string" &&
          targetAreaIds.includes(circleSettings.storeAreaId)
        );
      } catch {
        return false;
      }
    }).length;
    const qualification = settings.qualification;
    if (
      Object.keys(qualification.minDistinctCirclesPerArea.byArea).some(
        (areaId) => !targetAreaIds.includes(areaId),
      )
    ) {
      apiError(
        "BAD_REQUEST",
        "エリアごとの必要店舗数は対象エリアに設定してください",
      );
    }
    if (
      qualification.requiredAreaIds.some(
        (areaId) => !targetAreaIds.includes(areaId),
      )
    ) {
      apiError("BAD_REQUEST", "必須エリアは対象エリアから選択してください");
    }
    if (
      qualification.minQualifiedAreaCount !== null &&
      qualification.minQualifiedAreaCount < qualification.requiredAreaIds.length
    ) {
      apiError("BAD_REQUEST", "達成エリア数は必須エリア数以上にしてください");
    }
    if (
      qualification.minQualifiedAreaCount === null &&
      qualification.requiredAreaIds.length > 0
    ) {
      apiError(
        "BAD_REQUEST",
        "必須エリアを指定するにはエリア達成条件が必要です",
      );
    }
    const targetCircleCountsByArea = new Map<string, number>();
    for (const row of eventCircles) {
      try {
        const areaId = (
          JSON.parse(row.settings || "{}") as { storeAreaId?: unknown }
        ).storeAreaId;
        if (typeof areaId === "string" && targetAreaIds.includes(areaId)) {
          targetCircleCountsByArea.set(
            areaId,
            (targetCircleCountsByArea.get(areaId) ?? 0) + 1,
          );
        }
      } catch {
        // 壊れたサークル設定はエリア未割当として扱う。
      }
    }
    if (settings.enabled) {
      const qualifyingAreaCount = targetAreaIds.filter((areaId) => {
        const required =
          qualification.minDistinctCirclesPerArea.byArea[areaId] ??
          qualification.minDistinctCirclesPerArea.default;
        return required <= (targetCircleCountsByArea.get(areaId) ?? 0);
      }).length;
      const requiredAreasArePossible = qualification.requiredAreaIds.every(
        (areaId) => {
          const required =
            qualification.minDistinctCirclesPerArea.byArea[areaId] ??
            qualification.minDistinctCirclesPerArea.default;
          return required <= (targetCircleCountsByArea.get(areaId) ?? 0);
        },
      );
      if (
        targetAreaIds.length === 0 ||
        (qualification.minQualifiedAreaCount === null &&
          qualification.minTotalDistinctCircles === null)
      ) {
        apiError(
          "BAD_REQUEST",
          "有効化するにはエリア条件または合計店舗数を指定してください",
        );
      }
      if (
        qualification.minQualifiedAreaCount !== null &&
        (qualification.minQualifiedAreaCount > targetAreaIds.length ||
          qualifyingAreaCount < qualification.minQualifiedAreaCount ||
          !requiredAreasArePossible)
      ) {
        apiError(
          "BAD_REQUEST",
          "達成条件を満たせるエリア数が不足しています。対象店舗の場所を確認してください",
        );
      }
      if (
        qualification.minTotalDistinctCircles !== null &&
        qualification.minTotalDistinctCircles > targetCircleCount
      ) {
        apiError(
          "BAD_REQUEST",
          "合計の必要店舗数に対して対象店舗が不足しています",
        );
      }
    }
    const rewards = settings.rewards;
    if (rewards) {
      if (
        new Set(rewards.map((reward) => reward.id)).size !== rewards.length ||
        new Set(rewards.map((reward) => reward.name.toLocaleLowerCase()))
          .size !== rewards.length
      ) {
        apiError("BAD_REQUEST", "景品のIDと名前は重複できません");
      }
    }
    if (settings.enabled && !settings.redemptionLocation?.trim()) {
      apiError(
        "BAD_REQUEST",
        "スタンプラリーを有効にするには景品交換場所を入力してください",
      );
    }
    normalized = {
      enabled: settings.enabled,
      targetAreaIds,
      qualification,
      rewardTitle: rewards?.[0]?.name || settings.rewardTitle || "景品交換",
      ...(rewards ? { rewards } : {}),
      redemptionLocation: settings.redemptionLocation || "",
      rulesUrl: settings.rulesUrl || "",
    };
    await db
      .update(event)
      .set({ stampRallySettings: JSON.stringify(normalized) })
      .where(and(eq(event.id, eventId), isNull(event.deletedAt)));
    return c.json({ success: true });
  },
);

// イベント横断の進行中注文モニタ (2026-07-12)
// 全サークルの未完了注文 (pending/preparing) を古い順で返す。フロントが経過時間から
// 遅延・滞留を判定してアラート表示する。event_manager(order:read) 権限が必要。
eventRoutes.get("/:id/orders/live", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  if (!(await hasPermission(c, null, "order:read", eventId))) {
    apiError("FORBIDDEN", "このイベントの注文を閲覧する権限がありません");
  }

  const circles = await db
    .select({ id: circle.id, name: circle.name })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const circleIds = circles.map((c2) => c2.id);
  const circleName = new Map(circles.map((c2) => [c2.id, c2.name]));

  const active = circleIds.length
    ? await db
        .select()
        .from(order)
        .where(and(inArray(order.circleId, circleIds), inArray(order.status, ["pending", "preparing"])))
    : [];

  // 注文一覧の行は簡潔に保ち、タップ時の詳細には注文時点の商品名・単価を返す。
  const activeOrderIds = active.map((row) => row.id);
  const lineItems = activeOrderIds.length
    ? await db
        .select({
          id: orderItem.id,
          orderId: orderItem.orderId,
          name: orderItem.menuName,
          quantity: orderItem.quantity,
          unitPrice: orderItem.menuPrice,
        })
        .from(orderItem)
        .where(inArray(orderItem.orderId, activeOrderIds))
    : [];
  const lineItemIds = lineItems.map((item) => item.id);
  const toppings = lineItemIds.length
    ? await db
        .select({ orderItemId: orderItemTopping.orderItemId, name: orderItemTopping.toppingName, unitPrice: orderItemTopping.toppingPrice })
        .from(orderItemTopping)
        .where(inArray(orderItemTopping.orderItemId, lineItemIds))
    : [];
  const toppingsByItem = new Map<string, typeof toppings>();
  for (const topping of toppings) {
    const items = toppingsByItem.get(topping.orderItemId) ?? [];
    items.push(topping);
    toppingsByItem.set(topping.orderItemId, items);
  }
  const itemsByOrder = new Map<string, typeof lineItems>();
  for (const item of lineItems) {
    const items = itemsByOrder.get(item.orderId) ?? [];
    items.push(item);
    itemsByOrder.set(item.orderId, items);
  }

  const rows = active
    .map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      circleId: o.circleId,
      circleName: circleName.get(o.circleId) || "",
      status: o.status,
      peopleCount: o.peopleCount,
      totalPrice: o.totalPrice,
      estimatedTime: o.estimatedTime,
      createdAt: o.createdAt,
      items: (itemsByOrder.get(o.id) ?? []).map(({ id, ...item }) => ({
        ...item,
        toppings: toppingsByItem.get(id) ?? [],
      })),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return c.json(rows);
});

// 契約状況の照会 (2026-07-16)。オーナー(event_manager)が自分の契約を確認するための読み取り専用API。
// 運営専用の contractNotes(運営メモ) と入金記録者(recordedBy) は返さない = テナントには非公開。
// 変更は運営 (super_admin の契約管理) 側でのみ行うため、ここに更新系は置かない。
eventRoutes.get("/:id/contract", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");

  if (!(await hasPermission(c, null, "event:read", eventId))) {
    apiError("FORBIDDEN", "契約状況を参照する権限がありません");
  }

  const rows = await db.select().from(event).where(eq(event.id, eventId));
  if (rows.length === 0) {
    apiError("NOT_FOUND", "イベントが見つかりません");
  }
  const e = rows[0]!;

  // 上限に対する現在のサークル数 (論理削除は除外)。
  const circles = await db
    .select({ id: circle.id })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));

  const payments = await db
    .select()
    .from(contractPayment)
    .where(eq(contractPayment.eventId, eventId))
    .orderBy(desc(contractPayment.paidAt));

  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);

  return c.json({
    eventId: e.id,
    eventName: e.eventName,
    plan: e.plan,
    billingStatus: e.billingStatus,
    billingAmount: e.billingAmount,
    nextBillingAt: e.nextBillingAt,
    maxCircles: e.maxCircles,
    circleCount: circles.length,
    activatedAt: e.activatedAt,
    suspendedAt: e.suspendedAt,
    lifecycleStatus: e.lifecycleStatus,
    paidTotal,
    // 残額 (契約金額 - 入金合計)。マイナスにはしない。
    outstanding: Math.max(0, (e.billingAmount ?? 0) - paidTotal),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      paidAt: p.paidAt,
      note: p.note,
    })),
  });
});

// 開催ライフサイクル状態の変更 (2026-07-15)。event_manager(event:write)。
// 注文可否 (live のみ可) や来場者/ダッシュボードの表示モードの正本になる。
eventRoutes.put(
  "/:id/lifecycle-status",
  zBody(z.object({ status: z.enum(["upcoming", "live", "ended", "archived"]) })),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    // allowWhenClosed: 終了/保持中は閲覧のみモードで event:write が落ちるため、
    // この経路だけゲートを外す (そうしないと「開催中」に戻せずロックアウトする)。
    if (!(await hasPermission(c, null, "event:write", eventId, { allowWhenClosed: true }))) {
      apiError("FORBIDDEN", "イベントの状態を変更する権限がありません");
    }
    await db
      .update(event)
      .set({ lifecycleStatus: c.req.valid("json").status })
      .where(eq(event.id, eventId));
    return c.json({ success: true });
  }
);

// 抽選機能の有効化トグル (2026-07-12)。event_manager(event:write)。
eventRoutes.put(
  "/:id/lottery-enabled",
  zBody(z.object({ enabled: z.boolean() })),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    if (!(await hasPermission(c, null, "event:write", eventId))) {
      apiError("FORBIDDEN", "抽選機能を設定する権限がありません");
    }
    await db.update(event).set({ lotteryEnabled: c.req.valid("json").enabled }).where(eq(event.id, eventId));
    return c.json({ success: true });
  }
);

// 高度な権限管理の切り替え (2026-10-05)。event_manager(event:write)。
// OFF (既定) ではサークル所属の全員が circle_manager 相当、ON で circle_manager/circle_staff の
// 権限差を適用する。membership.role は書き換えず、判定時に実効ロールを求めるだけなので、
// ON に戻せば元の区別がそのまま復活する。
eventRoutes.put(
  "/:id/advanced-permissions",
  zBody(z.object({ enabled: z.boolean() })),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    if (!(await hasPermission(c, null, "event:write", eventId))) {
      apiError("FORBIDDEN", "権限管理の設定を変更する権限がありません");
    }
    await db
      .update(event)
      .set({ advancedPermissions: c.req.valid("json").enabled })
      .where(eq(event.id, eventId));
    return c.json({ success: true });
  }
);

// 日次締め (2026-07-12)
// 指定日(JST)の売上を、支払い方法別・サークル別に集計して返す。日々の精算・引き継ぎ用。
// date 省略時は本日(JST)。event_manager(sales:read) 権限。
eventRoutes.get("/:id/daily-close", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  if (!(await hasPermission(c, null, "sales:read", eventId))) {
    apiError("FORBIDDEN", "このイベントの売上を閲覧する権限がありません");
  }

  // 対象日の JST 0:00〜翌0:00 を UTC ミリ秒レンジに変換する。
  const dateStr = c.req.query("date"); // YYYY-MM-DD
  const base = dateStr ? new Date(`${dateStr}T00:00:00+09:00`) : new Date();
  const jstMidnight = dateStr
    ? base.getTime()
    : // 本日: 現在時刻を JST 日付の 0:00 に丸める
      new Date(new Date(base.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) + "T00:00:00+09:00").getTime();
  const dayStart = jstMidnight;
  const dayEnd = dayStart + 24 * 3600 * 1000;
  const resolvedDate = new Date(dayStart + 9 * 3600 * 1000).toISOString().slice(0, 10);

  const circles = await db
    .select({ id: circle.id, name: circle.name })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const circleIds = circles.map((c2) => c2.id);
  const circleName = new Map(circles.map((c2) => [c2.id, c2.name]));

  const orders = circleIds.length
    ? await db.select().from(order).where(inArray(order.circleId, circleIds))
    : [];
  // 2026-10-22: 日次精算は注文受付日ではなく入金日で締め、旧会計済み注文だけ作成日へフォールバックする。
  // 2026-10-22: 返金後も元の入金を売上履歴に残し、返金日側で別取引として差し引く。
  const dayOrders = orders.filter((o) => {
    const settledAt = (o.paidAt ?? o.createdAt).getTime();
    // 2026-10-22: 旧取消注文には返金記録がないため、入金済みとも返金済みとも推定しない。
    const isRecordedSettlement = o.paymentStatus === "refunded" ||
      (o.paymentStatus === "paid" && o.status !== "cancelled");
    return isRecordedSettlement && settledAt >= dayStart && settledAt < dayEnd;
  });
  const dayRefunds = circleIds.length
    ? await db.select({
        circleId: order.circleId,
        amount: orderRefund.amount,
        originalPaymentMethod: orderRefund.originalPaymentMethod,
        refundedAt: orderRefund.refundedAt,
      }).from(orderRefund)
        .innerJoin(order, eq(orderRefund.orderId, order.id))
        .where(and(
          inArray(order.circleId, circleIds),
          gte(orderRefund.refundedAt, new Date(dayStart)),
          lt(orderRefund.refundedAt, new Date(dayEnd)),
        ))
    : [];

  const payAgg = new Map<string, { orders: number; revenue: number }>();
  const circleAgg = new Map<string, { orders: number; grossRevenue: number; refundAmount: number; refundedOrders: number }>();
  for (const o of dayOrders) {
    const pk = o.paymentMethod || "未設定";
    const pa = payAgg.get(pk) || { orders: 0, revenue: 0 };
    pa.orders += 1;
    pa.revenue += o.totalPrice;
    payAgg.set(pk, pa);
    const ca = circleAgg.get(o.circleId) || { orders: 0, grossRevenue: 0, refundAmount: 0, refundedOrders: 0 };
    ca.orders += 1;
    ca.grossRevenue += o.totalPrice;
    circleAgg.set(o.circleId, ca);
  }
  const refundAgg = new Map<string, { orders: number; amount: number }>();
  for (const refund of dayRefunds) {
    const method = refund.originalPaymentMethod || "未設定";
    const agg = refundAgg.get(method) || { orders: 0, amount: 0 };
    agg.orders += 1;
    agg.amount += refund.amount;
    refundAgg.set(method, agg);
    const ca = circleAgg.get(refund.circleId) || { orders: 0, grossRevenue: 0, refundAmount: 0, refundedOrders: 0 };
    ca.refundAmount += refund.amount;
    ca.refundedOrders += 1;
    circleAgg.set(refund.circleId, ca);
  }
  const grossRevenue = dayOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  const refundAmount = dayRefunds.reduce((sum, refund) => sum + refund.amount, 0);

  return c.json({
    date: resolvedDate,
    totals: {
      orders: dayOrders.length,
      grossRevenue,
      refundOrders: dayRefunds.length,
      refundAmount,
      revenue: grossRevenue - refundAmount,
      customers: dayOrders.reduce((s, o) => s + o.peopleCount, 0),
    },
    paymentBreakdown: Array.from(payAgg.entries())
      .map(([method, a]) => ({ method, ...a }))
      .sort((a, b) => b.revenue - a.revenue),
    refundBreakdown: Array.from(refundAgg.entries())
      .map(([method, a]) => ({ method, ...a }))
      .sort((a, b) => b.amount - a.amount),
    circleBreakdown: Array.from(circleAgg.entries())
      .map(([id, a]) => ({
        circleId: id,
        name: circleName.get(id) || "",
        ...a,
        revenue: a.grossRevenue - a.refundAmount,
      }))
      .sort((a, b) => b.revenue - a.revenue),
  });
});

// イベントの支払い方法設定 (2026-07-12)
// event_manager が「このイベントで使える支払い方法」の一覧を設定する。
// 各サークルはこの中から対応する方法を選ぶ (circle.settings.acceptedPayments)。
eventRoutes.put(
  "/:id/payment-methods",
  zBody(z.object({ paymentMethods: z.array(z.string().min(1).max(30)).min(1).max(20) })),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    if (!(await hasPermission(c, null, "event:write", eventId))) {
      apiError("FORBIDDEN", "支払い方法を設定する権限がありません");
    }
    const { paymentMethods } = c.req.valid("json");
    // 重複除去 + トリム
    const cleaned = Array.from(new Set(paymentMethods.map((m) => m.trim()).filter(Boolean)));
    if (cleaned.length === 0) apiError("BAD_REQUEST", "支払い方法を1つ以上指定してください");
    await db
      .update(event)
      .set({ paymentMethods: JSON.stringify(cleaned) })
      .where(eq(event.id, eventId));
    return c.json({ success: true, paymentMethods: cleaned });
  }
);

// 2026-10-16 (#126): イベント共通の店舗エリア名を保存し、各サークルの位置選択肢に使う。
eventRoutes.put(
  "/:id/store-areas",
  zBody(z.object({ storeAreas: storeAreasSchema })),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    if (!(await hasPermission(c, null, "event:write", eventId))) {
      apiError("FORBIDDEN", "店舗エリアを設定する権限がありません");
    }
    const { storeAreas } = c.req.valid("json");
    const [currentEvent] = await db.select({
      storeAreas: event.storeAreas,
      stampRallySettings: event.stampRallySettings,
    }).from(event).where(and(eq(event.id, eventId), isNull(event.deletedAt))).limit(1);
    if (!currentEvent) apiError("NOT_FOUND", "イベントが見つかりません");

    const nextAreaIds = new Set(storeAreas.map((area) => area.id));
    let removedAreaIds: string[] = [];
    try {
      const parsed: unknown = JSON.parse(currentEvent.storeAreas || "[]");
      if (Array.isArray(parsed)) {
        removedAreaIds = parsed
          .filter((area): area is { id: string } => !!area && typeof area === "object" && typeof area.id === "string")
          .map((area) => area.id)
          .filter((id) => !nextAreaIds.has(id));
      }
    } catch {
      removedAreaIds = [];
    }

    if (removedAreaIds.length > 0) {
      let activeTargetAreaIds: string[] = [];
      try {
        const settings = JSON.parse(currentEvent.stampRallySettings || "{}") as { enabled?: unknown; targetAreaIds?: unknown };
        if (settings.enabled === true && Array.isArray(settings.targetAreaIds)) {
          activeTargetAreaIds = settings.targetAreaIds.filter((id): id is string => typeof id === "string");
        }
      } catch {
        activeTargetAreaIds = [];
      }
      const removesActiveTarget = removedAreaIds.some((id) => activeTargetAreaIds.includes(id));
      const activeCircles = await db.select({ settings: circle.settings }).from(circle).where(and(
        eq(circle.eventId, eventId),
        isNull(circle.deletedAt),
      ));
      const removesCircleLocation = activeCircles.some((row) => {
        try {
          const settings = JSON.parse(row.settings || "{}") as { storeAreaId?: unknown };
          return typeof settings.storeAreaId === "string" && removedAreaIds.includes(settings.storeAreaId);
        } catch {
          return false;
        }
      });
      if (removesActiveTarget || removesCircleLocation) {
        apiError("CONFLICT", "スタンプラリー対象または出店場所で使用中のエリアです。先に設定を変更してください");
      }
    }

    await db.update(event)
      .set({ storeAreas: JSON.stringify(storeAreas) })
      .where(and(eq(event.id, eventId), isNull(event.deletedAt)));
    return c.json({ success: true, storeAreas });
  }
);

// イベント内スタッフへの一斉アナウンス (2026-07-12)
// イベント配下の全メンバー (イベントスタッフ + 全サークルのスタッフ) に通知を作成する。
// スタッフは既存の通知センター(ヘッダーのベル)で受け取る。event_manager(member:write) 権限。
eventRoutes.post(
  "/:id/announce",
  zBody(
    z.object({
      title: z.string().min(1, "タイトルは必須です").max(120),
      message: z.string().min(1, "本文は必須です").max(2000),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("id");
    if (!(await hasPermission(c, null, "member:write", eventId))) {
      apiError("FORBIDDEN", "このイベントでアナウンスする権限がありません");
    }
    const input = c.req.valid("json");

    // 2026-07-16: 履歴テーブル(event_announcement)に senderEmail を残すためセッションを取得。
    // hasPermission が既にセッション存在を前提にしているのでここでは非nullとして扱える。
    const session = await getSession(c);
    const senderEmail = session!.user.email.toLowerCase();

    const events = await db.select().from(event).where(eq(event.id, eventId));
    if (events.length === 0) apiError("NOT_FOUND", "イベントが見つかりません");
    const eventName = events[0]!.eventName;

    // 配下サークル
    const circles = await db
      .select({ id: circle.id })
      .from(circle)
      .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
    const circleIds = circles.map((c2) => c2.id);

    // イベント直属 + 配下サークルの有効メンバーを集める (drizzle の or を避け2クエリ統合)。
    const eventMembers = await db
      .select({ userEmail: membership.userEmail })
      .from(membership)
      .where(and(eq(membership.eventId, eventId), eq(membership.isActive, true)));
    const circleMembers = circleIds.length
      ? await db
          .select({ userEmail: membership.userEmail })
          .from(membership)
          .where(and(inArray(membership.circleId, circleIds), eq(membership.isActive, true)))
      : [];

    const emails = new Set<string>();
    for (const m of [...eventMembers, ...circleMembers]) {
      if (m.userEmail) emails.add(m.userEmail.toLowerCase());
    }

    let sent = 0;
    for (const email of emails) {
      await db.insert(notification).values({
        id: ulid(),
        userEmail: email,
        title: input.title,
        message: input.message,
        type: "announcement",
        status: "unread",
        eventName,
        createdAt: new Date(),
      });
      sent += 1;
    }

    // 送信履歴を記録する (2026-07-16)。理由は eventAnnouncement テーブル定義のコメントを参照。
    const announcementId = ulid();
    await db.insert(eventAnnouncement).values({
      id: announcementId,
      eventId,
      title: input.title,
      message: input.message,
      senderEmail,
      recipientCount: sent,
      createdAt: new Date(),
    });

    // 2026-10-21: スタッフの既存通知に加えて来場者の履歴とPushへ配信する。外部Pushの遅延は告知APIを待たせない。
    const fanout = async () => {
      const visitors = await db.select({ id: eventUser.id, eventId: eventUser.eventId })
        .from(eventUser)
        .where(and(eq(eventUser.eventId, eventId), eq(eventUser.status, "available")));
      await notifyVisitors(db, c.env, visitors, {
        type: "event_announcement",
        title: input.title,
        message: input.message,
        href: "/visitor/notifications",
        dedupeKey: (visitorId) => `event-announcement:${announcementId}:${visitorId}`,
      }, {
        title: input.title,
        body: input.message,
        url: "/visitor/notifications",
        tag: `event-announcement-${announcementId}`,
      });
      await sendPushToTargets(db, c.env, [...emails].map((ownerId) => ({ ownerType: "staff" as const, ownerId })), {
        title: input.title,
        body: input.message,
        url: "/",
        tag: `event-announcement-${announcementId}`,
      });
    };
    c.executionCtx.waitUntil(fanout().catch(() => console.warn("event_announcement_fanout_failed")));

    return c.json({ sent });
  }
);

// 一斉アナウンスの送信履歴一覧 (2026-07-16)。過去に送ったアナウンスを新しい順に返す。
// event_manager (member:read) 権限。
eventRoutes.get("/:id/announcements", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  const includeDeleted = c.req.query("includeDeleted") === "true";
  if (!(await hasPermission(c, null, "member:read", eventId))) {
    apiError("FORBIDDEN", "このイベントのアナウンス履歴を見る権限がありません");
  }
  if (includeDeleted && !(await hasPermission(c, null, "member:write", eventId))) {
    apiError("FORBIDDEN", "削除済みアナウンスを表示する権限がありません");
  }

  const rows = await db
    .select()
    .from(eventAnnouncement)
    .where(and(eq(eventAnnouncement.eventId, eventId), includeDeleted ? undefined : isNull(eventAnnouncement.deletedAt)))
    .orderBy(desc(eventAnnouncement.createdAt));

  return c.json(rows);
});

// 一斉アナウンス履歴の論理削除。既に配信済みの通知は受信者側に残す。event_manager (member:write) 権限。
eventRoutes.delete("/:id/announcements/:announcementId", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  const announcementId = c.req.param("announcementId");
  if (!(await hasPermission(c, null, "member:write", eventId))) {
    apiError("FORBIDDEN", "このイベントのアナウンス履歴を削除する権限がありません");
  }

  await db.update(eventAnnouncement).set({ deletedAt: new Date() }).where(and(
    eq(eventAnnouncement.id, announcementId),
    eq(eventAnnouncement.eventId, eventId),
    isNull(eventAnnouncement.deletedAt),
  ));

  return c.json({ success: true });
});

// 2026-10-21: 送信履歴を再表示しても受信者の通知状態や配信結果は変更しない。
eventRoutes.post("/:id/announcements/:announcementId/restore", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  const announcementId = c.req.param("announcementId");
  if (!(await hasPermission(c, null, "member:write", eventId))) {
    apiError("FORBIDDEN", "このイベントのアナウンス履歴を復元する権限がありません");
  }
  await db.update(eventAnnouncement).set({ deletedAt: null }).where(and(
    eq(eventAnnouncement.id, announcementId),
    eq(eventAnnouncement.eventId, eventId),
    isNotNull(eventAnnouncement.deletedAt),
  ));

  return c.json({ success: true });
});

// イベント横断の在庫/売り切れ一覧 (2026-07-12)
// 全サークルのメニューを在庫状況付きで返す。フロントが売り切れ/在庫僅少を強調表示する。
// event_manager(stock:read) 権限が必要。
eventRoutes.get("/:id/inventory", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  if (!(await hasPermission(c, null, "stock:read", eventId))) {
    apiError("FORBIDDEN", "このイベントの在庫を閲覧する権限がありません");
  }

  const circles = await db
    .select({ id: circle.id, name: circle.name, settings: circle.settings })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const circleIds = circles.map((c2) => c2.id);
  const circleName = new Map(circles.map((c2) => [c2.id, c2.name]));
  // 在庫管理拡張がONのサークルだけ在庫数(残N/僅少)が意味を持つ。OFFのサークルは売切のみ扱う。
  const stockManaged = new Map(
    circles.map((c2) => {
      let on = false;
      try {
        on = JSON.parse(c2.settings || "{}")?.extensions?.stock === true;
      } catch {
        /* 壊れた settings は未管理扱い */
      }
      return [c2.id, on];
    })
  );

  const menus = circleIds.length
    ? await db
        .select({
          id: menu.id,
          circleId: menu.circleId,
          name: menu.name,
          price: menu.price,
          soldOut: menu.soldOut,
          stockQuantity: menu.stockQuantity,
        })
        .from(menu)
        .where(inArray(menu.circleId, circleIds))
    : [];

  return c.json(
    menus
      .map((m) => ({
        ...m,
        circleName: circleName.get(m.circleId) || "",
        stockManaged: stockManaged.get(m.circleId) ?? false,
      }))
      .sort((a, b) => a.circleName.localeCompare(b.circleName) || a.name.localeCompare(b.name))
  );
});

// 来場者一覧取得 (CSVエクスポート等のデータ用。2026-07-13)
// member:read 権限（イベントスタッフ権限）が必要。
eventRoutes.get("/:id/visitors", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");

  if (!(await hasPermission(c, null, "member:read", eventId))) {
    apiError("FORBIDDEN", "このイベントの来場者一覧を閲覧する権限がありません");
  }

  const visitors = await db
    .select()
    .from(eventUser)
    .where(eq(eventUser.eventId, eventId))
    .orderBy(desc(eventUser.createdAt));

  return c.json(visitors);
});

// イベント統計・分析 (2026-07-12)
// 2026-10-25: 全期間レポートは大規模イベントでもWorkerに全行を載せないよう、D1側で集計する。
// event_manager (sales:read) 権限が必要。
eventRoutes.get("/:id/analytics", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");
  if (!(await hasPermission(c, null, "sales:read", eventId))) {
    apiError("FORBIDDEN", "このイベントの統計を閲覧する権限がありません");
  }

  const query = async <T>(statement: string) => {
    const result = await db.$client.prepare(statement).bind(eventId).all<T>();
    return result.results ?? [];
  };
  type Group = {
    circle_id: string; status: string; payment_status: string; payment_method: string | null;
    completed: number; hour: number; count: number;
    amount: number | string | null; people: number | string | null;
  };
  type Refund = { circle_id: string; payment_method: string | null; hour: number; count: number; amount: number | string | null };
  type CircleRow = { id: string; name: string };
  type Review = { circle_id: string; count: number; rating: number | string | null };
  type Age = { age_group: string | null; count: number };
  const orderHour = "CAST((COALESCE(o.paid_at, o.created_at) + 32400000) / 3600000 AS INTEGER) % 24";
  const refundHour = "CAST((r.refunded_at + 32400000) / 3600000 AS INTEGER) % 24";
  const visitorHour = "CAST((u.onboarded_at + 32400000) / 3600000 AS INTEGER) % 24";
  const [circles, orders, refunds, reviews, visitors, visitorHours, bandAges, fallbackAges, visits, menus] =
    await Promise.all([
      query<CircleRow>("SELECT id, name FROM circle WHERE event_id = ? AND deleted_at IS NULL"),
      query<Group>(
        "SELECT o.circle_id, o.status, o.payment_status, o.payment_method, o.completed, " +
        orderHour + " AS hour, COUNT(*) AS count, SUM(o.total_price) AS amount, " +
        "SUM(o.people_count) AS people FROM orders o JOIN circle c ON o.circle_id = c.id " +
        "WHERE c.event_id = ? AND c.deleted_at IS NULL " +
        "GROUP BY o.circle_id, o.status, o.payment_status, o.payment_method, o.completed, hour",
      ),
      query<Refund>(
        "SELECT o.circle_id, r.original_payment_method AS payment_method, " + refundHour +
        " AS hour, COUNT(*) AS count, SUM(r.amount) AS amount FROM order_refund r " +
        "JOIN orders o ON r.order_id = o.id JOIN circle c ON o.circle_id = c.id " +
        "WHERE c.event_id = ? AND c.deleted_at IS NULL " +
        "GROUP BY o.circle_id, r.original_payment_method, hour",
      ),
      query<Review>(
        "SELECT r.circle_id, COUNT(*) AS count, SUM(r.rating) AS rating FROM review r " +
        "JOIN circle c ON r.circle_id = c.id WHERE c.event_id = ? AND c.deleted_at IS NULL " +
        "GROUP BY r.circle_id",
      ),
      query<{ total: number; entered: number }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(onboarded_at IS NOT NULL), 0) AS entered " +
        "FROM event_user WHERE event_id = ?",
      ),
      query<{ hour: number; count: number }>(
        "SELECT " + visitorHour + " AS hour, COUNT(*) AS count FROM event_user u " +
        "WHERE u.event_id = ? AND u.onboarded_at IS NOT NULL GROUP BY hour",
      ),
      query<Age>(
        "SELECT w.age_group, COUNT(*) AS count FROM wristband w JOIN event_user u ON w.user_id = u.id " +
        "WHERE u.event_id = ? AND u.onboarded_at IS NOT NULL AND w.status IN ('active','smartphone') " +
        "GROUP BY w.age_group",
      ),
      query<Age>(
        "SELECT u.age_group, COUNT(*) AS count FROM event_user u WHERE u.event_id = ? " +
        "AND u.onboarded_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM wristband w " +
        "WHERE w.user_id = u.id AND w.status IN ('active','smartphone')) GROUP BY u.age_group",
      ),
      query<{ count: number; visitors: number }>(
        "SELECT COUNT(*) AS count, COUNT(DISTINCT v.event_user_id) AS visitors " +
        "FROM circle_visit v JOIN circle c ON v.circle_id = c.id " +
        "JOIN event_user u ON v.event_user_id = u.id WHERE c.event_id = ? " +
        "AND c.deleted_at IS NULL AND u.onboarded_at IS NOT NULL AND v.created_at >= u.onboarded_at",
      ),
      query<{ menu_name: string; quantity: number | string | null; revenue: number | string | null }>(
        "SELECT i.menu_name, SUM(i.quantity) AS quantity, SUM(i.menu_price * i.quantity) AS revenue " +
        "FROM order_item i JOIN orders o ON i.order_id = o.id JOIN circle c ON o.circle_id = c.id " +
        "WHERE c.event_id = ? AND c.deleted_at IS NULL AND o.payment_status = 'paid' " +
        "AND o.status != 'cancelled' GROUP BY i.menu_name ORDER BY quantity DESC LIMIT 20",
      ),
    ]);

  const asNumber = (value: number | string | null | undefined) => Number(value ?? 0);
  const circleStats = new Map(circles.map((row) => [row.id, {
    gross: 0, refunds: 0, orders: 0, rating: 0, reviews: 0,
  }]));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0, refunds: 0, visitors: 0 }));
  const paymentStats = new Map<string, { orders: number; revenue: number }>();
  const refundStats = new Map<string, { orders: number; amount: number }>();
  let liveOrderCount = 0;
  let completedCount = 0;
  let paidOrderCount = 0;
  let customers = 0;
  let grossRevenue = 0;
  for (const row of orders) {
    const count = asNumber(row.count);
    const amount = asNumber(row.amount);
    if (row.status !== "cancelled") {
      liveOrderCount += count;
      if (row.status === "completed" || row.completed) completedCount += count;
      if (row.payment_status === "paid") {
        paidOrderCount += count;
        customers += asNumber(row.people);
        const stats = circleStats.get(row.circle_id);
        if (stats) stats.orders += count;
      }
    }
    const settled = row.payment_status === "refunded" ||
      (row.payment_status === "paid" && row.status !== "cancelled");
    if (!settled) continue;
    grossRevenue += amount;
    byHour[row.hour]!.orders += count;
    byHour[row.hour]!.revenue += amount;
    const stats = circleStats.get(row.circle_id);
    if (stats) stats.gross += amount;
    const method = row.payment_method || "未設定";
    const payment = paymentStats.get(method) ?? { orders: 0, revenue: 0 };
    payment.orders += count;
    payment.revenue += amount;
    paymentStats.set(method, payment);
  }

  let refundAmount = 0;
  let refundCount = 0;
  for (const row of refunds) {
    const count = asNumber(row.count);
    const amount = asNumber(row.amount);
    refundCount += count;
    refundAmount += amount;
    byHour[row.hour]!.refunds += amount;
    const stats = circleStats.get(row.circle_id);
    if (stats) stats.refunds += amount;
    const method = row.payment_method || "未設定";
    const payment = refundStats.get(method) ?? { orders: 0, amount: 0 };
    payment.orders += count;
    payment.amount += amount;
    refundStats.set(method, payment);
  }

  let reviewCount = 0;
  let ratingTotal = 0;
  for (const row of reviews) {
    const count = asNumber(row.count);
    const rating = asNumber(row.rating);
    reviewCount += count;
    ratingTotal += rating;
    const stats = circleStats.get(row.circle_id);
    if (stats) { stats.reviews = count; stats.rating = rating; }
  }
  // 家族単位の年齢 fallback は、有効なバンドが1本もない入場済みアカウントだけに適用する。
  const ageCounts = new Map<string, number>();
  let visitorProfiles = 0;
  for (const row of [...bandAges, ...fallbackAges]) {
    const count = asNumber(row.count);
    visitorProfiles += count;
    const label = VISITOR_AGE_GROUPS.find((group) => group.value === row.age_group)?.label;
    if (label) ageCounts.set(label, (ageCounts.get(label) || 0) + count);
  }
  for (const row of visitorHours) byHour[row.hour]!.visitors = asNumber(row.count);

  const totalVisitors = asNumber(visitors[0]?.total);
  const enteredVisitors = asNumber(visitors[0]?.entered);
  const revenue = grossRevenue - refundAmount;
  const circleRanking = circles.map((row) => {
    const stats = circleStats.get(row.id)!;
    const net = stats.gross - stats.refunds;
    return {
      circleId: row.id, name: row.name, revenue: net, grossRevenue: stats.gross,
      refundAmount: stats.refunds, orders: stats.orders, reviews: stats.reviews,
      avgRating: stats.reviews ? Math.round((stats.rating / stats.reviews) * 10) / 10 : null,
    };
  }).sort((a, b) => b.revenue - a.revenue);
  const ageBuckets = VISITOR_AGE_GROUPS.map(({ label }) => label)
    .filter((label) => ageCounts.has(label))
    .map((label) => ({ label, count: ageCounts.get(label)! }));
  const paymentBreakdown = Array.from(paymentStats.entries())
    .map(([method, value]) => ({ method, ...value }))
    .sort((a, b) => b.revenue - a.revenue);
  const refundBreakdown = Array.from(refundStats.entries())
    .map(([method, value]) => ({ method, ...value }))
    .sort((a, b) => b.amount - a.amount);
  const visitCount = asNumber(visits[0]?.count);
  const visitingUsers = asNumber(visits[0]?.visitors);
  const entryRate = totalVisitors ? Math.round((enteredVisitors / totalVisitors) * 100) : 0;

  return c.json({
    totals: {
      visitors: enteredVisitors,
      visitorProfiles,
      preRegisteredAccounts: totalVisitors,
      entryRate,
      onboarded: enteredVisitors,
      onboardedRate: entryRate,
      orders: paidOrderCount,
      grossRevenue,
      refundOrders: refundCount,
      refundAmount,
      revenue,
      customers,
      avgSpend: customers ? Math.round(revenue / customers) : 0,
      circles: circles.length,
      reviews: reviewCount,
      avgRating: reviewCount ? Math.round((ratingTotal / reviewCount) * 10) / 10 : null,
      completedRate: liveOrderCount ? Math.round((completedCount / liveOrderCount) * 100) : 0,
      circleVisits: visitCount,
      visitingUsers,
    },
    byHour,
    circleRanking,
    menuRanking: menus.map((row) => ({
      menuName: row.menu_name, quantity: asNumber(row.quantity), revenue: asNumber(row.revenue),
    })),
    ageBuckets,
    paymentBreakdown,
    refundBreakdown,
  });
});

// 来場者行動・混雑・スタッフ分析 (2026-07-14)
// 既存の /analytics は売上/メニュー中心。こちらは「一人一人の行動ログ(注文・回遊・スタンプ・
// 受付時刻)」を横断して、時間帯混雑・滞在/回遊・購入ファネル・スタッフ配置負荷・動線といった
// "個票があるからこそ分かる" 指標を集計する。sales:read 権限が必要。
eventRoutes.get("/:id/behavior", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");

  if (!(await hasPermission(c, null, "sales:read", eventId))) {
    apiError("FORBIDDEN", "このイベントの分析を閲覧する権限がありません");
  }

  // 配下サークル (非削除)
  const circles = await db
    .select({ id: circle.id, name: circle.name })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const circleIds = circles.map((c2) => c2.id);
  const circleName = new Map(circles.map((c2) => [c2.id, c2.name]));

  // 行動ログを一括取得
  const orders = circleIds.length
    ? await db.select().from(order).where(inArray(order.circleId, circleIds))
    : [];
  const liveOrders = orders.filter((o) => o.status !== "cancelled");
  const paidOrders = liveOrders.filter((o) => o.paymentStatus === "paid");
  const accountRows = await db.select().from(eventUser).where(eq(eventUser.eventId, eventId));
  // 2026-10-19: 発行済みアカウント数ではなく、入場確定済みの家族アカウントを行動分析の母数にする。
  const visitors = accountRows.filter((visitor) => visitor.onboardedAt != null);
  const enteredAtByVisitor = new Map(
    visitors.map((visitor) => [visitor.id, visitor.onboardedAt!.getTime()] as const),
  );
  const allVisits = circleIds.length
    ? await db.select().from(circleVisit).where(inArray(circleVisit.circleId, circleIds))
    : [];
  const visits = allVisits.filter((visit) => {
    const enteredAt = enteredAtByVisitor.get(visit.eventUserId);
    return enteredAt !== undefined && visit.createdAt.getTime() >= enteredAt;
  });
  const allStamps = circleIds.length
    ? await db.select().from(userStamp).where(inArray(userStamp.circleId, circleIds))
    : [];
  const stamps = allStamps.filter((stamp) => {
    const enteredAt = enteredAtByVisitor.get(stamp.userId);
    return enteredAt !== undefined && stamp.createdAt.getTime() >= enteredAt;
  });
  // スタッフ人数はメンバーシップ(実アカウント)で数える。circle_manager + circle_staff。
  const staffMemberships = circleIds.length
    ? await db
        .select({ circleId: membership.circleId, role: membership.role, email: membership.userEmail })
        .from(membership)
        .where(and(inArray(membership.circleId, circleIds), eq(membership.isActive, true)))
    : [];

  const jstHour = (ms: number) => new Date(ms + 9 * 3600 * 1000).getUTCHours();

  // ── 1. ユーザー別ジャーニー集計 ─────────────────────────────
  // 各来場者の「注文数・消費額・関与サークル・最初/最後の活動時刻」をまとめる。
  type Journey = {
    orders: number;
    spend: number;
    circles: Set<string>;
    first: number; // 入場処理時刻
    last: number; // 最後の活動
  };
  const journeys = new Map<string, Journey>();
  const ensure = (uid: string, arrivalMs: number): Journey => {
    let j = journeys.get(uid);
    if (!j) {
      j = { orders: 0, spend: 0, circles: new Set(), first: arrivalMs, last: arrivalMs };
      journeys.set(uid, j);
    }
    return j;
  };
  // event_user.createdAt は事前発行時刻なので、入場確定時刻を滞在時間の起点にする。
  for (const v of visitors) {
    ensure(v.id, v.onboardedAt!.getTime());
  }
  const touch = (uid: string | null, circleId: string | null, ms: number, isOrder: boolean, spend: number) => {
    if (!uid) return;
    const enteredAt = enteredAtByVisitor.get(uid);
    if (enteredAt === undefined || ms < enteredAt) return;
    const j = ensure(uid, enteredAt);
    if (circleId) j.circles.add(circleId);
    if (ms > j.last) j.last = ms;
    if (isOrder) {
      j.orders += 1;
      j.spend += spend;
    }
  };
  // 2026-10-22: 未会計モバイル注文を購入転換・消費額へ含めない。厨房の完了率は注文の進行状況として別に数える。
  for (const o of paidOrders) touch(o.userId, o.circleId, o.createdAt.getTime(), true, o.totalPrice);
  for (const v of visits) touch(v.eventUserId, v.circleId, v.createdAt.getTime(), false, 0);
  for (const s of stamps) touch(s.userId, s.circleId, s.createdAt.getTime(), false, 0);

  // 2026-10-19: journey は入場処理済みアカウントだけから組み立てる。
  const jList = visitors
    .map((visitor) => journeys.get(visitor.id))
    .filter((journey): journey is Journey => journey !== undefined);
  const registeredVisitorIds = new Set(visitors.map((visitor) => visitor.id));
  const buyers = jList.filter((j) => j.orders > 0);
  const repeatBuyers = jList.filter((j) => j.orders >= 2);
  const multiCircle = jList.filter((j) => j.circles.size >= 2);
  // 滞在時間 (最後-最初) は「2つ以上の活動時刻がある」人のみ意味を持つ
  const stays = jList.map((j) => (j.last - j.first) / 60000).filter((m) => m > 0);
  const median = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
  };
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const journey = {
    visitors: visitors.length,
    buyers: buyers.length,
    buyerRate: visitors.length ? Math.round((buyers.length / visitors.length) * 100) : 0,
    avgOrdersPerBuyer: buyers.length ? Math.round((sum(buyers.map((b) => b.orders)) / buyers.length) * 10) / 10 : 0,
    avgSpendPerBuyer: buyers.length ? Math.round(sum(buyers.map((b) => b.spend)) / buyers.length) : 0,
    avgCirclesPerVisitor: visitors.length ? Math.round((sum(jList.map((j) => j.circles.size)) / visitors.length) * 10) / 10 : 0,
    repeatBuyerRate: buyers.length ? Math.round((repeatBuyers.length / buyers.length) * 100) : 0,
    multiCircleRate: visitors.length ? Math.round((multiCircle.length / visitors.length) * 100) : 0,
    avgStayMin: stays.length ? Math.round(sum(stays) / stays.length) : 0,
    medianStayMin: Math.round(median(stays)),
  };

  // ── 2. 滞在時間の分布 ────────────────────────────────────
  const stayBucketDefs = [
    { label: "〜30分", max: 30 },
    { label: "30〜60分", max: 60 },
    { label: "1〜2時間", max: 120 },
    { label: "2〜4時間", max: 240 },
    { label: "4時間〜", max: Infinity },
  ];
  const stayBuckets = stayBucketDefs.map((d) => ({ label: d.label, count: 0 }));
  for (const m of stays) {
    const idx = stayBucketDefs.findIndex((d) => m <= d.max);
    stayBuckets[idx]!.count += 1;
  }

  // ── 3. 回遊サークル数の分布 ──────────────────────────────
  const circleCountBuckets = [
    { label: "0 (未回遊)", count: 0 },
    { label: "1サークル", count: 0 },
    { label: "2サークル", count: 0 },
    { label: "3サークル", count: 0 },
    { label: "4サークル", count: 0 },
    { label: "5+サークル", count: 0 },
  ];
  for (const j of jList) {
    const n = Math.min(5, j.circles.size);
    circleCountBuckets[n]!.count += 1;
  }

  // ── 4. 時間帯別 混雑 × スタッフ稼働 ──────────────────────
  // activeUsers = その時間帯に何らかの活動(注文/回遊/スタンプ)をした一意来場者数。
  const hourUsers: Array<Set<string>> = Array.from({ length: 24 }, () => new Set<string>());
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    activeUsers: 0,
    orders: 0,
    revenue: 0,
    arrivals: 0,
  }));
  for (const o of liveOrders) {
    const h = jstHour(o.createdAt.getTime());
    byHour[h]!.orders += 1;
    byHour[h]!.revenue += o.totalPrice;
    const enteredAt = o.userId ? enteredAtByVisitor.get(o.userId) : undefined;
    if (o.userId && enteredAt !== undefined && o.createdAt.getTime() >= enteredAt) {
      hourUsers[h]!.add(o.userId);
    }
  }
  for (const v of visits) {
    if (registeredVisitorIds.has(v.eventUserId)) hourUsers[jstHour(v.createdAt.getTime())]!.add(v.eventUserId);
  }
  for (const s of stamps) {
    if (registeredVisitorIds.has(s.userId)) hourUsers[jstHour(s.createdAt.getTime())]!.add(s.userId);
  }
  for (const v of visitors) byHour[jstHour(v.onboardedAt!.getTime())]!.arrivals += 1;
  for (let h = 0; h < 24; h++) byHour[h]!.activeUsers = hourUsers[h]!.size;
  // 混雑のピーク時間帯 (activeUsers 最大)
  const peak = byHour.reduce((mx, r) => (r.activeUsers > mx.activeUsers ? r : mx), byHour[0]!);

  // ── 5. 購入ファネル (離脱の可視化) ───────────────────────
  const engaged = jList.filter((j) => j.circles.size > 0 || j.orders > 0).length;
  const funnel = [
    { stage: "入場処理済みアカウント", count: visitors.length },
    { stage: "回遊 (1+サークル)", count: engaged },
    { stage: "購入 (1+注文)", count: buyers.length },
    { stage: "リピート購入 (2+注文)", count: repeatBuyers.length },
  ];

  // ── 6. スタッフ配置 × 負荷 ───────────────────────────────
  const staffByCircle = new Map<string, number>();
  for (const id of circleIds) staffByCircle.set(id, 0);
  for (const m of staffMemberships) {
    if (m.circleId && (m.role === "circle_manager" || m.role === "circle_staff")) {
      staffByCircle.set(m.circleId, (staffByCircle.get(m.circleId) || 0) + 1);
    }
  }
  const ordersByCircle = new Map<string, { orders: number; revenue: number }>();
  for (const id of circleIds) ordersByCircle.set(id, { orders: 0, revenue: 0 });
  for (const o of liveOrders) {
    const a = ordersByCircle.get(o.circleId);
    if (a) {
      a.orders += 1;
      a.revenue += o.totalPrice;
    }
  }
  const staffing = {
    totalStaff: staffMemberships.filter((m) => m.role === "circle_manager" || m.role === "circle_staff").length,
    byCircle: circleIds
      .map((id) => {
        const st = staffByCircle.get(id) || 0;
        const a = ordersByCircle.get(id)!;
        return {
          circleId: id,
          name: circleName.get(id) || "",
          staff: st,
          orders: a.orders,
          revenue: a.revenue,
          // 1スタッフあたり注文数。スタッフ0なら null (未配置)。混雑と人手のミスマッチ検知用。
          ordersPerStaff: st > 0 ? Math.round((a.orders / st) * 10) / 10 : null,
        };
      })
      .sort((a, b) => (b.ordersPerStaff ?? -1) - (a.ordersPerStaff ?? -1)),
  };

  // ── 7. 動線 (回遊の遷移) ─────────────────────────────────
  // 各来場者の回遊(circleVisit)を時刻順に並べ、連続する A→B ペアを数える。
  // 「どのサークルからどのサークルへ人が流れているか」を可視化する。
  const visitsByUser = new Map<string, Array<{ circleId: string; ms: number }>>();
  for (const v of visits) {
    if (!registeredVisitorIds.has(v.eventUserId)) continue;
    const arr = visitsByUser.get(v.eventUserId) || [];
    arr.push({ circleId: v.circleId, ms: v.createdAt.getTime() });
    visitsByUser.set(v.eventUserId, arr);
  }
  const transitionAgg = new Map<string, number>();
  for (const arr of visitsByUser.values()) {
    arr.sort((a, b) => a.ms - b.ms);
    for (let i = 0; i + 1 < arr.length; i++) {
      const from = arr[i]!.circleId;
      const to = arr[i + 1]!.circleId;
      if (from === to) continue; // 同一サークルの連続は動線として数えない
      const key = `${from} ${to}`;
      transitionAgg.set(key, (transitionAgg.get(key) || 0) + 1);
    }
  }
  const topTransitions = Array.from(transitionAgg.entries())
    .map(([key, count]) => {
      const [from, to] = key.split(" ");
      return {
        from: circleName.get(from!) || "?",
        to: circleName.get(to!) || "?",
        count,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return c.json({
    journey,
    stayBuckets,
    circleCountBuckets,
    byHour,
    peakHour: peak.activeUsers > 0 ? peak.hour : null,
    funnel,
    staffing,
    topTransitions,
  });
});

// イベント作成 (2026-07-12 SaaS: セルフサービス化)
// 旧仕様は super_admin 限定だったが、SaaS 化に伴い「ログイン済みユーザーは誰でも
// 無料枠でイベントを主催できる」ように変更する (サークルのセルフ作成と同じ思想)。
// 作成と同時に本人が event_manager になり、無料枠 (plan=free, maxCircles=1) が付与される。
// プランのアップグレードは super_admin による手動有効化 (将来は Stripe) で行う。
eventRoutes.post(
  "/",
  zBody(
    z.object({
      eventName: z.string().min(1, "イベント名は必須です"),
      description: z.string().optional(),
      officialWebsiteUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), "公式サイトURLはhttpまたはhttpsで入力してください").nullable().optional(),
      logoUrl: z.string().nullable().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      hasPhysicalWristband: z.boolean().optional(),
      allowSelfIssue: z.boolean().optional(),
      fontFamily: z.enum(["mono", "sans", "serif"]).optional(),
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      primaryTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      accentTextColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      paymentMethods: z.array(z.string().trim().min(1).max(30)).min(1).max(20).default(["現金"]),
      storeAreas: storeAreasSchema.default([]),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const session = await getSession(c);
    if (!session || !session.user) {
      apiError("UNAUTHORIZED", "認証が必要です");
    }

    const input = c.req.valid("json");
    const id = ulid();
    const ownerEmail = session.user.email.toLowerCase();

    await db.insert(event).values({
      id,
      eventName: input.eventName,
      description: input.description?.trim() || null,
      officialWebsiteUrl: input.officialWebsiteUrl?.trim() || null,
      logoUrl: input.logoUrl || null,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
      hasPhysicalWristband: input.hasPhysicalWristband ?? true,
      allowSelfIssue: input.allowSelfIssue ?? true,
      fontFamily: input.fontFamily ?? "mono",
      primaryColor: input.primaryColor ?? "#000000",
      primaryTextColor: input.primaryTextColor ?? "#FFFFFF",
      accentColor: input.accentColor ?? "#0000FF",
      accentTextColor: input.accentTextColor ?? "#FFFFFF",
      backgroundColor: input.backgroundColor ?? "#FFFFFF",
      textColor: input.textColor ?? "#000000",
      paymentMethods: JSON.stringify(Array.from(new Set(input.paymentMethods.map((method) => method.trim())))),
      storeAreas: JSON.stringify(input.storeAreas),
      // 無料枠の既定値。plan/billingStatus/maxCircles はスキーマ default と同値だが、
      // 意図 (無料枠で有効化) を明示するため作成時に書き込む。
      plan: "free",
      billingStatus: "active",
      maxCircles: 1,
      ownerEmail,
      activatedAt: new Date(),
    });

    // 作成者を event_manager として所属させる (セルフサービス作成=作成者が主催者)。
    await db.insert(membership).values({
      id: ulid(),
      userEmail: ownerEmail,
      userName: session.user.name || `${input.eventName} 主催者`,
      eventId: id,
      role: "event_manager",
      isActive: true,
    });

    return c.json({ id }, 201);
  }
);

// イベント削除 (論理削除) — システム管理者(super_admin)のみ
eventRoutes.delete("/:id", async (c) => {
  const db = c.get("db");
  const session = await getAdminSession(c);
  if (!session) {
    apiError("FORBIDDEN", "管理者権限が必要です");
  }

  const id = c.req.param("id");
  const existing = await db
    .select({ deletedAt: event.deletedAt })
    .from(event)
    .where(eq(event.id, id));
  if (!existing[0]) apiError("NOT_FOUND", "イベントが見つかりません");
  // 2026-10-15 (#128): 子サークルにもイベントIDを記録し、後からイベントごと復元できるようにする。
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE event SET deleted_at=COALESCE(deleted_at, ?) WHERE id=?")
      .bind(Date.now(), id),
    c.env.DB.prepare(`UPDATE circle SET deleted_at=(SELECT deleted_at FROM event WHERE id=?), deleted_with_event_id=?
      WHERE event_id=? AND deleted_at IS NULL`)
      .bind(id, id, id),
  ]);
  return c.json({ success: true });
});

// テーマ・基本設定の更新
eventRoutes.put(
  "/:id/theme",
  zBody(
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
      officialWebsiteUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), "公式サイトURLはhttpまたはhttpsで入力してください").nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      hasPhysicalWristband: z.boolean().optional(),
      allowSelfIssue: z.boolean().optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    // 2026-10-16 (#126): 作成者の event_manager が設定画面から更新できるよう、イベント権限で認可する。
    if (!(await hasPermission(c, null, "event:write", id))) {
      apiError("FORBIDDEN", "このイベントの設定を変更する権限がありません");
    }
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


// 2026-07-07 (Phase 3a): サークルログイン (POST /login, イベント名+サークル名+パスワード)
// を廃止。並行認証系だった独自パスワード認証を撤去し、better-auth に一本化する
// (フロント側の呼び出し・ログインフォームは Phase 3b で対応する)。

export default eventRoutes;

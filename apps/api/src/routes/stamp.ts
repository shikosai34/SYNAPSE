import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  stampRallyRedemption,
  eventUser,
  wristband,
  event,
  circle,
  order,
  orderItem,
  orderItemTopping,
} from "@fesflow/db";
import { and, asc, desc, eq, isNull, like, ne, or, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { getSession, hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";
import { isEventDateExpired } from "../utils/event-date";
import {
  evaluateStampRallyQualification,
  requiredCirclesForArea,
  resolveStampRallyQualification,
} from "../lib/stamp-rally-qualification";

// 2026-07-08 (Phase5): db はモジュール Proxy ではなく c.get("db") で受け取る (ALS撤去)。
const stampRoutes = new Hono<AppEnv>();

type StoreArea = { id: string; name: string };
type StampRallyReward = { id: string; name: string; stockQuantity: number | null };
type StampRallySettings = {
  enabled: boolean;
  targetAreaIds: string[];
  qualification: ReturnType<typeof resolveStampRallyQualification>;
  rewardTitle: string;
  rewards: StampRallyReward[];
  redemptionLocation: string;
  rulesUrl: string;
};

function parseStoreAreas(raw: string | null | undefined): StoreArea[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((area): area is StoreArea =>
      !!area && typeof area === "object" &&
      typeof area.id === "string" && typeof area.name === "string" && area.name.trim().length > 0
    );
  } catch {
    return [];
  }
}

// 2026-10-20: 本番投入前に旧 areas[].circleIds 形式の解釈を終了し、現在の保存形式だけを読む。
function parseStampRallySettings(raw: string | null | undefined): StampRallySettings {
  const defaults: StampRallySettings = {
    enabled: false,
    targetAreaIds: [],
    qualification: resolveStampRallyQualification(null),
    rewardTitle: "景品交換",
    rewards: [{ id: "default", name: "景品交換", stockQuantity: null }],
    redemptionLocation: "",
    rulesUrl: "",
  };
  try {
    const value = JSON.parse(raw || "{}") as Record<string, unknown>;
    const rewardTitle = typeof value.rewardTitle === "string"
      ? value.rewardTitle
      : defaults.rewardTitle;
    const rewards = Array.isArray(value.rewards)
      ? value.rewards.flatMap((reward): StampRallyReward[] => {
          if (!reward || typeof reward !== "object") return [];
          const item = reward as Record<string, unknown>;
          if (typeof item.id !== "string" || typeof item.name !== "string" || !item.name.trim()) return [];
          return [{
            id: item.id,
            name: item.name.trim(),
            stockQuantity: Number.isInteger(item.stockQuantity) && Number(item.stockQuantity) >= 0
              ? Number(item.stockQuantity)
              : null,
          }];
        })
      : [{ id: "default", name: rewardTitle, stockQuantity: null }];
    const targetAreaIds = Array.isArray(value.targetAreaIds)
      ? value.targetAreaIds.filter((id): id is string => typeof id === "string")
      : [];
    return {
      enabled: value.enabled === true,
      targetAreaIds,
      qualification: resolveStampRallyQualification(value.qualification),
      rewardTitle,
      rewards: rewards.length > 0 ? rewards : [{ id: "default", name: rewardTitle, stockQuantity: null }],
      redemptionLocation: typeof value.redemptionLocation === "string"
        ? value.redemptionLocation
        : "",
      rulesUrl: typeof value.rulesUrl === "string" ? value.rulesUrl : "",
    };
  } catch {
    return defaults;
  }
}

function parseCircleStoreAreaId(raw: string | null | undefined): string | null {
  try {
    const settings = JSON.parse(raw || "{}") as { storeAreaId?: unknown };
    return typeof settings.storeAreaId === "string" ? settings.storeAreaId : null;
  } catch {
    return null;
  }
}

function toIsoDate(value: Date | number | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// 2026-10-21: 景品交換は終了状態・終了日時の両方で停止し、達成状況の閲覧は残す。
function isEventEnded(eventRow: { lifecycleStatus: string | null; endDate: Date | null }): boolean {
  return eventRow.lifecycleStatus === "ended" || eventRow.lifecycleStatus === "archived"
    || isEventDateExpired(eventRow.endDate);
}

async function resolveVisitor(db: AppEnv["Variables"]["db"], eventId: string, code: string) {
  const direct = await db.select({
    id: eventUser.id,
    eventId: eventUser.eventId,
    displayId: eventUser.displayId,
    nickname: eventUser.nickname,
  }).from(eventUser).where(and(
    eq(eventUser.id, code),
    eq(eventUser.eventId, eventId),
    eq(eventUser.status, "available"),
  )).limit(1);
  if (direct[0]) return direct[0];

  const banded = await db.select({
    id: eventUser.id,
    eventId: eventUser.eventId,
    displayId: eventUser.displayId,
    nickname: eventUser.nickname,
  }).from(wristband)
    .innerJoin(eventUser, eq(wristband.userId, eventUser.id))
    .where(and(
      eq(wristband.id, code),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
      eq(eventUser.eventId, eventId),
      eq(eventUser.status, "available"),
    )).limit(1);
  return banded[0] ?? null;
}

async function resolveVisitorFromAnyEvent(db: AppEnv["Variables"]["db"], code: string) {
  const direct = await db.select({
    id: eventUser.id,
    eventId: eventUser.eventId,
    displayId: eventUser.displayId,
    nickname: eventUser.nickname,
  }).from(eventUser).where(and(eq(eventUser.id, code), eq(eventUser.status, "available"))).limit(1);
  if (direct[0]) return direct[0];

  const banded = await db.select({
    id: eventUser.id,
    eventId: eventUser.eventId,
    displayId: eventUser.displayId,
    nickname: eventUser.nickname,
  }).from(wristband)
    .innerJoin(eventUser, eq(wristband.userId, eventUser.id))
    .where(and(
      eq(wristband.id, code),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
      eq(eventUser.status, "available"),
    )).limit(1);
  return banded[0] ?? null;
}

async function resolveVisitorFromCode(db: AppEnv["Variables"]["db"], code: string) {
  const direct = await db.select({ id: eventUser.id, eventId: eventUser.eventId })
    .from(eventUser).where(and(eq(eventUser.id, code), eq(eventUser.status, "available"))).limit(1);
  if (direct[0]) return direct[0];

  const banded = await db.select({ id: eventUser.id, eventId: eventUser.eventId })
    .from(wristband)
    .innerJoin(eventUser, eq(wristband.userId, eventUser.id))
    .where(and(
      eq(wristband.id, code),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
      eq(eventUser.status, "available"),
    )).limit(1);
  return banded[0] ?? null;
}

async function getRallyProgress(db: AppEnv["Variables"]["db"], eventId: string, eventUserId: string) {
  const eventRows = await db.select({
    stampRallySettings: event.stampRallySettings,
    storeAreas: event.storeAreas,
    lifecycleStatus: event.lifecycleStatus,
    endDate: event.endDate,
  }).from(event).where(and(eq(event.id, eventId), isNull(event.deletedAt))).limit(1);
  const eventRow = eventRows[0];
  if (!eventRow) return null;

  const settings = parseStampRallySettings(eventRow.stampRallySettings);
  // 2026-10-16: 1イベント来場者IDを共有する有効な家族バンド数を、世帯の交換上限として扱う。
  const familyRows = await db.select({ count: sql<number>`count(*)` }).from(wristband).where(and(
    eq(wristband.userId, eventUserId),
    or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
  ));
  const familyMemberCount = familyRows[0]?.count ?? 0;
  const configuredAreas = parseStoreAreas(eventRow.storeAreas);
  const circles = await db.select({
    id: circle.id,
    name: circle.name,
    iconImagePath: circle.iconImagePath,
    settings: circle.settings,
  }).from(circle).where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const validTargetAreaIds = settings.targetAreaIds.filter((id) => configuredAreas.some((area) => area.id === id));
  const targetCircleIds = circles.filter((row) => validTargetAreaIds.includes(parseCircleStoreAreaId(row.settings) || ""))
    .map((row) => row.id);
  const uniqueTargetCircleIds = [...new Set(targetCircleIds)];
  // 2026-10-15 (#123): 店舗数が多いイベントでもD1の bind 上限を超えないよう、
  // 対象ID一覧を JSON 1引数で渡してSQL側で照合する。
  const targetCircleFilter = sql`${circle.id} in (select value from json_each(${JSON.stringify(uniqueTargetCircleIds)}))`;
  // 2026-10-22: スタンプは店頭会計済みの購入にだけ付与する。
  const completedOrders = uniqueTargetCircleIds.length > 0
    ? await db.select({
        id: order.id,
        circleId: order.circleId,
        orderNumber: order.orderNumber,
        completedAt: order.completedAt,
        createdAt: order.createdAt,
      }).from(order).innerJoin(circle, eq(order.circleId, circle.id)).where(and(
        eq(order.userId, eventUserId),
        eq(circle.eventId, eventId),
        isNull(circle.deletedAt),
        targetCircleFilter,
        eq(order.paymentStatus, "paid"),
        ne(order.status, "cancelled"),
        or(eq(order.status, "completed"), eq(order.completed, true)),
      ))
    : [];
  const stampedCircleIds = [...new Set(completedOrders.map((row) => row.circleId))];
  const stamped = new Set(stampedCircleIds);

  // 2026-10-15 (#123): スタンプ詳細には注文作成時点のスナップショットを返し、
  // 来場者が各サークルで購入した品目を短いモーダル内で確認できるようにする。
  const completedOrderIds = completedOrders.map((row) => row.id);
  const itemRows = completedOrderIds.length > 0
    ? await db.select({
        id: orderItem.id,
        orderId: orderItem.orderId,
        menuName: orderItem.menuName,
        quantity: orderItem.quantity,
      }).from(orderItem).innerJoin(order, eq(orderItem.orderId, order.id))
        .innerJoin(circle, eq(order.circleId, circle.id)).where(and(
        eq(order.userId, eventUserId),
        eq(circle.eventId, eventId),
        isNull(circle.deletedAt),
        targetCircleFilter,
        eq(order.paymentStatus, "paid"),
        ne(order.status, "cancelled"),
        or(eq(order.status, "completed"), eq(order.completed, true)),
      ))
    : [];
  const toppingRows = completedOrderIds.length > 0
    ? await db.select({
        orderItemId: orderItemTopping.orderItemId,
        name: orderItemTopping.toppingName,
      }).from(orderItemTopping)
        .innerJoin(orderItem, eq(orderItemTopping.orderItemId, orderItem.id))
        .innerJoin(order, eq(orderItem.orderId, order.id))
        .innerJoin(circle, eq(order.circleId, circle.id)).where(and(
          eq(order.userId, eventUserId),
          eq(circle.eventId, eventId),
          isNull(circle.deletedAt),
          targetCircleFilter,
          eq(order.paymentStatus, "paid"),
          ne(order.status, "cancelled"),
          or(eq(order.status, "completed"), eq(order.completed, true)),
        ))
    : [];
  const toppingsByItem = new Map<string, string[]>();
  for (const row of toppingRows) {
    const toppings = toppingsByItem.get(row.orderItemId) ?? [];
    toppings.push(row.name);
    toppingsByItem.set(row.orderItemId, toppings);
  }
  const itemsByOrder = new Map<string, Array<{ menuName: string; quantity: number; toppings: string[] }>>();
  for (const row of itemRows) {
    const items = itemsByOrder.get(row.orderId) ?? [];
    items.push({ menuName: row.menuName, quantity: row.quantity, toppings: toppingsByItem.get(row.id) ?? [] });
    itemsByOrder.set(row.orderId, items);
  }
  const ordersByCircle = new Map<string, Array<{
    orderNumber: string;
    completedAt: Date | null;
    createdAt: Date;
    items: Array<{ menuName: string; quantity: number; toppings: string[] }>;
  }>>();
  for (const row of completedOrders) {
    const orders = ordersByCircle.get(row.circleId) ?? [];
    orders.push({
      orderNumber: row.orderNumber,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      items: itemsByOrder.get(row.id) ?? [],
    });
    ordersByCircle.set(row.circleId, orders);
  }
  for (const orders of ordersByCircle.values()) {
    orders.sort((a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime());
  }

  const circleProgress = (row: typeof circles[number]) => ({
    id: row.id,
    name: row.name,
    iconImagePath: row.iconImagePath,
    stamped: stamped.has(row.id),
    orders: ordersByCircle.get(row.id) ?? [],
  });

  const areas = configuredAreas.filter((area) => validTargetAreaIds.includes(area.id)).map((area) => ({
        id: area.id,
        name: area.name,
        requiredCount: settings.qualification.minQualifiedAreaCount === null
          ? null
          : requiredCirclesForArea(settings.qualification, area.id),
        circles: circles
          .filter((row) => parseCircleStoreAreaId(row.settings) === area.id)
          .map(circleProgress),
      }));

  const stampedCountByArea = new Map(areas.map((area) => [
    area.id,
    area.circles.filter((item) => item.stamped).length,
  ]));
  const qualificationProgress = evaluateStampRallyQualification({
    qualification: settings.qualification,
    targetAreaIds: validTargetAreaIds,
    stampedCountByArea,
    totalStampedCircleCount: stampedCircleIds.length,
  });
  const isQualified = settings.enabled && qualificationProgress.eligible;
  const redemptionTotals = await db.select({
    quantity: sql<number>`coalesce(sum(${stampRallyRedemption.quantity}), 0)`,
  })
    .from(stampRallyRedemption).where(and(
      eq(stampRallyRedemption.eventId, eventId),
      eq(stampRallyRedemption.eventUserId, eventUserId),
    ));
  const latestRedemptions = redemptionTotals[0]?.quantity
    ? await db.select({ createdAt: stampRallyRedemption.createdAt }).from(stampRallyRedemption).where(and(
        eq(stampRallyRedemption.eventId, eventId),
        eq(stampRallyRedemption.eventUserId, eventUserId),
      )).orderBy(desc(stampRallyRedemption.createdAt)).limit(1)
    : [];
  const redeemedCount = redemptionTotals[0]?.quantity ?? 0;
  const remainingCount = Math.max(0, familyMemberCount - redeemedCount);

  return {
    enabled: settings.enabled && validTargetAreaIds.length > 0,
    eventEnded: isEventEnded(eventRow),
    areas,
    stampedCircleIds,
    stampedCount: stampedCircleIds.length,
    targetCircleCount: uniqueTargetCircleIds.length,
    qualification: {
      minQualifiedAreaCount: settings.qualification.minQualifiedAreaCount,
      qualifiedAreaCount: qualificationProgress.qualifiedAreaCount,
      qualifiedAreaIds: qualificationProgress.qualifiedAreaIds,
      requiredAreaIds: settings.qualification.requiredAreaIds,
      minTotalDistinctCircles: settings.qualification.minTotalDistinctCircles,
    },
    eligible: settings.enabled && isQualified,
    rewardTitle: settings.rewardTitle,
    familyMemberCount,
    redeemedCount,
    remainingCount,
    rewards: settings.rewards,
    redemptionLocation: settings.redemptionLocation,
    rulesUrl: settings.rulesUrl,
    redeemedAt: latestRedemptions[0]?.createdAt ?? null,
  };
}

async function getVisitorRally(db: AppEnv["Variables"]["db"], visitor: { id: string; eventId: string }) {
  const progress = await getRallyProgress(db, visitor.eventId, visitor.id);
  return progress ?? {
    enabled: false,
    eventEnded: false,
    areas: [],
    stampedCircleIds: [],
    stampedCount: 0,
    targetCircleCount: 0,
    eligible: false,
    rewardTitle: "景品交換",
    familyMemberCount: 0,
    redeemedCount: 0,
    remainingCount: 0,
    rewards: [],
    redemptionLocation: "",
    rulesUrl: "",
    redeemedAt: null,
  };
}

async function recordRedemption(
  db: AppEnv["Variables"]["db"],
  d1: AppEnv["Bindings"]["DB"],
  eventId: string,
  eventUserId: string,
  staffId: string,
  rewardId: string,
  quantity: number,
) {
  const progress = await getRallyProgress(db, eventId, eventUserId);
  if (progress?.eventEnded) return { error: "開催終了後は景品交換を記録できません" } as const;
  if (!progress?.enabled || !progress.eligible) {
    return { error: "この来場者は景品交換の条件を満たしていません" } as const;
  }
  if (quantity > progress.remainingCount) return { error: "家族人数を超える個数は交換できません" } as const;
  const reward = progress.rewards.find((item) => item.id === rewardId) ??
    (rewardId === "default" ? progress.rewards[0] : undefined);
  if (!reward) return { error: "選択された景品は登録されていません" } as const;
  const redemptionId = ulid();
  const guardId = ulid();
  const createdAt = Date.now();
  try {
    await d1.batch([
      // 2026-10-17: 在庫と世帯上限をguard INSERT内で再確認し、確認と交換記録を同じD1 batchに入れる。
      // 複数スタッフの同時処理で残数を二重使用する競合を防ぐ。
      d1.prepare(`INSERT INTO order_write_guard (id, valid) SELECT ?, CASE WHEN
        EXISTS (SELECT 1 FROM event_user WHERE id=? AND event_id=? AND status='available')
        AND (SELECT count(*) FROM wristband WHERE user_id=? AND status IN ('active','smartphone')) -
          COALESCE((SELECT sum(quantity) FROM stamp_rally_redemption
            WHERE event_id=? AND event_user_id=?), 0) >= ?
        AND (? IS NULL OR COALESCE((SELECT sum(quantity) FROM stamp_rally_redemption
          WHERE event_id=? AND reward_id=?), 0) + ? <= ?)
        THEN 1 ELSE 0 END`).bind(
          guardId, eventUserId, eventId, eventUserId, eventId, eventUserId, quantity,
          reward.stockQuantity, eventId, reward.id, quantity, reward.stockQuantity,
        ),
      d1.prepare(`INSERT INTO stamp_rally_redemption
        (id,event_id,event_user_id,staff_id,reward_id,reward_name,quantity,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
          redemptionId, eventId, eventUserId, staffId, reward.id, reward.name, quantity, createdAt,
        ),
      d1.prepare("DELETE FROM order_write_guard WHERE id=?").bind(guardId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("order_write_guard_valid")) {
      return { error: "在庫または交換可能数が更新されました。来場者情報を再照会してください" } as const;
    }
    throw error;
  }
  return { redemption: { id: redemptionId, createdAt: new Date(createdAt) } } as const;
}

// 来場者のスタンプ。対象エリアはイベント設定、サークルの場所は circle.settings.storeAreaId から解決する。
stampRoutes.get("/visitor/:code", async (c) => {
  const db = c.get("db");
  const code = c.req.param("code");
  const visitor = await resolveVisitorFromCode(db, code);
  if (!visitor) {
    return c.json({ enabled: false, eventEnded: false, areas: [], stampedCircleIds: [], stampedCount: 0, targetCircleCount: 0, qualification: { minQualifiedAreaCount: null, qualifiedAreaCount: 0, qualifiedAreaIds: [], requiredAreaIds: [], minTotalDistinctCircles: null }, eligible: false, rewardTitle: "景品交換", familyMemberCount: 0, redeemedCount: 0, remainingCount: 0, rewards: [], redemptionLocation: "", rulesUrl: "", redeemedAt: null });
  }
  return c.json(await getVisitorRally(db, visitor));
});

// 2026-10-20: 景品受付の専用権限を設け、イベント編集権限がなくても当日担当者が受付できるようにする。
// イベントスタッフ向け来場者照会。入力は eventUser ID または有効なリストバンドID。
stampRoutes.get("/event/:eventId/lookup/:code", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("eventId");
  if (!(await hasPermission(c, null, "stamp-rally:operate", eventId))) {
    apiError("FORBIDDEN", "このイベントの景品交換を扱う権限がありません");
  }
  const visitor = await resolveVisitor(db, eventId, c.req.param("code"));
  if (!visitor) apiError("NOT_FOUND", "このイベントの来場者が見つかりません");
  return c.json({ visitor, progress: await getVisitorRally(db, visitor) });
});

// イベントスタッフ向け景品交換記録。家族枠・景品在庫の残数を確認して数量を記録する。
stampRoutes.post(
  "/event/:eventId/redeem",
  zBody(z.object({
    code: z.string().trim().min(1).max(256),
    rewardId: z.string().trim().min(1).max(64).default("default"),
    quantity: z.number().int().min(1).max(500).default(1),
  })),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("eventId");
    if (!(await hasPermission(c, null, "stamp-rally:operate", eventId))) {
      apiError("FORBIDDEN", "このイベントの景品交換を記録する権限がありません");
    }
    const eventRows = await db.select({ lifecycleStatus: event.lifecycleStatus, endDate: event.endDate })
      .from(event).where(and(eq(event.id, eventId), isNull(event.deletedAt))).limit(1);
    if (!eventRows[0]) apiError("NOT_FOUND", "イベントが見つかりません");
    if (isEventEnded(eventRows[0])) apiError("BAD_REQUEST", "開催終了後は景品交換を記録できません");
    const visitor = await resolveVisitor(db, eventId, c.req.valid("json").code);
    if (!visitor) apiError("NOT_FOUND", "このイベントの来場者が見つかりません");
    const session = await getSession(c);
    if (!session?.user) apiError("FORBIDDEN", "ログインが必要です");
    const input = c.req.valid("json");
    const result = await recordRedemption(db, c.env.DB, eventId, visitor.id, session.user.id || session.user.email.toLowerCase(), input.rewardId, input.quantity);
    if ("error" in result && result.error) apiError("BAD_REQUEST", result.error);
    return c.json({ success: true, redemption: result.redemption }, 201);
  },
);

stampRoutes.get("/event/:eventId/redemptions", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("eventId");
  if (!(await hasPermission(c, null, "stamp-rally:operate", eventId))) {
    apiError("FORBIDDEN", "このイベントの景品交換記録を閲覧する権限がありません");
  }
  const settingsRows = await db.select({ stampRallySettings: event.stampRallySettings }).from(event)
    .where(and(eq(event.id, eventId), isNull(event.deletedAt))).limit(1);
  const rewards = parseStampRallySettings(settingsRows[0]?.stampRallySettings).rewards;
  const rewardNames = new Map(rewards.map((reward) => [reward.id, reward.name]));
  const summaryRows = await db.select({
    rewardId: stampRallyRedemption.rewardId,
    rewardName: stampRallyRedemption.rewardName,
    quantity: sql<number>`sum(${stampRallyRedemption.quantity})`,
  }).from(stampRallyRedemption).where(eq(stampRallyRedemption.eventId, eventId))
    .groupBy(stampRallyRedemption.rewardId, stampRallyRedemption.rewardName);
  const history = await db.select({
    id: stampRallyRedemption.id,
    createdAt: stampRallyRedemption.createdAt,
    staffId: stampRallyRedemption.staffId,
    eventUserId: eventUser.id,
    displayId: eventUser.displayId,
    nickname: eventUser.nickname,
    rewardId: stampRallyRedemption.rewardId,
    rewardName: stampRallyRedemption.rewardName,
    quantity: stampRallyRedemption.quantity,
  }).from(stampRallyRedemption)
    .innerJoin(eventUser, eq(stampRallyRedemption.eventUserId, eventUser.id))
    .where(eq(stampRallyRedemption.eventId, eventId))
    .orderBy(desc(stampRallyRedemption.createdAt))
    .limit(50);
  const summaryByReward = new Map<string, { rewardId: string; rewardName: string; quantity: number }>();
  for (const row of summaryRows) {
    const current = summaryByReward.get(row.rewardId);
    summaryByReward.set(row.rewardId, {
      rewardId: row.rewardId,
      rewardName: row.rewardName || current?.rewardName || rewardNames.get(row.rewardId) || "景品交換",
      quantity: (current?.quantity ?? 0) + row.quantity,
    });
  }
  const recentHistory = history.map((row) => ({
    ...row,
    rewardName: row.rewardName || rewardNames.get(row.rewardId) || "景品交換",
  }));
  return c.json({
    rewards,
    totalQuantity: [...summaryByReward.values()].reduce((total, row) => total + row.quantity, 0),
    summary: [...summaryByReward.values()],
    history: recentHistory,
  });
});

// 2026-10-16: ラリー実績の人数はリストバンド本数ではなく、完了注文に紐づくイベント来場者IDで集計する。
// 注文数・アカウント利用人数・アカウント未連携注文を分け、物理バンドを使わない来場形態も同じ画面で把握できるようにする。
stampRoutes.get("/event/:eventId/usage", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("eventId");
  if (!(await hasPermission(c, null, "event:write", eventId))) {
    apiError("FORBIDDEN", "このイベントのスタンプラリー実績を閲覧する権限がありません");
  }

  const eventRows = await db.select({
    stampRallySettings: event.stampRallySettings,
    storeAreas: event.storeAreas,
  }).from(event).where(and(eq(event.id, eventId), isNull(event.deletedAt))).limit(1);
  const eventRow = eventRows[0];
  if (!eventRow) apiError("NOT_FOUND", "イベントが見つかりません");

  const settings = parseStampRallySettings(eventRow.stampRallySettings);
  const configuredAreas = parseStoreAreas(eventRow.storeAreas);
  const circles = await db.select({ id: circle.id, name: circle.name, settings: circle.settings })
    .from(circle).where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const validTargetAreaIds = settings.targetAreaIds.filter((id) => configuredAreas.some((area) => area.id === id));
  const targetCircleIds = circles.filter((row) => validTargetAreaIds.includes(parseCircleStoreAreaId(row.settings) || ""))
    .map((row) => row.id);
  const uniqueTargetCircleIds = [...new Set(targetCircleIds)];
  const targetCircleFilter = sql`${circle.id} in (select value from json_each(${JSON.stringify(uniqueTargetCircleIds)}))`;

  const storeAreaById = new Map(configuredAreas.map((area) => [area.id, area.name]));
  const targetCircleSet = new Set(uniqueTargetCircleIds);
  // 2026-10-22: 利用実績・売上も未会計注文では増やさない。
  const storeRows = await db.select({
    circleId: circle.id,
    orderCount: sql<number>`count(${order.id})`,
    visitorCount: sql<number>`count(distinct ${eventUser.id})`,
    anonymousOrderCount: sql<number>`coalesce(sum(case when ${order.id} is not null and ${eventUser.id} is null then 1 else 0 end), 0)`,
    revenue: sql<number>`coalesce(sum(${order.totalPrice}), 0)`,
    lastUsedAt: sql<number | null>`max(coalesce(${order.completedAt}, ${order.createdAt}))`,
  }).from(circle)
    .leftJoin(order, and(
      eq(order.circleId, circle.id),
      eq(order.paymentStatus, "paid"),
      ne(order.status, "cancelled"),
      or(eq(order.status, "completed"), eq(order.completed, true)),
    ))
    .leftJoin(eventUser, and(eq(eventUser.id, order.userId), eq(eventUser.eventId, eventId)))
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)))
    .groupBy(circle.id);
  const storeUsageById = new Map(storeRows.map((row) => [row.circleId, row]));
  const stores = circles.map((row) => {
    const usage = storeUsageById.get(row.id);
    const areaId = parseCircleStoreAreaId(row.settings);
    return {
      circleId: row.id,
      name: row.name,
      storeAreaId: areaId,
      storeAreaName: areaId ? storeAreaById.get(areaId) ?? null : null,
      isStampTarget: targetCircleSet.has(row.id),
      completedOrderCount: usage?.orderCount ?? 0,
      visitorAccountCount: usage?.visitorCount ?? 0,
      unlinkedOrderCount: usage?.anonymousOrderCount ?? 0,
      orderTotal: usage?.revenue ?? 0,
      lastUsedAt: toIsoDate(usage?.lastUsedAt),
    };
  }).sort((left, right) => right.visitorAccountCount - left.visitorAccountCount || left.name.localeCompare(right.name, "ja"));

  const visitorCounts = uniqueTargetCircleIds.length > 0
    ? await db.select({
        eventUserId: eventUser.id,
        visitedStoreCount: sql<number>`count(distinct ${circle.id})`,
      }).from(order)
        .innerJoin(circle, eq(order.circleId, circle.id))
        .innerJoin(eventUser, and(eq(eventUser.id, order.userId), eq(eventUser.eventId, eventId)))
        .where(and(
          eq(circle.eventId, eventId),
          isNull(circle.deletedAt),
          targetCircleFilter,
          eq(order.paymentStatus, "paid"),
          ne(order.status, "cancelled"),
          or(eq(order.status, "completed"), eq(order.completed, true)),
        ))
        .groupBy(eventUser.id)
    : [];
  const participantIds = new Set(visitorCounts.map((row) => row.eventUserId));
  const qualifiedIds = new Set<string>();
  // 2026-10-20: 旧エリア別ID設定の個別集計をやめ、来場者画面と同じ現行条件だけで評価する。
  const areaIdByCircleId = new Map(circles
    .filter((row) => validTargetAreaIds.includes(parseCircleStoreAreaId(row.settings) || ""))
    .map((row) => [row.id, parseCircleStoreAreaId(row.settings)!]));
  const areaVisitRows = settings.qualification.minQualifiedAreaCount !== null && uniqueTargetCircleIds.length > 0
    ? await db.select({ eventUserId: eventUser.id, circleId: circle.id })
        .from(order)
        .innerJoin(circle, eq(order.circleId, circle.id))
        .innerJoin(eventUser, and(eq(eventUser.id, order.userId), eq(eventUser.eventId, eventId)))
        .where(and(
          eq(circle.eventId, eventId),
          isNull(circle.deletedAt),
          targetCircleFilter,
          eq(order.paymentStatus, "paid"),
          ne(order.status, "cancelled"),
          or(eq(order.status, "completed"), eq(order.completed, true)),
        ))
        .groupBy(eventUser.id, circle.id)
    : [];
  const visitCountsByArea = new Map<string, Map<string, number>>();
  for (const row of areaVisitRows) {
    const areaId = areaIdByCircleId.get(row.circleId);
    if (!areaId) continue;
    const countsByArea = visitCountsByArea.get(row.eventUserId) ?? new Map<string, number>();
    countsByArea.set(areaId, (countsByArea.get(areaId) ?? 0) + 1);
    visitCountsByArea.set(row.eventUserId, countsByArea);
  }
  for (const visitor of visitorCounts) {
    const result = evaluateStampRallyQualification({
      qualification: settings.qualification,
      targetAreaIds: validTargetAreaIds,
      stampedCountByArea: visitCountsByArea.get(visitor.eventUserId) ?? new Map(),
      totalStampedCircleCount: visitor.visitedStoreCount,
    });
    if (result.eligible) qualifiedIds.add(visitor.eventUserId);
  }

  const redemptionRows = await db.select({
    eventUserId: stampRallyRedemption.eventUserId,
    quantity: stampRallyRedemption.quantity,
  }).from(stampRallyRedemption).where(eq(stampRallyRedemption.eventId, eventId));
  const redeemedIds = new Set(redemptionRows.map((row) => row.eventUserId));
  const qualifiedRedeemedCount = [...qualifiedIds].filter((id) => redeemedIds.has(id)).length;
  const redeemedQuantity = redemptionRows.reduce((sum, row) => sum + row.quantity, 0);
  const rewardSummaryRows = await db.select({
    rewardId: stampRallyRedemption.rewardId,
    quantity: sql<number>`sum(${stampRallyRedemption.quantity})`,
  }).from(stampRallyRedemption).where(eq(stampRallyRedemption.eventId, eventId))
    .groupBy(stampRallyRedemption.rewardId);
  const redeemedByReward = new Map(rewardSummaryRows.map((row) => [row.rewardId, row.quantity]));
  const rewards = settings.rewards.map((reward) => {
    const redeemed = redeemedByReward.get(reward.id) ?? 0;
    return {
      ...reward,
      redeemedQuantity: redeemed,
      remainingQuantity: reward.stockQuantity === null ? null : Math.max(0, reward.stockQuantity - redeemed),
    };
  });

  return c.json({
    enabled: settings.enabled,
    targetAreaIds: validTargetAreaIds,
    targetStoreCount: uniqueTargetCircleIds.length,
    qualification: settings.qualification,
    participantAccountCount: participantIds.size,
    qualifiedAccountCount: qualifiedIds.size,
    redeemedAccountCount: redeemedIds.size,
    qualifiedRedeemedAccountCount: qualifiedRedeemedCount,
    redeemedQuantity,
    rewards,
    stores,
  });
});

// 2026-10-16: 店舗詳細はイベントスタッフ権限の範囲で、完了注文を来場者アカウント単位にまとめてページ表示する。
stampRoutes.get("/event/:eventId/stores/:circleId", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("eventId");
  const circleId = c.req.param("circleId");
  if (!(await hasPermission(c, null, "event:write", eventId))) {
    apiError("FORBIDDEN", "このイベントの店舗利用実績を閲覧する権限がありません");
  }
  const rawPage = Number(c.req.query("page") || "1");
  const pageSize = 25;
  const search = (c.req.query("q") || "").trim().slice(0, 80);
  const searchFilter = search
    ? or(like(eventUser.nickname, `%${search}%`), sql`cast(${eventUser.displayId} as text) like ${`%${search}%`}`)
    : undefined;
  const visitorFilter = and(
    eq(circle.id, circleId),
    eq(circle.eventId, eventId),
    isNull(circle.deletedAt),
    eq(order.paymentStatus, "paid"),
    ne(order.status, "cancelled"),
    or(eq(order.status, "completed"), eq(order.completed, true)),
    eq(eventUser.eventId, eventId),
    searchFilter,
  );
  const circleRows = await db.select({ id: circle.id, name: circle.name })
    .from(circle).where(and(eq(circle.id, circleId), eq(circle.eventId, eventId), isNull(circle.deletedAt))).limit(1);
  const store = circleRows[0];
  if (!store) apiError("NOT_FOUND", "店舗が見つかりません");

  const countRows = await db.select({ total: sql<number>`count(distinct ${eventUser.id})` })
    .from(order).innerJoin(circle, eq(order.circleId, circle.id))
    .innerJoin(eventUser, and(eq(eventUser.id, order.userId), eq(eventUser.eventId, eventId)))
    .where(visitorFilter);
  const total = countRows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, totalPages) : 1;
  const visitors = await db.select({
    displayId: eventUser.displayId,
    nickname: eventUser.nickname,
    orderCount: sql<number>`count(${order.id})`,
    orderTotal: sql<number>`coalesce(sum(${order.totalPrice}), 0)`,
    lastUsedAt: sql<number | null>`max(coalesce(${order.completedAt}, ${order.createdAt}))`,
  }).from(order)
    .innerJoin(circle, eq(order.circleId, circle.id))
    .innerJoin(eventUser, and(eq(eventUser.id, order.userId), eq(eventUser.eventId, eventId)))
    .where(visitorFilter)
    .groupBy(eventUser.id, eventUser.displayId, eventUser.nickname)
    .orderBy(desc(sql`max(coalesce(${order.completedAt}, ${order.createdAt}))`), asc(eventUser.displayId))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    store,
    page,
    pageSize,
    total,
    visitors: visitors.map((visitor) => ({ ...visitor, lastUsedAt: toIsoDate(visitor.lastUsedAt) })),
  });
});

// 旧APIを利用するクライアント向け互換経路。イベントを来場者IDから特定したうえで
// 同じ event:write 認可・対象条件・イベント単位の一意記録を適用し、旧グローバル表には書かない。
stampRoutes.post(
  "/redeem",
  zBody(z.object({ userId: z.string().trim().min(1).max(256) })),
  async (c) => {
    const db = c.get("db");
    const visitor = await resolveVisitorFromAnyEvent(db, c.req.valid("json").userId);
    if (!visitor) apiError("NOT_FOUND", "来場者が見つかりません");
    if (!(await hasPermission(c, null, "event:write", visitor.eventId))) {
      apiError("FORBIDDEN", "対象イベントの景品交換を扱う権限がありません");
    }
    const session = await getSession(c);
    if (!session?.user) apiError("FORBIDDEN", "ログインが必要です");
    const result = await recordRedemption(db, c.env.DB, visitor.eventId, visitor.id, session.user.id || session.user.email.toLowerCase(), "default", 1);
    if ("error" in result && result.error) apiError("BAD_REQUEST", result.error);
    return c.json({ success: true, redemption: result.redemption }, 201);
  },
);

export default stampRoutes;

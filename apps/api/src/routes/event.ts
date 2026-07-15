import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  event,
  membership,
  circle,
  order,
  orderItem,
  eventUser,
  review,
  circleVisit,
  menu,
  notification,
  userStamp,
  contractPayment,
} from "@fesflow/db";
import { eq, and, inArray, isNull, desc } from "drizzle-orm";
import { ulid } from "ulidx";
import { getAdminSession, getSession, hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";

const eventRoutes = new Hono<AppEnv>();

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

// イベント取得
eventRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const events = await db
    .select()
    .from(event)
    .where(and(eq(event.id, id), isNull(event.deletedAt)));

  if (events.length === 0) {
    apiError("NOT_FOUND", "イベントが見つかりません");
  }

  return c.json(events[0]);
});

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
  const dayOrders = orders.filter(
    (o) => o.status !== "cancelled" && o.createdAt.getTime() >= dayStart && o.createdAt.getTime() < dayEnd
  );

  const payAgg = new Map<string, { orders: number; revenue: number }>();
  const circleAgg = new Map<string, { orders: number; revenue: number }>();
  for (const o of dayOrders) {
    const pk = o.paymentMethod || "未設定";
    const pa = payAgg.get(pk) || { orders: 0, revenue: 0 };
    pa.orders += 1;
    pa.revenue += o.totalPrice;
    payAgg.set(pk, pa);
    const ca = circleAgg.get(o.circleId) || { orders: 0, revenue: 0 };
    ca.orders += 1;
    ca.revenue += o.totalPrice;
    circleAgg.set(o.circleId, ca);
  }

  return c.json({
    date: resolvedDate,
    totals: {
      orders: dayOrders.length,
      revenue: dayOrders.reduce((s, o) => s + o.totalPrice, 0),
      customers: dayOrders.reduce((s, o) => s + o.peopleCount, 0),
    },
    paymentBreakdown: Array.from(payAgg.entries())
      .map(([method, a]) => ({ method, ...a }))
      .sort((a, b) => b.revenue - a.revenue),
    circleBreakdown: Array.from(circleAgg.entries())
      .map(([id, a]) => ({ circleId: id, name: circleName.get(id) || "", ...a }))
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

    return c.json({ sent });
  }
);

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
// イベント配下の全サークルを横断集計して来場者/売上/注文/評価/回遊の指標を返す。
// event_manager (sales:read) 権限が必要。super_admin は素では不可、なりすまし経由のみ
// (hasPermission がなりすまし対応済み)。サーバ側集計にすることで、フロントが
// サークル数だけ注文 API を叩く N+1 を避け、来場者/レビュー/訪問データも一括で返す。
eventRoutes.get("/:id/analytics", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("id");

  if (!(await hasPermission(c, null, "sales:read", eventId))) {
    apiError("FORBIDDEN", "このイベントの統計を閲覧する権限がありません");
  }

  // 配下サークル (非削除)
  const circles = await db
    .select({ id: circle.id, name: circle.name })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const circleIds = circles.map((c2) => c2.id);
  const circleName = new Map(circles.map((c2) => [c2.id, c2.name]));

  // 注文 (キャンセルは売上/客数から除外)
  const orders = circleIds.length
    ? await db.select().from(order).where(inArray(order.circleId, circleIds))
    : [];
  const liveOrders = orders.filter((o) => o.status !== "cancelled");
  const orderIds = liveOrders.map((o) => o.id);

  // 注文明細 (人気メニュー集計用)
  const items = orderIds.length
    ? await db.select().from(orderItem).where(inArray(orderItem.orderId, orderIds))
    : [];

  // 来場者
  const visitors = await db
    .select()
    .from(eventUser)
    .where(eq(eventUser.eventId, eventId));

  // レビュー / 回遊
  const reviews = circleIds.length
    ? await db.select().from(review).where(inArray(review.circleId, circleIds))
    : [];
  const visits = circleIds.length
    ? await db.select().from(circleVisit).where(inArray(circleVisit.circleId, circleIds))
    : [];

  // JST の時刻に補正してから時間帯バケットを取る (文化祭は JST 前提)。
  const jstHour = (ms: number) => new Date(ms + 9 * 3600 * 1000).getUTCHours();

  const revenue = liveOrders.reduce((s, o) => s + o.totalPrice, 0);
  const customers = liveOrders.reduce((s, o) => s + o.peopleCount, 0);
  const completed = liveOrders.filter((o) => o.status === "completed" || o.completed).length;

  // 時間帯別 (0-23)
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    orders: 0,
    revenue: 0,
    visitors: 0,
  }));
  for (const o of liveOrders) {
    const h = jstHour(o.createdAt.getTime());
    byHour[h]!.orders += 1;
    byHour[h]!.revenue += o.totalPrice;
  }
  for (const v of visitors) {
    const h = jstHour(v.createdAt.getTime());
    byHour[h]!.visitors += 1;
  }

  // サークル別ランキング
  const circleAgg = new Map<string, { revenue: number; orders: number; ratingSum: number; reviews: number }>();
  for (const id of circleIds) circleAgg.set(id, { revenue: 0, orders: 0, ratingSum: 0, reviews: 0 });
  for (const o of liveOrders) {
    const a = circleAgg.get(o.circleId);
    if (a) {
      a.revenue += o.totalPrice;
      a.orders += 1;
    }
  }
  for (const r of reviews) {
    const a = circleAgg.get(r.circleId);
    if (a) {
      a.ratingSum += r.rating;
      a.reviews += 1;
    }
  }
  const circleRanking = circleIds
    .map((id) => {
      const a = circleAgg.get(id)!;
      return {
        circleId: id,
        name: circleName.get(id) || "",
        revenue: a.revenue,
        orders: a.orders,
        reviews: a.reviews,
        avgRating: a.reviews ? Math.round((a.ratingSum / a.reviews) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  // 人気メニュー (販売個数 top 20)
  const menuAgg = new Map<string, { quantity: number; revenue: number }>();
  for (const it of items) {
    const key = it.menuName;
    const a = menuAgg.get(key) || { quantity: 0, revenue: 0 };
    a.quantity += it.quantity;
    a.revenue += it.menuPrice * it.quantity;
    menuAgg.set(key, a);
  }
  const menuRanking = Array.from(menuAgg.entries())
    .map(([menuName, a]) => ({ menuName, ...a }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  // 来場者の年齢層 (favoriteDate がある人のみ)
  const nowYear = new Date().getUTCFullYear();
  const ageBucketsMap = new Map<string, number>();
  for (const v of visitors) {
    if (!v.favoriteDate) continue;
    const y = Number(v.favoriteDate.slice(0, 4));
    if (!y || Number.isNaN(y)) continue;
    const age = nowYear - y;
    const label = age < 10 ? "〜9歳" : age < 20 ? "10代" : age < 30 ? "20代" : age < 40 ? "30代" : age < 50 ? "40代" : "50代〜";
    ageBucketsMap.set(label, (ageBucketsMap.get(label) || 0) + 1);
  }
  const ageOrder = ["〜9歳", "10代", "20代", "30代", "40代", "50代〜"];
  const ageBuckets = ageOrder
    .filter((l) => ageBucketsMap.has(l))
    .map((label) => ({ label, count: ageBucketsMap.get(label)! }));

  const onboarded = visitors.filter((v) => v.onboardedAt).length;
  const uniqueVisitFrom = new Set(visits.map((v) => v.eventUserId)).size;

  // 支払い方法別の集計 (2026-07-12)。未記録は「未設定」にまとめる。
  const payAgg = new Map<string, { orders: number; revenue: number }>();
  for (const o of liveOrders) {
    const key = o.paymentMethod || "未設定";
    const a = payAgg.get(key) || { orders: 0, revenue: 0 };
    a.orders += 1;
    a.revenue += o.totalPrice;
    payAgg.set(key, a);
  }
  const paymentBreakdown = Array.from(payAgg.entries())
    .map(([method, a]) => ({ method, ...a }))
    .sort((a, b) => b.revenue - a.revenue);

  return c.json({
    totals: {
      visitors: visitors.length,
      onboarded,
      onboardedRate: visitors.length ? Math.round((onboarded / visitors.length) * 100) : 0,
      orders: liveOrders.length,
      revenue,
      customers,
      avgSpend: customers ? Math.round(revenue / customers) : 0,
      circles: circles.length,
      reviews: reviews.length,
      avgRating: reviews.length
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
        : null,
      completedRate: liveOrders.length ? Math.round((completed / liveOrders.length) * 100) : 0,
      circleVisits: visits.length,
      visitingUsers: uniqueVisitFrom,
    },
    byHour,
    circleRanking,
    menuRanking,
    ageBuckets,
    paymentBreakdown,
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
  const visitors = await db.select().from(eventUser).where(eq(eventUser.eventId, eventId));
  const visits = circleIds.length
    ? await db.select().from(circleVisit).where(inArray(circleVisit.circleId, circleIds))
    : [];
  const stamps = circleIds.length
    ? await db.select().from(userStamp).where(inArray(userStamp.circleId, circleIds))
    : [];
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
    first: number; // 最初の活動(受付含む)
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
  // 受付時刻(eventUser.createdAt)を起点にする
  for (const v of visitors) {
    ensure(v.id, v.createdAt.getTime());
  }
  const touch = (uid: string | null, circleId: string | null, ms: number, isOrder: boolean, spend: number) => {
    if (!uid) return; // userId 未設定の注文(旧データ等)は個票に紐づけられないのでスキップ
    // 受付されていない未知IDでも活動があれば拾う(念のため)
    const j = ensure(uid, ms);
    if (circleId) j.circles.add(circleId);
    if (ms < j.first) j.first = ms;
    if (ms > j.last) j.last = ms;
    if (isOrder) {
      j.orders += 1;
      j.spend += spend;
    }
  };
  for (const o of liveOrders) touch(o.userId, o.circleId, o.createdAt.getTime(), true, o.totalPrice);
  for (const v of visits) touch(v.eventUserId, v.circleId, v.createdAt.getTime(), false, 0);
  for (const s of stamps) touch(s.userId, s.circleId, s.createdAt.getTime(), false, 0);

  const jList = Array.from(journeys.values());
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
    if (o.userId) hourUsers[h]!.add(o.userId);
  }
  for (const v of visits) hourUsers[jstHour(v.createdAt.getTime())]!.add(v.eventUserId);
  for (const s of stamps) hourUsers[jstHour(s.createdAt.getTime())]!.add(s.userId);
  for (const v of visitors) byHour[jstHour(v.createdAt.getTime())]!.arrivals += 1;
  for (let h = 0; h < 24; h++) byHour[h]!.activeUsers = hourUsers[h]!.size;
  // 混雑のピーク時間帯 (activeUsers 最大)
  const peak = byHour.reduce((mx, r) => (r.activeUsers > mx.activeUsers ? r : mx), byHour[0]!);

  // ── 5. 購入ファネル (離脱の可視化) ───────────────────────
  const engaged = jList.filter((j) => j.circles.size > 0 || j.orders > 0).length;
  const funnel = [
    { stage: "来場 (受付)", count: visitors.length },
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
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      hasPhysicalWristband: z.boolean().optional(),
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
      description: input.description,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
      hasPhysicalWristband: input.hasPhysicalWristband ?? true,
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
  // 物理削除せず deletedAt に時刻を書き込む (論理削除)
  await db.update(event).set({ deletedAt: new Date() }).where(eq(event.id, id));
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
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      hasPhysicalWristband: z.boolean().optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const session = await getAdminSession(c);
    if (!session) {
      apiError("FORBIDDEN", "管理者権限が必要です");
    }

    const id = c.req.param("id");
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

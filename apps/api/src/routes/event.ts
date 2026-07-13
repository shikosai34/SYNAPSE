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
    .select({ id: circle.id, name: circle.name })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  const circleIds = circles.map((c2) => c2.id);
  const circleName = new Map(circles.map((c2) => [c2.id, c2.name]));

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
      .map((m) => ({ ...m, circleName: circleName.get(m.circleId) || "" }))
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

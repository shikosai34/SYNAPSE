import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  circle,
  event,
  membership,
  inviteToken,
  eventUser,
  order,
  orderItem,
  review,
  circleVisit,
  menu,
} from "@fesflow/db";
import { eq, and, isNull, isNotNull, gte, inArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission, isCircleOwner } from "../utils/auth";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const circleRoutes = new Hono<AppEnv>();

// サークル一覧取得
// 2026-07-06 (H2): 公開ブラウズ(来場者アプリ)にも使われるため認証必須化はしない。
// 2026-10-19: 一般向け一覧には代表者の個人情報を返さず、イベント管理者の member:read
// 権限が確認できたイベント単位の一覧だけに managerName / managerEmail を含める。
circleRoutes.get("/", async (c) => {
  const db = c.get("db");
  const eventId = c.req.query("eventId");

  const query = db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      iconImagePath: circle.iconImagePath,
      backgroundImagePath: circle.backgroundImagePath,
      mods: circle.mods,
      settings: circle.settings,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerName: membership.userName,
      managerEmail: membership.userEmail,
    })
    .from(circle)
    .innerJoin(event, eq(event.id, circle.eventId))
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    );

  // 2026-10-15 (#128): 親イベント削除後に全件一覧や既知ID経由でサークルを選べないようにする。
  const where = and(
    isNull(event.deletedAt),
    isNull(circle.deletedAt),
    eventId ? eq(circle.eventId, eventId) : undefined
  );

  const circles = await query.where(where);
  const includeManagerDetails = Boolean(
    eventId && (await hasPermission(c, null, "member:read", eventId))
  );
  if (includeManagerDetails) {
    return c.json(circles);
  }
  return c.json(
    circles.map(({ managerName: _managerName, managerEmail: _managerEmail, ...rest }) => rest)
  );
});

// サークル取得
// 2026-07-06 (H2): 公開ブラウズにも使われるため認証必須化はしないが、
// 2026-10-19: 代表者名・メールは当該サークルの member:read を持つ認可済み呼び出し元にだけ返す。
circleRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const circles = await db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      iconImagePath: circle.iconImagePath,
      backgroundImagePath: circle.backgroundImagePath,
      mods: circle.mods,
      settings: circle.settings,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerName: membership.userName,
      managerEmail: membership.userEmail,
    })
    .from(circle)
    .innerJoin(event, eq(event.id, circle.eventId))
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    )
    .where(and(eq(circle.id, id), isNull(circle.deletedAt), isNull(event.deletedAt)));

  if (circles.length === 0) {
    apiError("NOT_FOUND", "サークルが見つかりません");
  }

  const found = circles[0]!;
  const includeManagerDetails = await hasPermission(c, id, "member:read");
  if (includeManagerDetails) {
    return c.json(found);
  }
  const { managerName: _managerName, managerEmail: _managerEmail, ...rest } = found;
  return c.json(rest);
});

// サークル統計・分析 (2026-07-12)
// 単一サークルの売上/注文/メニュー/支払い方法/評価/来訪を集計して返す。
// sales:read 権限が必要 (circle_manager 相当。circle_staff には無い)。
circleRoutes.get("/:id/analytics", async (c) => {
  const db = c.get("db");
  const circleId = c.req.param("id");
  if (!(await hasPermission(c, circleId, "sales:read"))) {
    apiError("FORBIDDEN", "このサークルの統計を閲覧する権限がありません");
  }

  const orders = await db.select().from(order).where(eq(order.circleId, circleId));
  const liveOrders = orders.filter((o) => o.status !== "cancelled");
  // 2026-10-22: 売上・購買数には店頭会計まで終わった注文だけを含める。
  const paidOrders = liveOrders.filter((o) => o.paymentStatus === "paid");
  const orderIds = paidOrders.map((o) => o.id);
  const items = orderIds.length
    ? await db.select().from(orderItem).where(inArray(orderItem.orderId, orderIds))
    : [];
  const reviews = await db.select().from(review).where(eq(review.circleId, circleId));
  // 2026-10-19: 入場処理前のスキャンを来訪者数に含めないよう、入場確定後の記録だけを集計する。
  const visits = await db
    .select({ eventUserId: circleVisit.eventUserId })
    .from(circleVisit)
    .innerJoin(eventUser, eq(circleVisit.eventUserId, eventUser.id))
    .where(and(
      eq(circleVisit.circleId, circleId),
      isNotNull(eventUser.onboardedAt),
      isNull(circleVisit.deletedAt),
      gte(circleVisit.createdAt, eventUser.onboardedAt),
    ));
  const menus = await db.select({ id: menu.id }).from(menu).where(eq(menu.circleId, circleId));

  const jstHour = (ms: number) => new Date(ms + 9 * 3600 * 1000).getUTCHours();
  const revenue = paidOrders.reduce((s, o) => s + o.totalPrice, 0);
  const customers = paidOrders.reduce((s, o) => s + o.peopleCount, 0);
  const completed = liveOrders.filter((o) => o.status === "completed" || o.completed);
  // 平均調理時間 (完成注文の completedAt - createdAt の平均、分)
  const prepMins = completed
    .filter((o) => o.completedAt)
    .map((o) => (o.completedAt!.getTime() - o.createdAt.getTime()) / 60000)
    .filter((m) => m >= 0);
  const avgPrepMin = prepMins.length
    ? Math.round((prepMins.reduce((s, m) => s + m, 0) / prepMins.length) * 10) / 10
    : null;

  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }));
  for (const o of paidOrders) {
    // 2026-10-22: 日を跨ぐモバイル注文も、時間帯別売上を実会計時刻へ計上する。
    const h = jstHour((o.paidAt ?? o.createdAt).getTime());
    byHour[h]!.orders += 1;
    byHour[h]!.revenue += o.totalPrice;
  }

  const menuAgg = new Map<string, { quantity: number; revenue: number }>();
  for (const it of items) {
    const a = menuAgg.get(it.menuName) || { quantity: 0, revenue: 0 };
    a.quantity += it.quantity;
    a.revenue += it.menuPrice * it.quantity;
    menuAgg.set(it.menuName, a);
  }
  const menuRanking = Array.from(menuAgg.entries())
    .map(([menuName, a]) => ({ menuName, ...a }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  const payAgg = new Map<string, { orders: number; revenue: number }>();
  for (const o of paidOrders) {
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
      orders: paidOrders.length,
      revenue,
      customers,
      avgSpend: customers ? Math.round(revenue / customers) : 0,
      completedRate: liveOrders.length ? Math.round((completed.length / liveOrders.length) * 100) : 0,
      avgPrepMin,
      reviews: reviews.length,
      avgRating: reviews.length
        ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
        : null,
      visitors: new Set(visits.map((v) => v.eventUserId)).size,
      menus: menus.length,
    },
    byHour,
    menuRanking,
    paymentBreakdown,
  });
});

// サークル作成
// 2026-07-07 (Phase 3a): セルフサービス化。旧仕様は管理者(getAdminSession)のみが
// managerEmail/managerPin を指定してサークル + 代表者メンバーシップを代理作成する
// ものだったが、新仕様では「better-auth セッションを持つ任意のログインユーザー」が
// サークルを作成でき、作成と同時に自分自身 (session.user.email) が circle_manager に
// なる (作成者=管理者)。managerEmail/managerName/managerPin の入力は廃止。
// eventId は引き続き必須 (サークルはイベント配下)。イベントをまたぐ不正の防止は
// 最小限 (イベント存在確認のみ) にとどめる。
circleRoutes.post(
  "/",
  requireAuth,
  zBody(
    z.object({
      eventId: z.string(),
      name: z.string().min(1, "サークル名は必須です"),
      description: z.string().optional(),
      iconImagePath: z.string().nullable().optional(),
      backgroundImagePath: z.string().nullable().optional(),
      // 2026-10-16 (#127): 作成時の運用設定も同時保存し、店舗エリアはイベント共有IDで参照する。
      settings: z.object({
        orderFlowMode: z.enum(["pending", "preparing", "completed"]).optional(),
        preOrderEnabled: z.boolean().optional(),
        mobileOrderEnabled: z.boolean().optional(),
        extensions: z.object({ stock: z.boolean().optional(), staff: z.boolean().optional() }).optional(),
        acceptedPayments: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
        storeAreaId: z.string().nullable().optional(),
        // 2026-10-25: 新規サークルの未登録バンド警告と例外注文も作成時に保存する。
        warnOnUnregisteredWristband: z.boolean().optional(),
        allowUnregisteredWristbandOrder: z.boolean().optional(),
      }).optional(),
      // 2026-07-12 (SaaS): サークル作成は「そのイベントの event_manager」か
      // 「サークルホスト招待 (circle_host)」のどちらかが必要。招待経由の場合はここに token を渡す。
      inviteToken: z.string().optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const session = c.get("session")!;
    const input = c.req.valid("json");
    const id = ulid();
    const email = session.user.email.toLowerCase();

    // イベントの存在確認
    const events = await db
      .select()
      .from(event)
      .where(eq(event.id, input.eventId));
    if (events.length === 0) {
      apiError("NOT_FOUND", "イベントが見つかりません");
    }
    const targetEvent = events[0]!;

    const readJsonArray = (raw: string | null | undefined): unknown[] => {
      try {
        const value: unknown = JSON.parse(raw || "[]");
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    };
    const availableAreaIds = new Set(readJsonArray(targetEvent.storeAreas)
      .flatMap((area) => area && typeof area === "object" && "id" in area && typeof area.id === "string" ? [area.id] : []));
    const selectedAreaId = input.settings?.storeAreaId ?? null;
    if (selectedAreaId && !availableAreaIds.has(selectedAreaId)) {
      apiError("BAD_REQUEST", "このイベントに登録されていない店舗エリアです");
    }
    const availablePayments = readJsonArray(targetEvent.paymentMethods)
      .filter((method): method is string => typeof method === "string");
    const acceptedPayments = input.settings?.acceptedPayments ?? [];
    if (acceptedPayments.some((method) => !availablePayments.includes(method))) {
      apiError("BAD_REQUEST", "イベントに登録されていない支払い方法が含まれています");
    }

    // 2026-07-12 (SaaS): サークル作成の認可。
    // - そのイベントの event_manager (主催者) は招待不要で作成できる (イベント管理画面からの追加)。
    // - それ以外は、そのイベント向けの有効な circle_host 招待 (eventId 一致・circleId 無し・
    //   role=circle_manager) を提示した場合のみ作成できる。誰でも任意イベントにサークルを
    //   作れてしまう旧挙動を塞ぐ。招待の消費 (usedCount++) は作成直前に TOCTOU 安全に行う。
    const myMemberships = await db
      .select()
      .from(membership)
      .where(and(eq(membership.userEmail, email), eq(membership.isActive, true)));
    const isEventManager = myMemberships.some(
      (m) => m.eventId === input.eventId && m.role === "event_manager"
    );
    let hostInvite: typeof inviteToken.$inferSelect | null = null;
    if (!isEventManager) {
      if (!input.inviteToken) {
        apiError("FORBIDDEN", "サークルを作成するにはイベントの招待が必要です");
      }
      // 2026-07-14 (P2-8): 期限切れ条件を SQL に含めず、原因ごとに個別のメッセージを返す。
      const rows = await db
        .select()
        .from(inviteToken)
        .where(eq(inviteToken.token, input.inviteToken!));
      const t = rows[0];
      if (!t) {
        apiError("NOT_FOUND", "招待が見つかりません。コード / リンクをご確認ください。");
      }
      if (new Date(t!.expiresAt) <= new Date()) {
        apiError("BAD_REQUEST", "招待の有効期限が切れています。主催者に再発行を依頼してください。");
      }
      const kindOk = !t!.circleId && t!.eventId === input.eventId && t!.role === "circle_manager";
      if (!kindOk) {
        apiError("FORBIDDEN", "この招待ではこのイベントにサークルを作成できません。");
      }
      if (t!.maxUses !== null && t!.usedCount >= t!.maxUses) {
        apiError("BAD_REQUEST", "招待の使用回数の上限に達しました。主催者にお問い合わせください。");
      }
      hostInvite = t!;
    }

    // 2026-07-12 (SaaS): 停止中イベントは新規サークル作成を拒否する。
    if (targetEvent.billingStatus === "suspended") {
      apiError("FORBIDDEN", "このイベントは現在停止中です。主催者にお問い合わせください。");
    }

    // 2026-07-12 (SaaS): プランのサークル数上限を超えないか確認する。
    // 無料枠は maxCircles=1。上限に達している場合はプランのアップグレードが必要。
    const existingForEvent = await db
      .select({ id: circle.id })
      .from(circle)
      .where(and(eq(circle.eventId, input.eventId), isNull(circle.deletedAt)));
    if (existingForEvent.length >= targetEvent.maxCircles) {
      apiError(
        "FORBIDDEN",
        `このイベントのプランでは最大 ${targetEvent.maxCircles} サークルまでです。プランのアップグレードが必要です。`
      );
    }

    // 同じイベント内で同じ名前のサークルがないか確認
    const existingCircles = await db
      .select()
      .from(circle)
      .where(
        and(eq(circle.eventId, input.eventId), eq(circle.name, input.name))
      );

    if (existingCircles.length > 0) {
      apiError("BAD_REQUEST", "同じ名前のサークルが既に存在します");
    }

    const membershipId = ulid();
    const inviteUseGuardId = hostInvite ? ulid() : null;
    const circleSettings = JSON.stringify({
      orderFlowMode: input.settings?.orderFlowMode ?? "pending",
      preOrderEnabled: input.settings?.preOrderEnabled ?? false,
      mobileOrderEnabled: input.settings?.mobileOrderEnabled ?? false,
      extensions: {
        stock: input.settings?.extensions?.stock ?? false,
        staff: input.settings?.extensions?.staff ?? false,
      },
      acceptedPayments,
      storeAreaId: selectedAreaId,
      // 2026-10-25: 新規サークルも未登録警告を既定表示し、注文許可は明示設定にする。
      warnOnUnregisteredWristband: input.settings?.warnOnUnregisteredWristband ?? true,
      allowUnregisteredWristbandOrder: input.settings?.allowUnregisteredWristbandOrder ?? false,
    });
    const statements = [];
    if (hostInvite && inviteUseGuardId) {
      // 2026-10-17: D1 batch を単一トランザクションとして使い、招待消費・サークル・
      // 代表者メンバーシップを一緒に確定する。失敗時は三つともrollbackされる。
      statements.push(c.env.DB.prepare(`INSERT INTO order_write_guard (id, valid) SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM invite_token WHERE id=? AND circle_id IS NULL AND event_id=? AND role='circle_manager'
          AND expires_at>? AND (max_uses IS NULL OR used_count<max_uses)
      ) THEN 1 ELSE 0 END`).bind(inviteUseGuardId, hostInvite.id, input.eventId, Date.now()));
      statements.push(c.env.DB.prepare("UPDATE invite_token SET used_count=used_count+1 WHERE id=? AND (max_uses IS NULL OR used_count<max_uses)")
        .bind(hostInvite.id));
    }
    statements.push(c.env.DB.prepare(`INSERT INTO circle
      (id,event_id,name,description,icon_image_path,background_image_path,settings,created_from_invite_id)
      VALUES (?,?,?,?,?,?,?,?)`).bind(id, input.eventId, input.name, input.description ?? null,
        input.iconImagePath ?? null, input.backgroundImagePath ?? null, circleSettings, hostInvite?.id ?? null));
    // 2026-07-07 (Phase 3a): 代表者は常に作成者本人 (session.user.email)。
    statements.push(c.env.DB.prepare(`INSERT INTO membership (id,user_email,user_name,circle_id,role,is_active)
      VALUES (?,?,?,?, 'circle_manager',1)`).bind(membershipId, email,
        session.user.name || `${input.name} 代表者`, id));
    if (inviteUseGuardId) {
      statements.push(c.env.DB.prepare("DELETE FROM order_write_guard WHERE id=?").bind(inviteUseGuardId));
    }
    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("order_write_guard_valid")) {
        apiError("BAD_REQUEST", "招待の使用回数上限に達したか、有効期限が切れています");
      }
      throw error;
    }

    return c.json({ id }, 201);
  }
);

// サークル更新
// 2026-07-07 (Phase 3a): PIN 廃止に合わせて整理。managerEmail/managerPin による
// 代表者付け替えロジックは撤去し、サークル名/説明の更新のみを扱う。
// 代表者の付け替えは招待 (membership.ts の invite) やオーナー権限譲渡
// (POST /:id/transfer-owner, 下記) 側に委ねる。
// 2026-07-16: 権限チェックを getAdminSession (=super_admin 限定) から
// hasPermission(circle:write) に変更。従来の実装だと実際にこの画面を使う
// circle_manager/event_manager が「管理者権限が必要です」で弾かれ、ダッシュボードの
// 「基本情報」保存ボタンが実質誰も使えない状態だった。同じサークル更新系の
// PATCH /:id/settings, /:id/mods と揃える。合わせてアイコン/背景画像パスの
// 更新にも対応する (サークル画像アップロードUI用。iconImagePath/backgroundImagePath は
// circle テーブルに既存のカラムで、これまで更新するUI/APIが無く常に空だった)。
circleRoutes.put(
  "/:id",
  zBody(
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      // null を許可し、画像の明示的な削除 (未設定に戻す) を表現できるようにする。
      iconImagePath: z.string().nullable().optional(),
      backgroundImagePath: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");

    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      apiError("FORBIDDEN", "権限がありません");
    }
    // 対象サークルの存在確認
    const existingCircle = await db
      .select()
      .from(circle)
      .where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      apiError("NOT_FOUND", "サークルが見つかりません");
    }

    // 2026-10-16: イベント運営者は出店者の表示情報を代理修正できる一方、circle:write を持つ一般スタッフには従来どおり開放しない。
    const canManageEventCircle = await hasPermission(c, id, "circle:delete");
    if (!(await isCircleOwner(c, id)) && !canManageEventCircle) {
      apiError("FORBIDDEN", "サークルの基本情報を変更する権限がありません");
    }

    const input = c.req.valid("json");

    const updates: Partial<typeof circle.$inferSelect> = {};

    if (input.name) updates.name = input.name;
    if (input.description !== undefined)
      updates.description = input.description;
    if (input.iconImagePath !== undefined)
      updates.iconImagePath = input.iconImagePath;
    if (input.backgroundImagePath !== undefined)
      updates.backgroundImagePath = input.backgroundImagePath;

    if (Object.keys(updates).length > 0) {
      await db.update(circle).set(updates).where(eq(circle.id, id));
    }

    return c.json({ success: true });
  }
);

// サークル削除 (論理削除)
// 上位管理者のみ実行可能: super_admin もしくは当該イベントの event_manager
// (circle:delete 権限。circle_manager は自サークルを削除できない)
circleRoutes.delete("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");

  const allowed = await hasPermission(c, id, "circle:delete");
  if (!allowed) {
    apiError("FORBIDDEN", "削除する権限がありません");
  }

  // 物理削除せず deletedAt に時刻を書き込む (論理削除)
  await db.update(circle).set({ deletedAt: new Date(), deletedWithEventId: null }).where(eq(circle.id, id));
  return c.json({ success: true });
});

// サークル運用設定 (注文モード・組み込み拡張のON/OFF等) の更新
circleRoutes.patch(
  "/:id/settings",
  zBody(
    z.object({
      settings: z.record(z.string(), z.any()),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const { settings } = c.req.valid("json");

    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const existingCircle = await db.select().from(circle).where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      apiError("NOT_FOUND", "サークルが見つかりません");
    }

    let oldSettings: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(existingCircle[0]!.settings || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) oldSettings = parsed as Record<string, unknown>;
    } catch {
      oldSettings = {};
    }

    // 2026-10-16 (#127): 店舗エリアと支払方法は親イベントの定義に限定し、運営画面からの変更も作成時と同じ制約で検証する。
    if (
      Object.prototype.hasOwnProperty.call(settings, "storeAreaId") ||
      Object.prototype.hasOwnProperty.call(settings, "acceptedPayments")
    ) {
      const parentEvent = await db
        .select({ storeAreas: event.storeAreas, paymentMethods: event.paymentMethods })
        .from(event)
        .where(eq(event.id, existingCircle[0]!.eventId));
      const parseArray = (raw: string | null | undefined): unknown[] => {
        try {
          const parsed: unknown = JSON.parse(raw || "[]");
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };

      if (Object.prototype.hasOwnProperty.call(settings, "storeAreaId")) {
        const storeAreaId = settings.storeAreaId;
        if (storeAreaId !== null && typeof storeAreaId !== "string") {
          apiError("BAD_REQUEST", "店舗エリアの指定が正しくありません");
        }
        if (typeof storeAreaId === "string") {
          const areas = parseArray(parentEvent[0]?.storeAreas);
          if (!areas.some((area) => area && typeof area === "object" && "id" in area && area.id === storeAreaId)) {
            apiError("BAD_REQUEST", "このイベントに登録されていない店舗エリアです");
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(settings, "acceptedPayments")) {
        const acceptedPayments = settings.acceptedPayments;
        if (!Array.isArray(acceptedPayments) || acceptedPayments.some((method) => typeof method !== "string")) {
          apiError("BAD_REQUEST", "支払い方法の指定が正しくありません");
        }
        const availablePayments = parseArray(parentEvent[0]?.paymentMethods);
        if (acceptedPayments.some((method) => !availablePayments.includes(method))) {
          apiError("BAD_REQUEST", "イベントに登録されていない支払い方法が含まれています");
        }
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(settings, "orderFlowMode") &&
      settings.orderFlowMode !== "pending" &&
      settings.orderFlowMode !== "preparing" &&
      settings.orderFlowMode !== "completed"
    ) {
      apiError("BAD_REQUEST", "注文モードの指定が正しくありません");
    }

    if (
      Object.prototype.hasOwnProperty.call(settings, "mobileOrderEnabled") &&
      typeof settings.mobileOrderEnabled !== "boolean"
    ) {
      apiError("BAD_REQUEST", "モバイルオーダーの設定が正しくありません");
    }
    if (
      Object.prototype.hasOwnProperty.call(settings, "preOrderEnabled") &&
      typeof settings.preOrderEnabled !== "boolean"
    ) {
      apiError("BAD_REQUEST", "事前注文の設定が正しくありません");
    }
    // 2026-10-25: 警告と例外注文は真偽値だけ保存し、壊れた JSON 設定をレジ判定へ流さない。
    if (
      Object.prototype.hasOwnProperty.call(settings, "warnOnUnregisteredWristband") &&
      typeof settings.warnOnUnregisteredWristband !== "boolean"
    ) {
      apiError("BAD_REQUEST", "未登録バンド警告の設定が正しくありません");
    }
    if (
      Object.prototype.hasOwnProperty.call(settings, "allowUnregisteredWristbandOrder") &&
      typeof settings.allowUnregisteredWristbandOrder !== "boolean"
    ) {
      apiError("BAD_REQUEST", "未登録バンド注文の設定が正しくありません");
    }

    if (Object.prototype.hasOwnProperty.call(settings, "orderNumberDisplay")) {
      const display = settings.orderNumberDisplay;
      if (!display || typeof display !== "object" || Array.isArray(display)) {
        apiError("BAD_REQUEST", "番号表示の設定が正しくありません");
      }
      if (typeof display.showPreparingNumbers !== "boolean" || typeof display.showPickupNumbers !== "boolean" ||
        (!display.showPreparingNumbers && !display.showPickupNumbers) ||
        (display.overflowPriority !== "latest" && display.overflowPriority !== "oldest") ||
        !Array.isArray(display.media) || display.media.length > 20) {
        apiError("BAD_REQUEST", "番号表示の設定が正しくありません");
      }
      const previousDisplay = oldSettings.orderNumberDisplay;
      const previousMediaPercent = previousDisplay && typeof previousDisplay === "object" && !Array.isArray(previousDisplay)
        ? (previousDisplay as Record<string, unknown>).mediaPercent
        : undefined;
      // 2026-10-21: 新旧クライアント間の設定更新で比率を失わず、スライダー範囲内の値だけを保存する。
      const mediaPercent = display.mediaPercent === undefined
        ? typeof previousMediaPercent === "number" && Number.isFinite(previousMediaPercent)
          ? Math.max(20, Math.min(80, Math.round(previousMediaPercent / 5) * 5))
          : 35
        : display.mediaPercent;
      if (typeof mediaPercent !== "number" || !Number.isInteger(mediaPercent) || mediaPercent < 20 || mediaPercent > 80 || mediaPercent % 5 !== 0) {
        apiError("BAD_REQUEST", "番号とメディアの表示比率が正しくありません");
      }
      const media = display.media.map((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) apiError("BAD_REQUEST", "表示メディアが正しくありません");
        const candidate = item as Record<string, unknown>;
        // 2026-10-21: 動画・画像本体は選択した端末内に残し、APIには設定用メタデータだけを保存する。
        if (typeof candidate.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(candidate.id) ||
          typeof candidate.name !== "string" || candidate.name.length > 160 ||
          (candidate.kind !== "image" && candidate.kind !== "video") ||
          !Number.isInteger(candidate.durationSeconds) || (candidate.durationSeconds as number) < 2 || (candidate.durationSeconds as number) > 60) {
          apiError("BAD_REQUEST", "表示メディアが正しくありません");
        }
        return {
          id: candidate.id,
          name: candidate.name,
          kind: candidate.kind,
          durationSeconds: candidate.durationSeconds,
        };
      });
      settings.orderNumberDisplay = {
        showPreparingNumbers: display.showPreparingNumbers,
        showPickupNumbers: display.showPickupNumbers,
        overflowPriority: display.overflowPriority,
        mediaPercent,
        media,
      };
    }

    await db
      .update(circle)
      .set({ settings: JSON.stringify({ ...oldSettings, ...settings }) })
      .where(eq(circle.id, id));

    return c.json({ success: true });
  }
);

// 2026-10-07 (#9): 待ち時間はレジ担当が報告し、30分で「未報告」に戻す。既存の可変設定JSONへ
// 最新値と履歴を同時に残し、来場者・本部の公開サークル一覧から同じ報告を参照できるようにする。
circleRoutes.patch(
  "/:id/wait-time",
  zBody(z.object({ waitMinutes: z.number().int().min(0).max(240).multipleOf(10) })),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const { waitMinutes } = c.req.valid("json");
    if (!(await hasPermission(c, id, "order:write"))) {
      apiError("FORBIDDEN", "待ち時間を報告する権限がありません");
    }
    const rows = await db.select().from(circle).where(eq(circle.id, id));
    const target = rows[0];
    if (!target || target.deletedAt) apiError("NOT_FOUND", "サークルが見つかりません");
    let settings: Record<string, any> = {};
    try {
      const parsed: unknown = JSON.parse(target.settings || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settings = parsed as Record<string, any>;
      }
    } catch {
      // 壊れた任意設定JSONは空から復旧し、待ち時間の報告を妨げない。
    }
    const reportedAt = new Date().toISOString();
    const previous = Array.isArray(settings.waitTimeReports) ? settings.waitTimeReports : [];
    await db.update(circle).set({
      settings: JSON.stringify({
        ...settings,
        waitTimeReport: { minutes: waitMinutes, reportedAt },
        // 直近500件を残し、将来の混雑推移分析に使えるよう報告ログを保持する。
        waitTimeReports: [...previous, { minutes: waitMinutes, reportedAt }].slice(-500),
      }),
    }).where(eq(circle.id, id));
    return c.json({ success: true, waitTimeReport: { minutes: waitMinutes, reportedAt } });
  }
);

// オーナー権限の譲渡: 指定メンバーを circle_manager に昇格し、既存の
// circle_manager を circle_staff へ降格する。circle_manager 本人または
// 上位管理者(event_manager / super_admin)のみ実行可能。
circleRoutes.post(
  "/:id/transfer-owner",
  zBody(
    z.object({
      membershipId: z.string(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const { membershipId } = c.req.valid("json");

    // 譲渡は「メンバーの権限変更」に相当するため circle:write 権限で判定
    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      apiError("FORBIDDEN", "権限がありません");
    }
    // 高度な権限管理 OFF では一般スタッフも circle:write を持つため、譲渡はオーナーに限る (2026-10-05)。
    if (!(await isCircleOwner(c, id))) {
      apiError("FORBIDDEN", "オーナー権限の譲渡はオーナーのみ実行できます");
    }

    // 譲渡先メンバーが当該サークルに所属しているか確認
    const targets = await db
      .select()
      .from(membership)
      .where(and(eq(membership.id, membershipId), eq(membership.circleId, id)));
    if (targets.length === 0) {
      apiError("NOT_FOUND", "譲渡先のメンバーが見つかりません");
    }

    // 既存の circle_manager を circle_staff に降格 (譲渡先自身は除く)
    const currentManagers = await db
      .select()
      .from(membership)
      .where(
        and(eq(membership.circleId, id), eq(membership.role, "circle_manager"))
      );
    for (const m of currentManagers) {
      if (m.id === membershipId) continue;
      await db
        .update(membership)
        .set({ role: "circle_staff" })
        .where(eq(membership.id, m.id));
    }

    // 譲渡先を circle_manager に昇格
    await db
      .update(membership)
      .set({ role: "circle_manager" })
      .where(eq(membership.id, membershipId));

    return c.json({ success: true });
  }
);

// サークルの拡張機能（モッド）設定の更新
circleRoutes.patch(
  "/:id/mods",
  zBody(
    z.object({
      mods: z.record(z.string(), z.any()),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const { mods } = c.req.valid("json");

    // 該当サークルへの書き込み権限をチェック
    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      apiError("FORBIDDEN", "権限がありません");
    }

    // 対象サークルの存在確認
    const existingCircle = await db
      .select()
      .from(circle)
      .where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      apiError("NOT_FOUND", "サークルが見つかりません");
    }

    // データベースの更新
    await db
      .update(circle)
      .set({
        mods: JSON.stringify(mods),
      })
      .where(eq(circle.id, id));

    return c.json({ success: true });
  }
);

export default circleRoutes;

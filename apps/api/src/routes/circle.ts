import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  circle,
  event,
  membership,
  inviteToken,
  order,
  orderItem,
  review,
  circleVisit,
  menu,
} from "@fesflow/db";
import { eq, and, isNull, gt, lt, inArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { getAdminSession, hasPermission } from "../utils/auth";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const circleRoutes = new Hono<AppEnv>();

// サークル一覧取得
// 2026-07-06 (H2): 公開ブラウズ(来場者アプリ)にも使われるため認証必須化はしない。
// ただし代表者のメールアドレス(PII)を managerEmail として無認可で返すのは漏洩なので、
// managerEmail は「対象イベントの member:read を持つ認可済み呼び出し元」にのみ付与し、
// 匿名/権限のない呼び出し元には含めない (managerName は表示用途で常に返す)。
circleRoutes.get("/", async (c) => {
  const db = c.get("db");
  const eventId = c.req.query("eventId");

  const query = db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      mods: circle.mods,
      settings: circle.settings,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerName: membership.userName,
      managerEmail: membership.userEmail,
    })
    .from(circle)
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    );

  // 論理削除済み(deletedAt != null)は常に除外する
  const where = eventId
    ? and(eq(circle.eventId, eventId), isNull(circle.deletedAt))
    : isNull(circle.deletedAt);

  const circles = await query.where(where);

  // eventId スコープで member:read を持つ場合のみ managerEmail を残す。
  // それ以外(匿名来場者・eventId 未指定)では PII を落として返す。
  const includeEmail = eventId
    ? await hasPermission(c, null, "member:read", eventId)
    : false;
  if (includeEmail) {
    return c.json(circles);
  }
  return c.json(circles.map(({ managerEmail: _managerEmail, ...rest }) => rest));
});

// サークル取得
// 2026-07-06 (H2): 公開ブラウズにも使われるため認証必須化はしないが、
// 代表者のメールアドレス(PII)は当該サークルの member:read を持つ認可済み呼び出し元にのみ
// 付与し、匿名/権限のない呼び出し元には含めない (managerName は表示用途で常に返す)。
circleRoutes.get("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const circles = await db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      mods: circle.mods,
      settings: circle.settings,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerName: membership.userName,
      managerEmail: membership.userEmail,
    })
    .from(circle)
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    )
    .where(and(eq(circle.id, id), isNull(circle.deletedAt)));

  if (circles.length === 0) {
    apiError("NOT_FOUND", "サークルが見つかりません");
  }

  const found = circles[0]!;
  const includeEmail = await hasPermission(c, id, "member:read");
  if (includeEmail) {
    return c.json(found);
  }
  const { managerEmail: _managerEmail, ...rest } = found;
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
  const orderIds = liveOrders.map((o) => o.id);
  const items = orderIds.length
    ? await db.select().from(orderItem).where(inArray(orderItem.orderId, orderIds))
    : [];
  const reviews = await db.select().from(review).where(eq(review.circleId, circleId));
  const visits = await db.select().from(circleVisit).where(eq(circleVisit.circleId, circleId));
  const menus = await db.select({ id: menu.id }).from(menu).where(eq(menu.circleId, circleId));

  const jstHour = (ms: number) => new Date(ms + 9 * 3600 * 1000).getUTCHours();
  const revenue = liveOrders.reduce((s, o) => s + o.totalPrice, 0);
  const customers = liveOrders.reduce((s, o) => s + o.peopleCount, 0);
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
  for (const o of liveOrders) {
    const h = jstHour(o.createdAt.getTime());
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
      orders: liveOrders.length,
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
      const rows = await db
        .select()
        .from(inviteToken)
        .where(and(eq(inviteToken.token, input.inviteToken!), gt(inviteToken.expiresAt, new Date())));
      const t = rows[0];
      const kindOk =
        !!t && !t.circleId && t.eventId === input.eventId && t.role === "circle_manager";
      if (!kindOk) {
        apiError("FORBIDDEN", "無効または対象外の招待です");
      }
      if (t!.maxUses !== null && t!.usedCount >= t!.maxUses) {
        apiError("BAD_REQUEST", "招待の使用回数上限に達しました");
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

    // 2026-07-13 (D1トランザクション対応): アトミック性を保証するため、
    // 招待の消費、サークルとメンバーシップの登録を db.transaction 内で実行します。
    // エラー時は自動でロールバックされるため、手動の補償削除は不要です。
    await db.transaction(async (tx) => {
      // 招待経由の場合は、作成を確定する直前に招待を TOCTOU 安全に消費する
      // (used_count < max_uses を満たす場合のみ +1。0件更新なら上限到達で中断)。
      if (hostInvite) {
        const upd = await tx
          .update(inviteToken)
          .set({ usedCount: hostInvite.usedCount + 1 })
          .where(
            and(
              eq(inviteToken.id, hostInvite.id),
              hostInvite.maxUses !== null
                ? lt(inviteToken.usedCount, hostInvite.maxUses)
                : undefined
            )
          );
        const changes = (upd as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 0;
        if (changes === 0) {
          apiError("BAD_REQUEST", "招待の使用回数上限に達しました");
        }
      }

      await tx.insert(circle).values({
        id,
        eventId: input.eventId,
        name: input.name,
        description: input.description,
      });

      const membershipId = ulid();
      await tx.insert(membership).values({
        id: membershipId,
        userEmail: session.user.email.toLowerCase(), // メールアドレスは小文字で保存
        userName: session.user.name || `${input.name} 代表者`,
        circleId: id,
        role: "circle_manager",
        isActive: true,
      });
    });

    return c.json({ id }, 201);
  }
);

// サークル更新
// 2026-07-07 (Phase 3a): PIN 廃止に合わせて整理。managerEmail/managerPin による
// 代表者付け替えロジックは撤去し、サークル名/説明の更新のみを扱う。
// 代表者の付け替えは招待 (membership.ts の invite) やオーナー権限譲渡
// (POST /:id/transfer-owner, 下記) 側に委ねる。
circleRoutes.put(
  "/:id",
  zBody(
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
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

    // 対象サークルの存在確認
    const existingCircle = await db
      .select()
      .from(circle)
      .where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      apiError("NOT_FOUND", "サークルが見つかりません");
    }

    const updates: Partial<typeof circle.$inferSelect> = {};

    if (input.name) updates.name = input.name;
    if (input.description !== undefined)
      updates.description = input.description;

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
  await db.update(circle).set({ deletedAt: new Date() }).where(eq(circle.id, id));
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

    await db
      .update(circle)
      .set({ settings: JSON.stringify(settings) })
      .where(eq(circle.id, id));

    return c.json({ success: true });
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

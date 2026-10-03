import { Hono } from "hono";
import { zBody } from "../z-validator";
import { AppError, apiError } from "../http-error";
import { z } from "zod";
import {
  preOrder,
  preOrderItem,
  preOrderItemTopping,
  menu,
  menuTopping,
  topping,
  wristband,
  eventUser,
  circle,
  event,
  couponRedemption,
} from "@fesflow/db";
import { eq, and, or, inArray, desc } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import { commitOrder, committedOrder, orderCommand } from "../services/order-commit";
import {
  checkCouponEligibility,
  computeCouponDiscount,
  getCouponMenuIds,
  getCouponToppingIds,
  redeemCouponWithGuard,
} from "../utils/coupon";
import type { AppEnv } from "../types";

const preOrderRoutes = new Hono<AppEnv>();

// 事前オーダー作成 (ユーザー端末側)
preOrderRoutes.post(
  "/",
  zBody(
    z.object({
      userId: z.string(),
      circleId: z.string(),
      items: z.array(
        z.object({
          menuId: z.string(),
          quantity: z.number().min(1).default(1),
          // 2026-07-13: 来場者モバイルオーダーのトッピング対応。省略時は従来通りトッピング無し。
          toppingIds: z.array(z.string()).optional(),
        })
      ),
      // クーポン適用 (2026-09-16, issue #50)。来場者側は /coupon/:slug で事前に合言葉検証済みでも、
      // ここで slug+passphrase を再送させて改めてサーバ側で検証する (合言葉検証だけの verify エンドポイントは
      // 消費しないプレビューのため、実際の消費・使用回数+1はここでのみ行う)。
      // 複数枚同時適用に対応 (2026-09-16 フィードバック対応: 来場者は複数の合言葉を検証済みの
      // ことがあるため)。対象が重ならなければ (例: メニューA向けの金額引き + トッピングB無料)
      // 両方同時に効かせて問題ない。
      coupons: z
        .array(
          z.object({
            slug: z.string().min(1),
            passphrase: z.string().min(1),
          })
        )
        .max(10)
        .optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    try {
      const { userId, circleId, items, coupons: couponInputs = [] } = c.req.valid("json");
      const preOrderId = ulid();

      // 2026-07-04: 新規スマホユーザーの外部キーエラー回避のため、サークルの eventId を取得し、
      // 必要に応じて eventUser を自動シード挿入する。
      const circles = await db
        .select()
        .from(circle)
        .where(eq(circle.id, circleId));
      if (circles.length === 0) {
        apiError("NOT_FOUND", `サークル ${circleId} が存在しません`);
      }
      const eventId = circles[0]!.eventId;

      // 2026-07-15: レジ注文(order.ts)と同じく、停止/削除イベントの事前オーダーも拒否する。
      const eventRows = await db.select().from(event).where(eq(event.id, eventId));
      if (eventRows.length === 0 || eventRows[0]!.deletedAt) {
        apiError("BAD_REQUEST", "このイベントは終了しています");
      }
      if (eventRows[0]!.billingStatus === "suspended") {
        apiError("BAD_REQUEST", "このイベントは現在停止中のため注文を受け付けていません");
      }
      // 開催ライフサイクル状態が live 以外なら事前オーダーも受け付けない。
      const lifecycle = eventRows[0]!.lifecycleStatus;
      if (lifecycle === "upcoming") {
        apiError("BAD_REQUEST", "このイベントはまだ開催前のため注文を受け付けていません");
      }
      if (lifecycle === "ended" || lifecycle === "archived") {
        apiError("BAD_REQUEST", "このイベントは終了しているため注文を受け付けていません");
      }
      // 期間(endDate)超過は自動締切のセーフティネット。
      const eventEnd = eventRows[0]!.endDate;
      if (eventEnd && eventEnd.getTime() < Date.now()) {
        apiError("BAD_REQUEST", "このイベントは開催期間を終了しているため注文を受け付けていません");
      }

      const existingUser = await db
        .select()
        .from(eventUser)
        .where(eq(eventUser.id, userId));

      if (existingUser.length === 0) {
        // 2026-07-06: 「発行しないと使えない」方針。任意の userId から eventUser を
        // 自動作成する自己発行の抜け穴を撤去。未発行の userId での事前オーダーは拒否する。
        apiError(
          "FORBIDDEN",
          "リストバンドが発行されていません。受付でリストバンドの発行を受けてください。",
        );
      } else if (existingUser[0]!.status === "banned") {
        // 2026-07-15: BAN された来場者の事前オーダーを拒否する。
        apiError("FORBIDDEN", "このリストバンドは利用できません。受付・本部にお問い合わせください。");
      } else if (existingUser[0]!.eventId !== eventId) {
        // 2026-07-06: クロスイベント混入対策 (H-3, ベストエフォート)。
        // userId は認証を伴わないベアラー値のため、既存の userId を任意に指定して
        // 他人へのなりすましスタンプ付与/抽選不正を狙える。完全な防止にはセッションが
        // 必要でありスコープ外だが、最低限「他イベントの userId を事前オーダーに使う」
        // 経路はここで塞ぐ。同一イベント内でのなりすましは本対応では防げない(残存リスク)。
        apiError("BAD_REQUEST", "ユーザーとサークルのイベントが一致しません");
      }

      // メニュー取得
      const menuIds = items.map((i) => i.menuId);
      const menus = await db
        .select()
        .from(menu)
        .where(inArray(menu.id, menuIds));

      // トッピング取得 (order.ts と同じ検証方針)。指定が無ければ空。
      const allToppingIds = items.flatMap((i) => i.toppingIds || []);
      const toppings =
        allToppingIds.length > 0
          ? await db
              .select()
              .from(topping)
              .where(inArray(topping.id, allToppingIds))
          : [];
      // 指定トッピングが対象メニューに実際に紐付いているかを検証するための関連
      const menuToppingLinks =
        allToppingIds.length > 0
          ? await db
              .select()
              .from(menuTopping)
              .where(inArray(menuTopping.menuId, menuIds))
          : [];

      let totalPrice = 0;
      // トッピングも一緒に保持し、後段でスナップショット挿入する。subtotal はクーポンの
      // 対象メニュー限定割引 (2026-09-16, issue #50 フィードバック対応) の算出に使う。
      const itemList: {
        id: string;
        menuId: string;
        quantity: number;
        subtotal: number;
        toppings: { id: string; name: string; price: number }[];
      }[] = [];

      for (const item of items) {
        const m = menus.find((menuItem) => menuItem.id === item.menuId);
        if (!m) {
          apiError("NOT_FOUND", `メニュー ${item.menuId} が存在しません`);
        }

        // 2026-07-05: クロスサークルIDOR対策。他サークルのメニューが混入していないか検証する
        if (m.circleId !== circleId) {
          apiError("BAD_REQUEST", `メニュー ${m.name} は指定サークルに属していません`);
        }

        // 2026-07-05: 売り切れメニューの事前オーダーをハードゲートで拒否する
        if (m.soldOut) {
          apiError("BAD_REQUEST", `${m.name}は売り切れです`);
        }

        // 2026-07-13: トッピング検証 (order.ts の POST / と同等)。
        const itemToppings = toppings.filter((t) =>
          (item.toppingIds || []).includes(t.id)
        );
        if (itemToppings.length !== (item.toppingIds || []).length) {
          apiError("BAD_REQUEST", "存在しないトッピングが指定されています");
        }
        for (const t of itemToppings) {
          if (t.circleId !== circleId) {
            apiError("BAD_REQUEST", `トッピング ${t.name} は指定サークルに属していません`);
          }
          if (t.soldOut) {
            apiError("BAD_REQUEST", `${t.name}は売り切れです`);
          }
          const isLinked = menuToppingLinks.some(
            (mt) => mt.menuId === m.id && mt.toppingId === t.id
          );
          if (!isLinked) {
            apiError("BAD_REQUEST", `トッピング ${t.name} はメニュー ${m.name} に紐付いていません`);
          }
        }

        const toppingTotal = itemToppings.reduce((sum, t) => sum + t.price, 0);
        const itemSubtotal = (m.price + toppingTotal) * item.quantity;
        totalPrice += itemSubtotal;
        itemList.push({
          id: ulid(),
          menuId: item.menuId,
          quantity: item.quantity,
          subtotal: itemSubtotal,
          toppings: itemToppings.map((t) => ({
            id: t.id,
            name: t.name,
            price: t.price,
          })),
        });
      }

      // クーポン適用 (2026-09-16, issue #50)。指定があれば再検証した上で消費する。
      // 「検証 (checkCouponEligibility) → 使用回数をアトミックに+1 (redeemCouponWithGuard)」の
      // 2段階にしているのは在庫減算 (utils/stock.ts) と同じレースコンディション対策で、
      // 検証後に別リクエストが先に枠を使い切った場合はガード付きUPDATEの方で最終的に弾かれる。
      // 2026-09-16 フィードバック対応: (1) kind (menu_discount / free_topping) に応じて対象が
      // メニューかトッピングかを切り替え、computeCouponDiscount に計算を委ねる。(2) 複数枚
      // 同時適用に対応。まず全クーポンを検証・計算してから消費するのは、途中の1枚が
      // 「対象商品なし」で弾かれた場合に、別の1枚だけ消費済みという半端な状態を避けるため。
      if (new Set(couponInputs.map((i) => i.slug)).size !== couponInputs.length) {
        apiError("BAD_REQUEST", "同じクーポンが複数回指定されています");
      }
      const validatedCoupons: { id: string; title: string; discount: number }[] = [];
      for (const input of couponInputs) {
        const cp = await checkCouponEligibility(db, {
          slug: input.slug,
          passphrase: input.passphrase,
          eventUserId: userId,
          circleId,
        });
        const targetIds =
          cp.kind === "free_topping"
            ? await getCouponToppingIds(db, cp.id)
            : await getCouponMenuIds(db, cp.id);
        const computedDiscount = computeCouponDiscount(cp, targetIds, itemList);
        if (computedDiscount <= 0) {
          apiError(
            "BAD_REQUEST",
            cp.kind === "free_topping"
              ? `クーポン「${cp.title}」の対象トッピングがカートに含まれていません`
              : `クーポン「${cp.title}」の対象メニューがカートに含まれていません`
          );
        }
        validatedCoupons.push({ id: cp.id, title: cp.title, discount: computedDiscount });
      }

      // 2026-07-16 / 2026-09-16: D1 は対話的トランザクション非対応 (claim 同様の既知の制約)。
      // クーポン消費 (ガード付きUPDATE) の後に以下が失敗すると「枠だけ消費されて事前オーダーが
      // 残らない」不整合が起こり得るため、ベストエフォートで消費を戻してから再 throw する。
      const couponRollbacks: (() => Promise<void>)[] = [];
      let discountAmount = 0;
      try {
        for (const vc of validatedCoupons) {
          const { rollback } = await redeemCouponWithGuard(db, vc.id);
          couponRollbacks.push(rollback);
          discountAmount += vc.discount;
        }
        const finalTotalPrice = Math.max(0, totalPrice - discountAmount);
        // preOrder.couponId は単一クーポン向けの補助列。複数枚適用時は特定できないため null にし、
        // 正本は coupon_redemption (preOrderId で複数行を引ける) とする。
        const couponId = validatedCoupons.length === 1 ? validatedCoupons[0]!.id : null;

        // 事前オーダー挿入
        await db.insert(preOrder).values({
          id: preOrderId,
          userId,
          circleId,
          totalPrice: finalTotalPrice,
          status: "pending",
          couponId,
          discountAmount: discountAmount > 0 ? discountAmount : undefined,
        });

        // 事前オーダーアイテム + トッピング挿入
        for (const item of itemList) {
          await db.insert(preOrderItem).values({
            id: item.id,
            preOrderId,
            menuId: item.menuId,
            quantity: item.quantity,
          });
          for (const t of item.toppings) {
            await db.insert(preOrderItemTopping).values({
              id: ulid(),
              preOrderItemId: item.id,
              toppingId: t.id,
              toppingName: t.name,
              toppingPrice: t.price,
            });
          }
        }

        // クーポン使用履歴 (1人1回まで制約の実体でもある)。適用した分だけ1行ずつ記録する。
        for (const vc of validatedCoupons) {
          await db.insert(couponRedemption).values({
            id: ulid(),
            couponId: vc.id,
            eventUserId: userId,
            preOrderId,
            discountApplied: vc.discount,
          });
        }

        return c.json({ id: preOrderId, totalPrice: finalTotalPrice }, 201);
      } catch (innerError) {
        for (const rollback of couponRollbacks) await rollback();
        throw innerError;
      }
    } catch (error) {
      // Phase4: apiError/AppError による意図的な 4xx (NOT_FOUND/BAD_REQUEST/FORBIDDEN 等) を
      // ここで握りつぶして 500 に丸めないよう、AppError はそのまま再 throw して onError に委ねる。
      if (error instanceof AppError) throw error;
      console.error("PreOrder creation error:", error);
      apiError("INTERNAL", "事前オーダーの作成に失敗しました");
    }
  }
);

// コード (リストバンドIDまたはユーザーID) から該当する未受取事前オーダーを取得
// 2026-07-05: フロント確認の結果、register の qr-scanner-modal (スタッフがレジで来場者のQR/リストバンドを
// スキャン) と visitor の MyPage (来場者本人が自分のuserIdで参照) の両方から呼ばれている。
// 来場者導線を壊さないため hasPermission による認可は課さず維持する。
// リストバンド/userIdの保持（QRを提示できること）自体が来場者側の実質的な認証手段であり、
// レスポンスには元々 cashierId 等の内部情報は含まれていないため追加の最小化は不要と判断した。
preOrderRoutes.get("/user/:code", async (c) => {
  const db = c.get("db");
  const code = c.req.param("code");
  const circleId = c.req.query("circleId");

  // 1. ユーザーIDの特定
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

  // 2026-07-13: アイテムに紐づくトッピング(スナップショット)を取得。
  // Register の自動ロードでカートにトッピングまで復元できるようにするため。
  const itemIds = items.map((i) => i.id);
  const itemToppings =
    itemIds.length > 0
      ? await db
          .select()
          .from(preOrderItemTopping)
          .where(inArray(preOrderItemTopping.preOrderItemId, itemIds))
      : [];

  const result = preOrders.map((po) => ({
    ...po,
    items: items
      .filter((i) => i.preOrderId === po.id)
      .map((i) => ({
        ...i,
        menu: menus.find((m) => m.id === i.menuId),
        toppings: itemToppings
          .filter((it) => it.preOrderItemId === i.id)
          .map((it) => ({
            id: it.toppingId,
            name: it.toppingName,
            price: it.toppingPrice,
          })),
      })),
  }));

  return c.json(result);
});

// 店頭レジでの確定処理 (正規注文への引き継ぎ)
preOrderRoutes.post(
  "/:id/claim",
  zBody(
    z.object({
      cashierId: z.string().optional(),
      // 支払い方法 (2026-07-14): レジで選択された方法。事前オーダーの受取確定でも
      // 通常注文と同様に支払い方法を記録する (未指定だと order.payment_method が NULL のままになるため)。
      paymentMethod: z.string().max(30).optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    try {
      const id = c.req.param("id");
      const { cashierId, paymentMethod } = c.req.valid("json");

      const pos = await db.select().from(preOrder).where(eq(preOrder.id, id));
      if (pos.length === 0) {
        apiError("NOT_FOUND", "事前オーダーが見つかりません");
      }
      const po = pos[0]!;

      // 2026-07-05: レジでの確定処理はスタッフ操作のため order:write 必須にする
      // (register の qr-scanner-modal のみが呼び出しており visitor からの呼び出しはない)
      if (!(await hasPermission(c, po.circleId, "order:write"))) {
        apiError("FORBIDDEN", "権限がありません");
      }

      // 2026-10-03: claimの再送は、毎回認可した上で同じ確定結果を返す。
      const command = await orderCommand(`claim:${id}`, id, { id, cashierId, paymentMethod });
      const saved = await committedOrder(c.env.DB, command);
      if (saved) return c.json({ success: true, orderId: saved.id, orderNumber: saved.orderNumber });

      if (po.status !== "pending") {
        apiError("BAD_REQUEST", "この事前オーダーは既に処理されているかキャンセルされています");
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

      // 2026-07-13: 事前オーダーに紐づくトッピング(スナップショット)を取得し、
      // 正規注文へ引き継ぐ。totalPrice は作成時にトッピング込みで計算済みなので再計算しない。
      const itemIds = items.map((i) => i.id);
      const itemToppings =
        itemIds.length > 0
          ? await db
              .select()
              .from(preOrderItemTopping)
              .where(inArray(preOrderItemTopping.preOrderItemId, itemIds))
          : [];

      // 2026-10-03: 商品/トッピングの在庫は共通サービスが確定時に原子的に検証・減算する。
      // 支払い方法の解決 (2026-07-14): 明示指定を優先し、無ければサークルの対応方法が
      // ちょうど1つのときだけそれを補完する (通常注文 order.ts と同じ挙動に揃える)。
      let resolvedPayment: string | undefined = paymentMethod?.trim() || undefined;
      if (!resolvedPayment) {
        const circles = await db.select().from(circle).where(eq(circle.id, po.circleId));
        try {
          const parsed = JSON.parse(circles[0]?.settings || "{}");
          const accepted: unknown = parsed?.acceptedPayments;
          if (Array.isArray(accepted) && accepted.length === 1 && typeof accepted[0] === "string") {
            resolvedPayment = accepted[0];
          }
        } catch {
          /* settings が壊れていても受取確定は通す */
        }
      }

      const committed = await commitOrder(c.env.DB, command, {
        id: ulid(), circleId: po.circleId, userId: po.userId, cashierId,
        peopleCount: 1, totalPrice: po.totalPrice, paymentMethod: resolvedPayment,
        status: "preparing", preOrderId: po.id,
        items: items.map((item) => {
          const m = menus.find((row) => row.id === item.menuId);
          if (!m) apiError("BAD_REQUEST", "商品が削除されています");
          return { menuId: m.id, menuName: m.name, menuPrice: m.price, quantity: item.quantity, inventoryEnabled: m.inventoryEnabled,
            toppings: itemToppings.filter((t) => t.preOrderItemId === item.id).map((t) => ({
              toppingId: t.toppingId, toppingName: t.toppingName, toppingPrice: t.toppingPrice,
            })),
          };
        }),
      });
      return c.json({ success: true, orderId: committed.id, orderNumber: committed.orderNumber });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw error;
    }
  }
);

export default preOrderRoutes;

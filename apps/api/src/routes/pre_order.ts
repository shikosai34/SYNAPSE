import { Hono } from "hono";
import { zBody } from "../z-validator";
import { AppError, apiError } from "../http-error";
import { z } from "zod";
import {
  preOrder,
  preOrderItem,
  preOrderItemTopping,
  order,
  orderItem,
  orderItemTopping,
  menu,
  menuTopping,
  topping,
  wristband,
  eventUser,
  userStamp,
  circle,
  event,
  type DB,
} from "@fesflow/db";
import { eq, and, or, inArray, desc, sql } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import { decrementStockWithGuard } from "../utils/stock";
import type { AppEnv } from "../types";

const preOrderRoutes = new Hono<AppEnv>();

// 注文番号生成関数 (order.ts と同様の処理)
// 2026-07-08 (Phase5): db をモジュール Proxy ではなく引数で受け取る。
async function generateOrderNumber(db: DB, circleId: string): Promise<string> {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
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
  const dateStr = `${(jstNow.getMonth() + 1)
    .toString()
    .padStart(2, "0")}${jstNow.getDate().toString().padStart(2, "0")}`;
  return `${circleId.slice(0, 4)}-${dateStr}-${String(nextNumber).padStart(
    3,
    "0"
  )}`;
}

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
    })
  ),
  async (c) => {
    const db = c.get("db");
    try {
      const { userId, circleId, items } = c.req.valid("json");
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
      // トッピングも一緒に保持し、後段でスナップショット挿入する
      const itemList: {
        id: string;
        menuId: string;
        quantity: number;
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
        totalPrice += (m.price + toppingTotal) * item.quantity;
        itemList.push({
          id: ulid(),
          menuId: item.menuId,
          quantity: item.quantity,
          toppings: itemToppings.map((t) => ({
            id: t.id,
            name: t.name,
            price: t.price,
          })),
        });
      }

      // 事前オーダー挿入
      await db.insert(preOrder).values({
        id: preOrderId,
        userId,
        circleId,
        totalPrice,
        status: "pending",
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

      return c.json({ id: preOrderId, totalPrice }, 201);
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

      // 2026-07-16: 在庫減算のタイミングについて。事前オーダー「作成時」に在庫を予約する案も
      // あったが、来場者が受け取りに来ない (No-show) ケースで在庫だけロックされ続け、他の
      // 来場者が実際には残っている在庫を注文できなくなる問題がある。レジ直販 (order.ts) は
      // 「注文=会計=実売」のタイミングで減算しており、事前オーダーにおける実売相当のタイミングは
      // この受取確定 (claim) である。そのため受取確定時に減算する方針とした。
      // 現在の topping スナップショット (preOrderItemTopping) には name/price のみで
      // 現在庫数 (stockQuantity) が無いため、在庫チェック用に topping 本体を取得する。
      const usedToppingIds = [...new Set(itemToppings.map((it) => it.toppingId))];
      const usedToppings =
        usedToppingIds.length > 0
          ? await db.select().from(topping).where(inArray(topping.id, usedToppingIds))
          : [];

      // order.ts と同じ意味論: stockQuantity === 0 は無制限/未管理を意味し、チェック・減算を
      // スキップする。stockQuantity > 0 のメニュー/トッピングのみ在庫管理対象として必要数を集計する。
      const stockNeeded = new Map<string, number>();
      const toppingStockNeeded = new Map<string, number>();
      for (const item of items) {
        const m = menus.find((menuItem) => menuItem.id === item.menuId);
        // 参照先メニューが既に削除されている場合、後段の注文アイテム作成でもスキップされるため
        // 在庫計算の対象からも除外する。
        if (!m) continue;

        if (m.stockQuantity > 0) {
          stockNeeded.set(m.id, (stockNeeded.get(m.id) || 0) + item.quantity);
        }

        const toppingsForItem = itemToppings.filter((it) => it.preOrderItemId === item.id);
        for (const t of toppingsForItem) {
          const toppingRow = usedToppings.find((x) => x.id === t.toppingId);
          if (toppingRow && toppingRow.stockQuantity > 0) {
            toppingStockNeeded.set(
              toppingRow.id,
              (toppingStockNeeded.get(toppingRow.id) || 0) + item.quantity,
            );
          }
        }
      }

      // 2026-07-16: D1 は対話的トランザクション非対応 (order.ts 参照。過去に db.transaction() で
      // BEGIN が拒否され全注文が500になったリグレッションあり)。そのため order.ts と同じく
      // 逐次実行＋ガード付きUPDATE (在庫不足なら0行更新)＋ベストエフォート補償で実装する。
      // この減算＋補償ロジックは order.ts の POST / と完全に同一だったため utils/stock.ts へ
      // 共通化した (片方だけ直す変更漏れ事故を防ぐため)。
      const { restoreStockBestEffort } = await decrementStockWithGuard(
        db,
        stockNeeded,
        toppingStockNeeded,
        {
          getMenuName: (menuId) => menus.find((m) => m.id === menuId)?.name,
          getToppingName: (toppingId) => usedToppings.find((t) => t.id === toppingId)?.name,
        }
      );

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

      // 正規注文を作成
      const newOrderId = ulid();
      const orderNumber = await generateOrderNumber(db, po.circleId);

      // 2026-07-16: 既知の制約 (order.ts M-5 と同様)。D1 はマルチステートメントの対話的
      // トランザクションに対応していないため、在庫減算 → order insert → orderItem/topping insert
      // → preOrder update は単一のACIDトランザクションではなく逐次実行になっている。
      // 途中で失敗すると「在庫だけ減って注文レコードが残らない」等の不整合が理論上発生し得る。
      // 以下は try/catch で囲み、失敗時に減算済み在庫を戻すベストエフォートの補償のみ行う
      // (在庫減算そのものの失敗は上のガード付きUPDATEで既に処理済みなのでここでは対象外)。
      try {
        await db.insert(order).values({
          id: newOrderId,
          circleId: po.circleId,
          cashierId,
          userId: po.userId,
          orderNumber,
          peopleCount: 1,
          totalPrice: po.totalPrice,
          status: "preparing", // 受取確定と同時に調理開始
          paymentMethod: resolvedPayment,
          completed: false,
        });

        // 注文アイテムを作成
        for (const item of items) {
          const m = menus.find((menuItem) => menuItem.id === item.menuId);
          if (m) {
            const newOrderItemId = ulid();
            await db.insert(orderItem).values({
              id: newOrderItemId,
              orderId: newOrderId,
              menuId: m.id,
              menuName: m.name,
              menuPrice: m.price,
              quantity: item.quantity,
            });

            // 事前オーダーのトッピングを正規注文アイテムへスナップショットのまま引き継ぐ
            const toppingsForItem = itemToppings.filter(
              (it) => it.preOrderItemId === item.id
            );
            for (const t of toppingsForItem) {
              await db.insert(orderItemTopping).values({
                id: ulid(),
                orderItemId: newOrderItemId,
                toppingId: t.toppingId,
                toppingName: t.toppingName,
                toppingPrice: t.toppingPrice,
              });
            }
          }
        }

        // 事前オーダーのステータス更新
        await db
          .update(preOrder)
          .set({ status: "completed" })
          .where(eq(preOrder.id, po.id));

        // スタンプ付与
        if (po.userId) {
          const existingStamp = await db.select().from(userStamp).where(
            and(
              eq(userStamp.userId, po.userId),
              eq(userStamp.circleId, po.circleId)
            )
          );
          if (existingStamp.length === 0) {
            await db.insert(userStamp).values({
              id: ulid(),
              userId: po.userId,
              circleId: po.circleId,
            });
          }
        }
      } catch (innerError) {
        // ベストエフォート補償: order/orderItem 作成が失敗した場合、既に減算済みの
        // メニュー/トッピング在庫を可能な範囲で戻す。逐次実行のため完全なロールバックの保証はない (M-5)。
        await restoreStockBestEffort();
        throw innerError;
      }

      return c.json({ success: true, orderId: newOrderId, orderNumber });
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error("PreOrder claim error:", error);
      apiError("INTERNAL", "受取確定処理に失敗しました");
    }
  }
);

export default preOrderRoutes;

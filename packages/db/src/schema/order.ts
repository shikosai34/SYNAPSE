// order.ts: レジ注文 (order/orderItem/orderItemTopping) と
// 来場者アプリからの事前オーダー (preOrder/preOrderItem) を扱う。
// menu/topping (menu.ts) と eventUser (visitor.ts) の双方に依存するため、
// 依存関係の末端に位置する (このファイルを他ドメインから import しない)。
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { circle } from "./core";
import { menu, topping } from "./menu";
import { eventUser } from "./visitor";
import { ulid } from "ulidx";

// 注文テーブル
export const order = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    userId: text("user_id"), // ゲストの匿名ID (スタンプラリー用)
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull().unique(),
    peopleCount: integer("people_count").notNull(),
    totalPrice: integer("total_price").notNull(),
    status: text("status").notNull().default("pending"), // pending, preparing, completed, cancelled
    completed: integer("completed", { mode: "boolean" })
      .default(false)
      .notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    estimatedTime: integer("estimated_time"), // 完成までの予想時間（分）
    cashierId: text("cashier_id"),
    // 支払い方法 (2026-07-12): レジで選択された方法。集計・日次締めに使う。
    // null=未記録 (支払い方法機能を使う前の注文 / 単一方法で省略された場合はサーバが補完)。
    paymentMethod: text("payment_method"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("order_circleId_idx").on(table.circleId),
    index("order_orderNumber_idx").on(table.orderNumber),
    index("orders_circle_status_created_idx").on(table.circleId, table.status, table.createdAt),
  ]
);

// 注文アイテムテーブル
export const orderItem = sqliteTable(
  "order_item",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    orderId: text("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "cascade" }),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id),
    menuName: text("menu_name").notNull(), // スナップショット
    menuPrice: integer("menu_price").notNull(), // スナップショット
    quantity: integer("quantity").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("order_item_orderId_idx").on(table.orderId),
    index("order_item_menuId_idx").on(table.menuId),
  ]
);

// 注文アイテム-トッピングの中間テーブル
export const orderItemTopping = sqliteTable(
  "order_item_topping",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    orderItemId: text("order_item_id")
      .notNull()
      .references(() => orderItem.id, { onDelete: "cascade" }),
    toppingId: text("topping_id")
      .notNull()
      .references(() => topping.id),
    toppingName: text("topping_name").notNull(), // スナップショット
    toppingPrice: integer("topping_price").notNull(), // スナップショット
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("order_item_topping_orderItemId_idx").on(table.orderItemId),
    index("order_item_topping_toppingId_idx").on(table.toppingId),
  ]
);

// クーポンテーブル (2026-09-16, issue #50)
// サークルが自分たちで「知り合い限定」の割引を作れるようにする機能。
// URL(slug、ランダムな長い文字列で実質的に推測不能)と合言葉の2要素で配布範囲を絞り、
// 合言葉が漏れた場合の被害は maxRedemptions (使用上限回数) で頭数分に抑える設計。
// 小規模イベント運用の割り切りとして、合言葉は平文比較で開始する (issue #50 スコープ外)。
export const coupon = sqliteTable(
  "coupon",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    title: text("title").notNull(), // サークル管理画面用のラベル (例: "友達限定500円引き")
    slug: text("slug").notNull().unique(), // 配布URLに使うランダム文字列
    passphrase: text("passphrase").notNull(), // URLと合わせて口頭ではなくテキストで伝える想定の合言葉
    // 割引の種類 (2026-09-16 フィードバック対応)。
    // menu_discount: 対象メニュー(couponMenu)の小計から discountAmount 円引く。
    // free_topping: 対象トッピング(couponTopping)を freeUnits 個(null=無制限)まで無料にする。
    kind: text("kind").notNull().default("menu_discount"), // menu_discount / free_topping
    // 固定額引き (円)。menu_discount のときのみ使用。free_topping ではトッピングの実価格を
    // 都度参照するため使わない (値上げ/値下げしても常に「そのトッピング分」が引かれるように)。
    discountAmount: integer("discount_amount"),
    // free_topping のときのみ使用。無料にする個数の上限。null = 対象トッピングを全部無料にする
    // (「自由度を無限にする」フィードバック対応。0円引き乱用を防ぐ上限はサークル自身が設定する)。
    freeUnits: integer("free_units"),
    // 使用上限回数。null = 無制限 (2026-09-16 フィードバック対応)。漏洩時の被害を抑えたい
    // サークルは数値を設定し、身内向けで実害を気にしないサークルは無制限のままにできる。
    maxRedemptions: integer("max_redemptions"),
    redeemedCount: integer("redeemed_count").notNull().default(0),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }), // 任意
    status: text("status").notNull().default("active"), // active / disabled
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("coupon_circleId_idx").on(table.circleId),
    index("coupon_slug_idx").on(table.slug),
  ]
);

// クーポンの適用対象メニュー (2026-09-16, issue #50 フィードバック対応, kind=menu_discount 用)。
// 「カート全体からいくら引く」ではなく「特定のメニューを買ったときだけ効く」割引にするため、
// menu_topping と同じ形の中間テーブルで対象メニューを指定する。割引額はこの対象メニューの
// 小計 (数量×単価、トッピング込み) にのみ適用し、それ以外のメニューには影響しない。
export const couponMenu = sqliteTable(
  "coupon_menu",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupon.id, { onDelete: "cascade" }),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("coupon_menu_couponId_idx").on(table.couponId),
    index("coupon_menu_menuId_idx").on(table.menuId),
    uniqueIndex("coupon_menu_coupon_menu_unique").on(table.couponId, table.menuId),
  ]
);

// クーポンの適用対象トッピング (2026-09-16, kind=free_topping 用)。couponMenu と同じ形。
export const couponTopping = sqliteTable(
  "coupon_topping",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupon.id, { onDelete: "cascade" }),
    toppingId: text("topping_id")
      .notNull()
      .references(() => topping.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("coupon_topping_couponId_idx").on(table.couponId),
    index("coupon_topping_toppingId_idx").on(table.toppingId),
    uniqueIndex("coupon_topping_coupon_topping_unique").on(table.couponId, table.toppingId),
  ]
);

// クーポン使用履歴テーブル。(couponId, eventUserId) のユニーク制約で「1人1回まで」を強制する。
export const couponRedemption = sqliteTable(
  "coupon_redemption",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupon.id, { onDelete: "cascade" }),
    eventUserId: text("event_user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    preOrderId: text("pre_order_id")
      .notNull()
      .references(() => preOrder.id, { onDelete: "cascade" }),
    discountApplied: integer("discount_applied").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("coupon_redemption_couponId_idx").on(table.couponId),
    index("coupon_redemption_eventUserId_idx").on(table.eventUserId),
    uniqueIndex("coupon_redemption_coupon_user_unique").on(
      table.couponId,
      table.eventUserId
    ),
  ]
);

// 事前オーダーテーブル
export const preOrder = sqliteTable(
  "pre_order",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    userId: text("user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    totalPrice: integer("total_price").notNull(),
    status: text("status").notNull().default("pending"), // pending / checked_in / completed / cancelled
    // クーポン適用 (2026-09-16, issue #50)。適用が無ければ両方 null。
    // couponId は集計・監査用の参照、discountAmount は「作成時点でいくら引かれたか」の
    // スナップショット (後でクーポン自体の割引額が変わっても過去の注文は変わらないようにする)。
    couponId: text("coupon_id").references(() => coupon.id),
    discountAmount: integer("discount_amount"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("pre_order_userId_idx").on(table.userId),
    index("pre_order_circleId_idx").on(table.circleId),
    index("pre_order_status_idx").on(table.status),
    index("pre_order_circle_status_idx").on(table.circleId, table.status),
  ]
);

// 事前オーダー詳細アイテムテーブル
export const preOrderItem = sqliteTable(
  "pre_order_item",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    preOrderId: text("pre_order_id")
      .notNull()
      .references(() => preOrder.id, { onDelete: "cascade" }),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id),
    quantity: integer("quantity").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("pre_order_item_preOrderId_idx").on(table.preOrderId),
  ]
);

// 事前オーダーアイテム-トッピングの中間テーブル (2026-07-13)
// 来場者モバイルオーダーでもトッピングを選べるようにするため、orderItemTopping と
// 対になる形で事前オーダー側にもトッピングを保持する。claim 時にここのスナップショットを
// そのまま orderItemTopping へ引き継ぐことで、レジ確定後の注文にトッピングが反映される。
export const preOrderItemTopping = sqliteTable(
  "pre_order_item_topping",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    preOrderItemId: text("pre_order_item_id")
      .notNull()
      .references(() => preOrderItem.id, { onDelete: "cascade" }),
    toppingId: text("topping_id")
      .notNull()
      .references(() => topping.id),
    toppingName: text("topping_name").notNull(), // スナップショット
    toppingPrice: integer("topping_price").notNull(), // スナップショット
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("pre_order_item_topping_preOrderItemId_idx").on(table.preOrderItemId),
    index("pre_order_item_topping_toppingId_idx").on(table.toppingId),
  ]
);

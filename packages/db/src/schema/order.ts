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

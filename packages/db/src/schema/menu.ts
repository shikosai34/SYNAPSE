// menu.ts: サークルが提供する商品(メニュー・トッピング)の定義。
// menu/topping と、その中間テーブル menuTopping (どのメニューにどのトッピングを
// 付けられるか) を扱う。relations は ./relations.ts に集約。
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
} from "drizzle-orm/sqlite-core";
import { circle } from "./core";
import { ulid } from "ulidx";

// メニューテーブル
export const menu = sqliteTable(
  "menu",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    imagePath: text("image_path").notNull(),
    description: text("description"),
    additionalInfo: text("additional_info"),
    soldOut: integer("sold_out", { mode: "boolean" }).default(false).notNull(),
    stockQuantity: integer("stock_quantity").default(0).notNull(),
    // 既定トッピング (2026-07-07): レジで追加時に自動適用するトッピングID配列 (JSON)。
    // 正規化しない理由: 表示順を保持した単純なID配列であり、専用テーブル化しても
    // 参照系のクエリが増えるだけで恩恵が薄い。書き込みはメニュー編集時のみで低頻度。
    // アプリ側で JSON.parse に失敗した場合は空配列にフォールバックする前提。
    defaultToppingIds: text("default_topping_ids").default("[]").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("menu_circleId_idx").on(table.circleId)]
);

// トッピングテーブル
export const topping = sqliteTable(
  "topping",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    description: text("description"),
    imagePath: text("image_path"),
    soldOut: integer("sold_out", { mode: "boolean" }).default(false).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("topping_circleId_idx").on(table.circleId)]
);

// メニュー-トッピングの中間テーブル
export const menuTopping = sqliteTable(
  "menu_topping",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    menuId: text("menu_id")
      .notNull()
      .references(() => menu.id, { onDelete: "cascade" }),
    toppingId: text("topping_id")
      .notNull()
      .references(() => topping.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("menu_topping_menuId_idx").on(table.menuId),
    index("menu_topping_toppingId_idx").on(table.toppingId),
  ]
);

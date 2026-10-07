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
    // 2026-10-07 Issue #112: 一覧をカテゴリ単位で絞り込めるよう、空文字を未分類として保持する。
    category: text("category").default("").notNull(),
    price: integer("price").notNull(),
    imagePath: text("image_path").notNull(),
    description: text("description"),
    additionalInfo: text("additional_info"),
    soldOut: integer("sold_out", { mode: "boolean" }).default(false).notNull(),
    stockQuantity: integer("stock_quantity").default(0).notNull(),
    // 2026-09-27: 在庫は商品単位で明示的に有効化する。数量0を未管理と混同せず、
    // 未選択の商品を注文時に誤って在庫切れにしないため既定はOFF。
    inventoryEnabled: integer("inventory_enabled", { mode: "boolean" })
      .default(false)
      .notNull(),
    // 既定トッピング (2026-07-07): レジで追加時に自動適用するトッピングID配列 (JSON)。
    // 正規化しない理由: 表示順を保持した単純なID配列であり、専用テーブル化しても
    // 参照系のクエリが増えるだけで恩恵が薄い。書き込みはメニュー編集時のみで低頻度。
    // アプリ側で JSON.parse に失敗した場合は空配列にフォールバックする前提。
    defaultToppingIds: text("default_topping_ids").default("[]").notNull(),
    // 2026-10-07 Issue #111: 選択順とカテゴリごとの最低数を商品設定にまとめ、画面間で共通化する。
    toppingWizardEnabled: integer("topping_wizard_enabled", { mode: "boolean" })
      .default(false)
      .notNull(),
    toppingCategoryMinimums: text("topping_category_minimums").default("{}").notNull(),
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
    // 2026-10-07 Issue #111: トッピングのカテゴリは自由入力で追加できる分類名として扱う。
    category: text("category").default("").notNull(),
    price: integer("price").notNull(),
    description: text("description"),
    imagePath: text("image_path"),
    soldOut: integer("sold_out", { mode: "boolean" }).default(false).notNull(),
    // 在庫数 (2026-07-15 追加)。メニューと同じ意味論: 0 = 在庫無制限/未管理(チェック・減算しない)、
    // 1 以上 = 在庫管理対象で、注文のたびに減り 0 になると soldOut を自動セットする。
    stockQuantity: integer("stock_quantity").default(0).notNull(),
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

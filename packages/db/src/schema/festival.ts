import { relations, sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ロール定義 (SaaS対応 - 2026-07-04)
// システム管理、イベント管理、サークル管理の3階層へ統合再構築。
export const ROLES = {
  // システム権限 (グローバルSaaS管理者)
  SUPER_ADMIN: "super_admin",
  // イベント権限 (イベント/文化祭単位の管理者)
  EVENT_MANAGER: "event_manager",
  // サークル権限 (模擬店/ブース単位の管理者・スタッフ)
  CIRCLE_MANAGER: "circle_manager",
  CIRCLE_STAFF: "circle_staff",
} as const;

export type RoleType = (typeof ROLES)[keyof typeof ROLES];

// ロールの権限定義 (2026-07-04 簡易化)
export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: [
    "system:read",
    "system:write",
    "event:read",
    "event:write",
    "event:delete",
    "circle:read",
    "circle:write",
    "circle:delete",
    "menu:read",
    "menu:write",
    "menu:delete",
    "order:read",
    "order:write",
    "order:delete",
    "staff:read",
    "staff:write",
    "staff:delete",
    "stock:read",
    "stock:write",
    "sales:read",
    "member:read",
    "member:write",
    "member:delete",
  ],
  [ROLES.EVENT_MANAGER]: [
    "event:read",
    "event:write",
    "circle:read",
    "circle:write",
    "circle:delete",
    "menu:read",
    "menu:write",
    "menu:delete",
    "order:read",
    "order:write",
    "order:delete",
    "staff:read",
    "staff:write",
    "staff:delete",
    "stock:read",
    "stock:write",
    "sales:read",
    "member:read",
    "member:write",
    "member:delete",
  ],
  [ROLES.CIRCLE_MANAGER]: [
    "circle:read",
    "circle:write",
    "menu:read",
    "menu:write",
    "menu:delete",
    "order:read",
    "order:write",
    "staff:read",
    "staff:write",
    "staff:delete",
    "stock:read",
    "stock:write",
    "sales:read",
    "member:read",
    "member:write",
  ],
  [ROLES.CIRCLE_STAFF]: [
    "circle:read",
    "menu:read",
    "order:read",
    "order:write",
    "stock:read",
    "stock:write",
    "staff:read",
  ],
} as const;

export type Permission = (typeof ROLE_PERMISSIONS)[RoleType][number];

// イベントテーブル
export const event = sqliteTable("event", {
  id: text("id").primaryKey(),
  eventName: text("event_name").notNull(),
  description: text("description"),
  startDate: integer("start_date", { mode: "timestamp_ms" }),
  endDate: integer("end_date", { mode: "timestamp_ms" }),
  // テーマパック用カラム
  logoUrl: text("logo_url"),
  fontFamily: text("font_family").default("mono"),
  customFontUrl: text("custom_font_url"),
  primaryColor: text("primary_color").default("#000000"),
  primaryTextColor: text("primary_text_color").default("#FFFFFF"),
  accentColor: text("accent_color").default("#0000FF"),
  accentTextColor: text("accent_text_color").default("#FFFFFF"),
  backgroundColor: text("background_color").default("#FFFFFF"),
  textColor: text("text_color").default("#000000"),


  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
});


// サークルテーブル
export const circle = sqliteTable(
  "circle",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    password: text("password").notNull(),
    iconImagePath: text("icon_image_path"),
    backgroundImagePath: text("background_image_path"),
    mods: text("mods").default("{}").notNull(),
    // スタンプラリー用 TOTP シークレット(base32)。null=このサークルのOTPスタンプ無効 (2026-07-04)
    stampSecret: text("stamp_secret"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("circle_eventId_idx").on(table.eventId)]
);

// メニューテーブル
export const menu = sqliteTable(
  "menu",
  {
    id: text("id").primaryKey(),
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
    id: text("id").primaryKey(),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    description: text("description"),
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
    id: text("id").primaryKey(),
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

// 注文テーブル
export const order = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
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
  ]
);

// 注文アイテムテーブル
export const orderItem = sqliteTable(
  "order_item",
  {
    id: text("id").primaryKey(),
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
    id: text("id").primaryKey(),
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

// スタッフ/シフトテーブル
export const staff = sqliteTable(
  "staff",
  {
    id: text("id").primaryKey(),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shiftStart: integer("shift_start", { mode: "timestamp_ms" }),
    shiftEnd: integer("shift_end", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("staff_circleId_idx").on(table.circleId)]
);

// リレーション定義
export const eventRelations = relations(event, ({ many }) => ({
  circles: many(circle),
}));

export const circleRelations = relations(circle, ({ one, many }) => ({
  event: one(event, {
    fields: [circle.eventId],
    references: [event.id],
  }),
  menus: many(menu),
  toppings: many(topping),
  orders: many(order),
  staff: many(staff),
}));

export const menuRelations = relations(menu, ({ one, many }) => ({
  circle: one(circle, {
    fields: [menu.circleId],
    references: [circle.id],
  }),
  menuToppings: many(menuTopping),
  orderItems: many(orderItem),
}));

export const toppingRelations = relations(topping, ({ one, many }) => ({
  circle: one(circle, {
    fields: [topping.circleId],
    references: [circle.id],
  }),
  menuToppings: many(menuTopping),
  orderItemToppings: many(orderItemTopping),
}));

export const menuToppingRelations = relations(menuTopping, ({ one }) => ({
  menu: one(menu, {
    fields: [menuTopping.menuId],
    references: [menu.id],
  }),
  topping: one(topping, {
    fields: [menuTopping.toppingId],
    references: [topping.id],
  }),
}));

export const orderRelations = relations(order, ({ one, many }) => ({
  circle: one(circle, {
    fields: [order.circleId],
    references: [circle.id],
  }),
  orderItems: many(orderItem),
}));

export const orderItemRelations = relations(orderItem, ({ one, many }) => ({
  order: one(order, {
    fields: [orderItem.orderId],
    references: [order.id],
  }),
  menu: one(menu, {
    fields: [orderItem.menuId],
    references: [menu.id],
  }),
  orderItemToppings: many(orderItemTopping),
}));

export const orderItemToppingRelations = relations(
  orderItemTopping,
  ({ one }) => ({
    orderItem: one(orderItem, {
      fields: [orderItemTopping.orderItemId],
      references: [orderItem.id],
    }),
    topping: one(topping, {
      fields: [orderItemTopping.toppingId],
      references: [topping.id],
    }),
  })
);

export const staffRelations = relations(staff, ({ one }) => ({
  circle: one(circle, {
    fields: [staff.circleId],
    references: [circle.id],
  }),
}));

// メンバーシップテーブル（ユーザーとサークル/イベントの紐付け + ロール）
export const membership = sqliteTable(
  "membership",
  {
    id: text("id").primaryKey(),
    // ユーザー識別（メールアドレスまたはユーザーID）
    userEmail: text("user_email").notNull(),
    userName: text("user_name").notNull(),
    // サークルまたはイベントへの所属
    circleId: text("circle_id").references(() => circle.id, {
      onDelete: "cascade",
    }),
    eventId: text("event_id").references(() => event.id, {
      onDelete: "cascade",
    }),
    // ロール
    role: text("role").notNull().default("viewer"),
    // PIN（簡易認証用）
    pin: text("pin"),
    // アクティブ状態
    isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
    // 招待状態
    invitedAt: integer("invited_at", { mode: "timestamp_ms" }),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("membership_userEmail_idx").on(table.userEmail),
    index("membership_circleId_idx").on(table.circleId),
    index("membership_eventId_idx").on(table.eventId),
    uniqueIndex("membership_user_circle_unique").on(
      table.userEmail,
      table.circleId
    ),
    uniqueIndex("membership_user_event_unique").on(
      table.userEmail,
      table.eventId
    ),
  ]
);

// 招待トークンテーブル
export const inviteToken = sqliteTable(
  "invite_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    // 招待先
    circleId: text("circle_id").references(() => circle.id, {
      onDelete: "cascade",
    }),
    eventId: text("event_id").references(() => event.id, {
      onDelete: "cascade",
    }),
    // 付与するロール
    role: text("role").notNull(),
    // 使用制限
    maxUses: integer("max_uses").default(1),
    usedCount: integer("used_count").default(0).notNull(),
    // 有効期限
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").notNull(), // 作成者のメールアドレス
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("invite_token_token_idx").on(table.token),
    index("invite_token_circleId_idx").on(table.circleId),
    index("invite_token_eventId_idx").on(table.eventId),
  ]
);

// メンバーシップのリレーション
export const membershipRelations = relations(membership, ({ one }) => ({
  circle: one(circle, {
    fields: [membership.circleId],
    references: [circle.id],
  }),
  event: one(event, {
    fields: [membership.eventId],
    references: [event.id],
  }),
}));

// 招待トークンのリレーション
export const inviteTokenRelations = relations(inviteToken, ({ one }) => ({
  circle: one(circle, {
    fields: [inviteToken.circleId],
    references: [circle.id],
  }),
  event: one(event, {
    fields: [inviteToken.eventId],
    references: [event.id],
  }),
}));

// スタンプテーブル
export const userStamp = sqliteTable(
  "user_stamp",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(), // ゲストの匿名ID
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("user_stamp_userId_idx").on(table.userId),
    index("user_stamp_circleId_idx").on(table.circleId),
    uniqueIndex("user_stamp_user_circle_unique").on(
      table.userId,
      table.circleId
    ),
  ]
);

// 景品交換テーブル
export const rewardRedemption = sqliteTable(
  "reward_redemption",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().unique(), // 1人1回まで
    staffId: text("staff_id").notNull(), // 交換を対応したスタッフのIDまたはメール
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("reward_redemption_userId_idx").on(table.userId),
  ]
);

// スタンプのリレーション
export const userStampRelations = relations(userStamp, ({ one }) => ({
  circle: one(circle, {
    fields: [userStamp.circleId],
    references: [circle.id],
  }),
}));

// ==========================================
// ユーザー・リストバンド・事前オーダー関連定義
// ==========================================

// イベント来場ユーザーテーブル
export const eventUser = sqliteTable(
  "event_user",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    displayId: integer("display_id").notNull(), // 表示用呼出ID (1, 2, 3...)
    status: text("status").notNull().default("available"), // available / banned
    // 来場者マイページの最小プロフィール (2026-07-04 追加)。
    // リストバンド紛失時の本人確認/再紐付け用にニックネーム+誕生日のみ収集。
    nickname: text("nickname"),
    birthday: text("birthday"), // YYYY-MM-DD
    onboardedAt: integer("onboarded_at", { mode: "timestamp_ms" }), // 初回入力完了時刻
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("event_user_eventId_idx").on(table.eventId),
    uniqueIndex("event_user_event_display_unique").on(
      table.eventId,
      table.displayId
    ),
  ]
);

// リストバンド管理テーブル (ユーザーとリストバンドの1:N紐付け)
export const wristband = sqliteTable(
  "wristband",
  {
    id: text("id").primaryKey(), // リストバンドの物理コード / QR値
    userId: text("user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"), // active / lost / replaced / revoked
    assignedAt: integer("assigned_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    deactivatedAt: integer("deactivated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("wristband_userId_idx").on(table.userId),
    index("wristband_status_idx").on(table.status),
  ]
);

// 事前オーダーテーブル
export const preOrder = sqliteTable(
  "pre_order",
  {
    id: text("id").primaryKey(),
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
  ]
);

// 事前オーダー詳細アイテムテーブル
export const preOrderItem = sqliteTable(
  "pre_order_item",
  {
    id: text("id").primaryKey(),
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

// リレーション定義の追加
export const eventUserRelations = relations(eventUser, ({ one, many }) => ({
  event: one(event, {
    fields: [eventUser.eventId],
    references: [event.id],
  }),
  wristbands: many(wristband),
  preOrders: many(preOrder),
}));

export const wristbandRelations = relations(wristband, ({ one }) => ({
  user: one(eventUser, {
    fields: [wristband.userId],
    references: [eventUser.id],
  }),
}));

export const preOrderRelations = relations(preOrder, ({ one, many }) => ({
  user: one(eventUser, {
    fields: [preOrder.userId],
    references: [eventUser.id],
  }),
  circle: one(circle, {
    fields: [preOrder.circleId],
    references: [circle.id],
  }),
  items: many(preOrderItem),
}));

export const preOrderItemRelations = relations(preOrderItem, ({ one }) => ({
  preOrder: one(preOrder, {
    fields: [preOrderItem.preOrderId],
    references: [preOrder.id],
  }),
  menu: one(menu, {
    fields: [preOrderItem.menuId],
    references: [menu.id],
  }),
}));



// ==========================================
// 来場者マイページ機能 (2026-07-04 追加)
//  - スタンプは既存 user_stamp、事前オーダーは既存 pre_order を利用。
//  - ここでは 体験ログ / 整理券 / レビュー / 抽選 を追加する。
// ==========================================

// 体験ログ: レジ/受付でリストバンドをスキャンした記録。
// レビュー投稿の可否・抽選口数の根拠になる (「体験したものだけ」)。
export const circleVisit = sqliteTable(
  "circle_visit",
  {
    id: text("id").primaryKey(),
    eventUserId: text("event_user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    staffId: text("staff_id"), // 対応スタッフ (任意)
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("circle_visit_user_idx").on(table.eventUserId),
    index("circle_visit_circle_idx").on(table.circleId),
    index("circle_visit_user_circle_idx").on(table.eventUserId, table.circleId),
  ]
);

// 整理券: サークルの端末で来場者に時間指定で発行する。
export const numberedTicket = sqliteTable(
  "numbered_ticket",
  {
    id: text("id").primaryKey(),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    eventUserId: text("event_user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    slotStart: integer("slot_start", { mode: "timestamp_ms" }), // 案内時間帯の開始
    slotLabel: text("slot_label"), // 表示用ラベル (例 "13:00-13:30")
    status: text("status").notNull().default("issued"), // issued / used / expired / cancelled
    issuedByStaffId: text("issued_by_staff_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("numbered_ticket_circle_idx").on(table.circleId),
    index("numbered_ticket_user_idx").on(table.eventUserId),
    index("numbered_ticket_status_idx").on(table.status),
  ]
);

// レビュー: 体験したサークルへの任意投稿。1ユーザー1サークル1件。
export const review = sqliteTable(
  "review",
  {
    id: text("id").primaryKey(),
    eventUserId: text("event_user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    circleId: text("circle_id")
      .notNull()
      .references(() => circle.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(), // 1-5
    comment: text("comment"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("review_circle_idx").on(table.circleId),
    index("review_user_idx").on(table.eventUserId),
    uniqueIndex("review_user_circle_unique").on(
      table.eventUserId,
      table.circleId
    ),
  ]
);

// 抽選: イベント単位の抽選設定 (発表時刻など)。
export const lottery = sqliteTable(
  "lottery",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    drawAt: integer("draw_at", { mode: "timestamp_ms" }), // 当選発表時刻 (例 17:00)
    status: text("status").notNull().default("open"), // open / drawn / closed
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index("lottery_event_idx").on(table.eventId)]
);

// 抽選の景品定義。
export const lotteryPrize = sqliteTable(
  "lottery_prize",
  {
    id: text("id").primaryKey(),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lottery.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [index("lottery_prize_lottery_idx").on(table.lotteryId)]
);

// 抽選応募 (オプトイン)。口数はスタンプ数+レビュー数から集計時に算出する。
export const lotteryEntry = sqliteTable(
  "lottery_entry",
  {
    id: text("id").primaryKey(),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lottery.id, { onDelete: "cascade" }),
    eventUserId: text("event_user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("lottery_entry_lottery_idx").on(table.lotteryId),
    uniqueIndex("lottery_entry_lottery_user_unique").on(
      table.lotteryId,
      table.eventUserId
    ),
  ]
);

// 抽選結果 (当選者)。
export const lotteryWinner = sqliteTable(
  "lottery_winner",
  {
    id: text("id").primaryKey(),
    lotteryId: text("lottery_id")
      .notNull()
      .references(() => lottery.id, { onDelete: "cascade" }),
    prizeId: text("prize_id")
      .notNull()
      .references(() => lotteryPrize.id, { onDelete: "cascade" }),
    eventUserId: text("event_user_id")
      .notNull()
      .references(() => eventUser.id, { onDelete: "cascade" }),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }), // 景品受取時刻
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("lottery_winner_lottery_idx").on(table.lotteryId),
    index("lottery_winner_user_idx").on(table.eventUserId),
  ]
);

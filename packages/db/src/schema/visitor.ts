// visitor.ts: 来場者(eventUser)まわりのドメイン。
// リストバンド紐付け、サークル体験ログ、スタンプ/景品交換、整理券、レビューを扱う。
// 事前オーダー (preOrder) は注文ドメインとの結合が強いため order.ts 側に置く。
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { event, circle } from "./core";
import { ulid } from "ulidx";

// イベント来場ユーザーテーブル
export const eventUser = sqliteTable(
  "event_user",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    displayId: integer("display_id").notNull(), // 表示用呼出ID (1, 2, 3...)
    status: text("status").notNull().default("available"), // available / banned
    // 来場者マイページの最小プロフィール (2026-07-04 追加)。
    // リストバンド紛失時の本人確認/再紐付け用にニックネーム+誕生日のみ収集。
    nickname: text("nickname"),
    favoriteDate: text("favorite_date"), // YYYY-MM-DD (旧 birthday)
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
    id: text("id").primaryKey().$defaultFn(() => ulid()), // リストバンドの物理コード / QR値
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

// ==========================================
// 来場者マイページ機能 (2026-07-04 追加)
//  - スタンプは既存 user_stamp、事前オーダーは既存 pre_order を利用。
//  - ここでは 体験ログ / 整理券 / レビュー / 抽選 を追加する。
//    (抽選テーブル本体は lottery.ts に分離済み)
// ==========================================

// 体験ログ: レジ/受付でリストバンドをスキャンした記録。
// レビュー投稿の可否・抽選口数の根拠になる (「体験したものだけ」)。
export const circleVisit = sqliteTable(
  "circle_visit",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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

// スタンプテーブル
export const userStamp = sqliteTable(
  "user_stamp",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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

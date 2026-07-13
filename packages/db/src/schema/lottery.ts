// lottery.ts: イベント単位の抽選機能。抽選設定・景品・応募・当選結果を扱う。
// スタンプ数/レビュー数から算出する応募口数はアプリ側の集計ロジックに委譲する
// (このテーブル群には口数を直接持たせない)。
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { event } from "./core";
import { eventUser } from "./visitor";
import { ulid } from "ulidx";

// 抽選: イベント単位の抽選設定 (発表時刻など)。
export const lottery = sqliteTable(
  "lottery",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    drawAt: integer("draw_at", { mode: "timestamp_ms" }), // 当選発表時刻 (例 17:00)
    status: text("status").notNull().default("open"), // open / drawn / closed
    // 口数(当選確率)の重み設定 (2026-07-12)。JSON: { base, perStamp, perReview }。
    // 応募者の口数 = base + perStamp*スタンプ数 + perReview*レビュー数。
    // 「様々なニーズ」に対応するため重みを主催者が調整できる。
    entryConfig: text("entry_config").default('{"base":1,"perStamp":0,"perReview":0}').notNull(),
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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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

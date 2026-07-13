// core.ts: イベント/サークルの基盤スキーマ。
// ロール・権限定義、event/circle/membership/inviteToken/staff など、
// 他の全ドメイン(menu/order/visitor/lottery/system)が参照する土台をここに置く。
// 循環import回避のため、他ドメインのテーブルを import しない設計とする。
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { ulid } from "ulidx";

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
  id: text("id").primaryKey().$defaultFn(() => ulid()),
  eventName: text("event_name").notNull(),
  description: text("description"),
  startDate: integer("start_date", { mode: "timestamp_ms" }),
  endDate: integer("end_date", { mode: "timestamp_ms" }),

  // ── SaaS テナント/課金 (2026-07-12) ───────────────────────────────
  // イベント=テナント(契約単位)。イベント作成はセルフサービス化され、既定は無料枠。
  // plan: 契約プラン。当面 "free" のみ実運用 (standard/pro は将来の Stripe フェーズで使用)。
  plan: text("plan").default("free").notNull(),
  // billingStatus: 有効/試用/停止/未払い。suspended は新規作成系を止める運用ガードに使う。
  billingStatus: text("billing_status").default("active").notNull(),
  // maxCircles: このイベント配下に作成できるサークル数の上限。無料枠=1。
  // プラン変更 (手動 or 将来 Stripe webhook) でここを書き換える。
  maxCircles: integer("max_circles").default(1).notNull(),
  // paymentMethods: イベントで利用可能な支払い方法の一覧 (JSON 文字列配列)。
  // 例: '["現金","PayPay","金券"]'。各サークルはこの中から対応する方法を選ぶ。
  // 2026-07-12: レジで支払い方法を選択して注文するフローの基盤。
  paymentMethods: text("payment_methods").default('["現金"]').notNull(),
  // lotteryEnabled: 抽選機能(イベント単位)の有効化フラグ。拡張機能=ONにしないと使えない。
  // 2026-07-12。実際の抽選設定・景品・応募・当選は lottery テーブル群。
  lotteryEnabled: integer("lottery_enabled", { mode: "boolean" }).default(false).notNull(),
  // ownerEmail: 作成者=主たる event_manager。課金・連絡の主体。
  ownerEmail: text("owner_email"),
  // Stripe 連携用 (将来フェーズ。現状は未使用の予約カラム)。
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // 有効化/停止の時刻 (手動有効化・銀行振込対応の監査用)。
  activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
  suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),

  // テーマパック用カラム
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

  // 物理リストバンドの有無フラグ (2026-07-12)
  hasPhysicalWristband: integer("has_physical_wristband", { mode: "boolean" }).default(true).notNull(),

  // 論理削除 (2026-07-04): 物理削除せず deletedAt に時刻を入れて非表示化する
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),

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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    eventId: text("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // 2026-07-07 (Phase 3a): 独自パスワード認証 (POST /api/festivals/login) の廃止に伴い
    // password カラムを削除。認証は better-auth (メール/パスワード + passkey + Google) に
    // 一本化され、サークル代表者は作成者本人の better-auth アカウントで判定するため
    // このカラムは不要 (後方互換のランダムパスワードを入れているだけの死にカラムだった)。
    iconImagePath: text("icon_image_path"),
    backgroundImagePath: text("background_image_path"),
    // サークル拡張機能フラグ (在庫/スタッフ管理などのON/OFF) をJSON文字列で保持する。
    // 正規化しない理由 (2026-07-07): 拡張機能の種類が流動的で頻繁に増減するため、
    // 列追加のマイグレーションを都度発生させたくない。書き込み頻度は低く(設定変更時のみ)、
    // 読み取り時はアプリ側で未知キー/欠損キーをデフォルト値にフォールバックする前提。
    // 正規化 (専用テーブル化) は Phase 4/6 で検討する。
    mods: text("mods").default("{}").notNull(),
    // サークル運用設定 (2026-07-04): 注文モード・組み込み拡張(在庫/スタッフ)のON/OFF等を
    // JSON文字列で保持する。既定は {} で、未設定キーはアプリ側でデフォルトにフォールバックする。
    // (mods と同様の理由でJSONのまま維持。正規化はしない: Phase 4/6 の範囲)
    settings: text("settings").default("{}").notNull(),
    // スタンプラリー用 TOTP シークレット(base32)。null=このサークルのOTPスタンプ無効 (2026-07-04)
    stampSecret: text("stamp_secret"),
    // 論理削除 (2026-07-04): 物理削除せず deletedAt に時刻を入れて非表示化する
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
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

// スタッフ/シフトテーブル
export const staff = sqliteTable(
  "staff",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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

// メンバーシップテーブル（ユーザーとサークル/イベントの紐付け + ロール）
export const membership = sqliteTable(
  "membership",
  {
    id: text("id").primaryKey().$defaultFn(() => ulid()),
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
    // 2026-07-07 (Phase 3a): 独自 PIN 認証 (POST /api/memberships/authenticate-pin) の
    // 廃止に伴い pin カラムを削除。認証は better-auth (メール/パスワード + passkey +
    // Google) に一本化する。
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
    id: text("id").primaryKey().$defaultFn(() => ulid()),
    token: text("token").notNull().unique(),
    // 2026-07-12 (SaaS): 手入力用の短い人間可読コード (例: 8桁英数)。
    // token(32桁) はリンク用、code は口頭/チャットで伝える手入力用。どちらでも受理する。
    code: text("code").unique(),
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
    targetEmail: text("target_email"), // 招待相手のメールアドレス (特定の人に送る場合)
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

// 注意: event/circle/staff/membership/inviteToken の relations() 定義は
// このファイルには置かない。drizzle の relations() はテーブルごとに1回しか
// 定義できず(後勝ちで上書きされる)、event/circle は menu/order/visitor/lottery
// 等の他ドメインテーブルとも関連を持つため、全ドメインのテーブルが揃う
// ./relations.ts に集約している。circular import を避けるための設計。

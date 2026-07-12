// system.ts: プラットフォーム全体の運用系テーブル。
// システム設定・お知らせ・ユーザー通知・認証レート制限を扱う。
// event/circle 等への外部キーを持たない、独立したテーブル群。
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// 通知テーブル (2026-07-04 SaaS通知対応)
export const notification = sqliteTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(), // 受信者のメールアドレス
    title: text("title").notNull(),
    message: text("message").notNull(),
    type: text("type").notNull(), // "invite" | "info" など
    status: text("status").default("unread").notNull(), // "unread" | "read"
    circleName: text("circle_name"),
    eventName: text("event_name"),
    token: text("token"), // 招待の場合のトークン値
    role: text("role"), // 招待の場合の付与ロール
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("notification_user_idx").on(table.userEmail),
    index("notification_status_idx").on(table.status),
  ]
);

// ==========================================
// 認証レート制限 / アカウントロックアウト (2026-07-05 追加, 監査 High: H4)
//  - 目的: PIN 総当たり (POST /api/memberships/authenticate-pin) と
//    サークルパスワード総当たり (POST /api/festivals/login) の「オンライン総当たり」を抑止する。
//  - 方針: bcrypt のコストは上げない (bcryptjs は純JSで低速。Workers の CPU 制約下で
//    コストを上げると認証1回で CPU 予算を超え得るため)。代わりに「失敗回数の計数 + 一定回数で
//    ロックアウト」で対処する。既定は 5 回失敗 / 15 分ロック (helper 側の定数)。
//  - キー設計: 1 バケット = 1 行。key は scope と識別子を結合した文字列
//    (例 "pin:ip:1.2.3.4" / "pin:target:<circleId>:<email>" / "circle_login:ip:...")。
//    IP バケットと対象 (circle/event) バケットを独立に持ち、どちらかがロックしたら拒否する
//    (単一 IP からの多対象攻撃・多 IP からの単一対象攻撃の双方を捕捉するため)。
//  - 注意: D1(SQLite) の read-modify-write は厳密なアトミック性を持たないため、極端な高並列時に
//    計数が数回甘くなり得るが、ロックアウトという緩和目的では許容範囲。行は (ip, 対象) の
//    組の数に比例して有限で、文化祭は短命なため定期削除は設けていない (必要なら scope で一括削除可)。
// システム全体設定 (2026-07-06)。key-value。super_admin のみ更新可、公開値のみ配信。
// 例: key="maintenance" value=JSON{enabled,message} / key="announcement" value=JSON{enabled,message,level}
export const systemSetting = sqliteTable("system_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
});

// お知らせ (2026-07-06)。super_admin が CMS 的に複数管理。公開分を全アプリの
// [お知らせ・通知] やバナーに配信する。maintenance は system_setting 側で管理。
export const announcement = sqliteTable(
  "announcement",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    // 表示レベル: info | warning | critical
    level: text("level").notNull().default("info"),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("announcement_published_idx").on(table.published)],
);

// ==========================================
// SaaS 運営者の権限昇格 (sudo) / なりすまし (impersonation) / 監査ログ
//  (2026-07-12 Phase D/E)
//  - 方針: super_admin は普段 admin 相当で動き、テナントの「内容」は見られない。
//    機微操作の前にパスキー再認証で時間制限付き (15分) に昇格 (sudoSession)。
//    テナント内容へのアクセスは「なりすまし (impersonation)」経由に限り、全操作を監査する。
//  - キー設計: いずれも better-auth のセッション ID (session.session.id) に紐づける
//    (= ログインセッション=端末単位。ログアウトや別端末には波及しない)。
//  - event/circle への外部キーは持たない (このファイルの独立性方針)。ID は text で保持。

// 昇格 (sudo) セッション。有効な行があれば requireSudo を通過できる。
export const sudoSession = sqliteTable(
  "sudo_session",
  {
    id: text("id").primaryKey(),
    // better-auth のセッション ID (この昇格が有効なログインセッション)
    sessionId: text("session_id").notNull(),
    userEmail: text("user_email").notNull(),
    // 昇格の手段 (監査用): "passkey" 等
    method: text("method").notNull().default("passkey"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("sudo_session_session_unique").on(table.sessionId)]
);

// なりすまし (impersonation) セッション。有効な行があれば、そのセッションの認可は
// actorEmail 本人ではなく「対象ロール×スコープ」として評価される。開始は要 sudo。
export const impersonationSession = sqliteTable(
  "impersonation_session",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    // なりすましている本人 (super_admin) のメール
    actorEmail: text("actor_email").notNull(),
    // なりすまし対象のロールとスコープ (event_manager+eventId / circle_manager+circleId 等)
    role: text("role").notNull(),
    eventId: text("event_id"),
    circleId: text("circle_id"),
    // 表示用ラベル (どのイベント/サークルか)
    label: text("label"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex("impersonation_session_session_unique").on(table.sessionId)]
);

// 監査ログ。昇格・なりすまし開始/終了、なりすまし中の変更操作を記録する。
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorEmail: text("actor_email").notNull(),
    // 種別: "elevate" | "impersonate_start" | "impersonate_stop" | "impersonated_write"
    action: text("action").notNull(),
    // なりすまし中の場合の対象コンテキスト
    asRole: text("as_role"),
    eventId: text("event_id"),
    circleId: text("circle_id"),
    // HTTP 情報 (impersonated_write の場合)
    method: text("method"),
    path: text("path"),
    // 補足 (対象ラベル等)
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("audit_log_actor_idx").on(table.actorEmail),
    index("audit_log_created_idx").on(table.createdAt),
  ]
);

export const authAttempt = sqliteTable(
  "auth_attempt",
  {
    id: text("id").primaryKey(),
    // レート制限バケットキー (scope + 識別子を結合)。1 バケット 1 行。
    key: text("key").notNull(),
    // 分類ラベル (可観測性 / 一括クリーンアップ用): "pin" | "circle_login" など
    scope: text("scope").notNull(),
    // 現在の計数ウィンドウ内での失敗回数
    failedCount: integer("failed_count").notNull().default(0),
    // 計数ウィンドウの起点。ここから windowMs 経過 (かつ非ロック) で失敗回数をリセットする。
    firstFailedAt: integer("first_failed_at", { mode: "timestamp_ms" }).notNull(),
    lastFailedAt: integer("last_failed_at", { mode: "timestamp_ms" }).notNull(),
    // ロックアウト解除時刻 (null=未ロック)。この時刻まで当該バケットへの試行を全拒否する。
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("auth_attempt_key_unique").on(table.key),
    index("auth_attempt_locked_until_idx").on(table.lockedUntil),
  ]
);

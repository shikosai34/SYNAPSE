/**
 * API Worker エントリ (2026-07-08 Phase5: ALS+Proxy 撤去 → 明示的 per-request DI にリライト)
 *
 * 変更意図:
 * - 旧 apps/server は @hono/node-server の serve() で Node ポートを開き、
 *   アップロードを fs.writeFileSync でローカル public/ に保存していた。
 *   どちらも Workers では動かないため次のように置き換えた:
 *     - serve() → `export default app` (Workers の fetch ハンドラ)
 *     - fs 保存 → @fesflow/storage (本番 R2 / ローカル MinIO)
 * - 2026-07-04 時点では db/auth/env を AsyncLocalStorage (ALS) に載せ、
 *   `import { db } from "@fesflow/db"` のようなモジュールシングルトン参照を
 *   ALS 経由の Proxy で解決する「魔法」で無改修動作させていた。
 * - Phase5 (2026-07-08) でこの ALS+Proxy を撤去し、Hono の Variables 経由の
 *   明示的 DI に変更する。ここで db/auth を生成し `c.set("db", db)` /
 *   `c.set("auth", auth)` するだけで、以降は各ルートが `c.get("db")` /
 *   `c.get("auth")` を使う (どこから db/auth が来るかコードで追える)。
 * - nodejs_compat (wrangler.jsonc の compatibility_flags) は ALS 撤去後も
 *   他の依存 (better-auth 等) が要る可能性があるため変更しない。
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { nanoid } from "nanoid";

import { createDb, membership, type WorkerEnv } from "@fesflow/db";
import { eq, and } from "drizzle-orm";
import { createAuth } from "@fesflow/auth";
import { createStorage } from "@fesflow/storage";
import { getSession } from "./utils/auth";
import {
  clientIp,
  isLocked,
  recordFailure,
  clearAttempts,
  lockoutMessage,
} from "./utils/rate-limit";
import { apiError, registerErrorHandlers } from "./http-error";
import type { AppEnv } from "./types";

// Hono REST ルート
import {
  eventRoutes,
  circleRoutes,
  menuRoutes,
  toppingRoutes,
  staffRoutes,
  orderRoutes,
  membershipRoutes,
  stampRoutes,
  wristbandRoutes,
  preOrderRoutes,
  accountRoutes,
  systemRoutes,
  adminRoutes,
} from "./routes";

const app = new Hono<AppEnv>();

// Phase4: 統一エラーエンベロープ ({ code, message, fields?, requestId }) を
// app.onError / app.notFound に一元的に仕込む。以降のルートは AppError/apiError を
// throw するだけでよく、エンベロープ整形やログ出力をここに集約する。
registerErrorHandlers(app);

// 2026-07-06: logger() は全リクエストの URL をそのまま出力する。URL に userId/wristbandId 等の
// 識別子が含まれ得る点に注意 (本番でのログ保持/マスキング方針を要検討)。
app.use(logger());
// 2026-07-05: 基本的なセキュリティレスポンスヘッダを付与 (クリックジャッキング/MIMEスニッフ/
// HSTS/リファラ抑止)。ただし画像・フォント(/uploads/*)はフロント (別サブドメイン) から
// <img>/CSS で読み込むため、CORP は cross-origin に緩める (既定の same-origin だと読込が壊れる)。
app.use(
  "/*",
  secureHeaders({
    crossOriginResourcePolicy: "cross-origin",
  }),
);

/**
 * 許可オリジンの判定 (2026-07-05 セキュリティ強化)
 *
 * 旧実装は `origin: (origin) => origin || "*"` で任意オリジンを credentials 付きで
 * 反射しており、任意サイトからログイン中ユーザーの Cookie を使った CSRF /
 * クレデンシャル窃取が可能だった。以下の許可リストに一致した場合のみ反射する。
 * - 本番: fesflow.shikosai.net (apex) と全サブドメイン (staff/admin 等)
 * - ローカル: localhost / 127.0.0.1 は全ポートを許可 (単一 SPA apps/app は :3000)
 * - env.CORS_ORIGIN があればカンマ区切りで追加許可 (別ドメイン検証用の逃げ道)
 */
function isAllowedOrigin(origin: string, env: WorkerEnv): boolean {
  if (!origin) return false;
  const extra = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (extra.includes(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === "localhost" || host === "127.0.0.1") return true;
  
  // 2026-07-06: 開発体験向上のため、ローカルネットワーク(プライベートIP)を自動許可
  if (
    /^192\.168\.\d+\.\d+$/.test(host) || 
    /^10\.\d+\.\d+\.\d+$/.test(host) || 
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)
  ) return true;

  if (host === "fesflow.shikosai.net") return true;
  if (host.endsWith(".fesflow.shikosai.net")) return true;
  return false;
}

app.use("/*", (c, next) =>
  cors({
    origin: (origin) =>
      isAllowedOrigin(origin, c.env as WorkerEnv) ? origin : null,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie", "Accept", "X-Active-Membership-Id"],
    credentials: true,
  })(c, next),
);

/**
 * リクエストごとに db/auth を生成し、Hono の Variables に載せる (Phase5: 明示的 DI)。
 * これ以降のハンドラは `c.get("db")` / `c.get("auth")` で実体を明示的に受け取る
 * (旧: ALS 経由の Proxy で `import { db }` / `import { auth }` を無改修に解決していた)。
 * env は c.env から直接読めるため store に保持する必要はない (getEnv() は廃止)。
 */
app.use("/*", async (c, next) => {
  const env = { ...c.env as WorkerEnv };
  const origin = c.req.header("origin");

  // better-auth の trustedOrigins を通過させるため、isAllowedOrigin で許可された
  // 動的オリジン（ローカルIP等）をこのリクエスト限定で CORS_ORIGIN に注入する
  if (origin && isAllowedOrigin(origin, env)) {
    env.CORS_ORIGIN = env.CORS_ORIGIN ? `${env.CORS_ORIGIN},${origin}` : origin;
  }

  const db = createDb(env.DB);
  const auth = createAuth(db, env);
  c.set("db", db);
  c.set("auth", auth);
  await next();
});

// Better Auth ハンドラ
// 2026-07-06: sign-in / sign-up への総当たり・スパム対策 (監査 H4)。
// better-auth 自体にはレート制限がないため、既存の auth_attempt ベースの
// ヘルパ (utils/rate-limit.ts) を IP バケットで流用する。対象は POST の
// sign-in / sign-up 系のみ (セッション取得等の GET は対象外)。
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const db = c.get("db");
  const path = c.req.path;
  const isAuthAttempt =
    c.req.method === "POST" &&
    (path.includes("sign-in") || path.includes("sign-up"));

  let ipKey = "";
  if (isAuthAttempt) {
    ipKey = `auth:ip:${clientIp(c)}`;
    const retryAfterSec = await isLocked(db, [ipKey]);
    if (retryAfterSec > 0) {
      // Phase4: RATE_LIMITED エンベロープに統一。Retry-After はエンベロープと併用して
      // AppError 側に持たせ、onError で一括してヘッダに反映させる。
      apiError("RATE_LIMITED", lockoutMessage(retryAfterSec), { status: 429, retryAfterSec });
    }
  }

  const auth = c.get("auth");
  const res = await auth.handler(c.req.raw);

  if (isAuthAttempt) {
    if (res.status >= 400) {
      await recordFailure(db, [{ key: ipKey, scope: "auth" }]);
    } else if (res.status >= 200 && res.status < 300) {
      await clearAttempts(db, [ipKey]);
    }
  }

  return res;
});

// 2026-07-05: 旧 tRPC エンドポイント (/trpc/*) を撤去。
// フロント (register/visitor) は REST (/api/*) のみを使用しており、tRPC 側は
// 全プロシージャが publicProcedure (認可なし) かつ circle/event を物理削除する
// 実装だったため、生きた無認可攻撃面になっていた。マウントごと削除する。

// REST ルート登録
// 2026-07-04: /api/events は広告ブロック機能(uBlock, Brave Shield等)に telemetry 送信と誤認され
// net::ERR_BLOCKED_BY_CLIENT で遮断されるため、恒久回避策として /api/festivals に改名。
app.route("/api/festivals", eventRoutes);
app.route("/api/circles", circleRoutes);
app.route("/api/menus", menuRoutes);
app.route("/api/toppings", toppingRoutes);
app.route("/api/staff", staffRoutes);
app.route("/api/orders", orderRoutes);
app.route("/api/memberships", membershipRoutes);
app.route("/api/stamps", stampRoutes);
app.route("/api/wristbands", wristbandRoutes);
app.route("/api/pre-orders", preOrderRoutes);
app.route("/api/account", accountRoutes);
app.route("/api/system", systemRoutes);
app.route("/api/admin", adminRoutes);

// 画像・フォントアップロード (fs → R2/MinIO)
// 2026-07-05: SVG は同一オリジン配信時にスクリプトを実行し得る (保存型XSS) ため
// 許可拡張子から除外した。加えてアップロードはログインセッション必須にする
// (アップロード導線はイベント/サークル/メニューの管理操作に限られ、来場者は使わない)。
const ALLOWED_EXTS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "ttf",
  "otf",
  "woff",
  "woff2",
];

// Phase4: 従来は try/catch で握りつぶして 500 に丸めていたが、AppError による
// 早期 return (401/403/400) を onError に委譲するため try/catch を廃止した。
// storage.put 等で予期しない例外が起きた場合も onError が 500 INTERNAL + requestId ログに
// 変換するので、ここで個別に catch する必要はない。
app.post("/api/upload", async (c) => {
  const db = c.get("db");
  const session = await getSession(c);
  if (!session || !session.user) {
    apiError("UNAUTHORIZED", "認証が必要です");
  }

  // 2026-07-06: アップロード濫用対策 (監査 M4)。単純ログインのみを要件にすると、
  // 自己登録した来場者を含む「誰でも」10MBファイルを無制限にアップロードできてしまう。
  // アップロード導線はイベント/サークル/メニュー管理者の操作に限られるため、
  // 何らかのアクティブなメンバーシップ (スタッフ以上の所属) を持つことを要件にする。
  const email = session.user.email.toLowerCase();
  const memberships = await db
    .select()
    .from(membership)
    .where(and(eq(membership.userEmail, email), eq(membership.isActive, true)));
  if (memberships.length === 0) {
    apiError("FORBIDDEN", "アップロード権限がありません");
  }

  const body = await c.req.parseBody();
  const file = body["file"];

  if (!file || !(file instanceof File)) {
    apiError("BAD_REQUEST", "ファイルがありません");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTS.includes(ext)) {
    apiError(
      "BAD_REQUEST",
      "許可されていないファイル形式です (画像: jpg, png, webp / フォント: ttf, otf, woff, woff2)",
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    apiError("BAD_REQUEST", "ファイルサイズは10MB以下にしてください");
  }

  const key = `uploads/${nanoid()}.${ext}`;
  const storage = createStorage(c.env as WorkerEnv);
  await storage.put(key, await file.arrayBuffer(), {
    contentType: file.type || undefined,
    cacheControl: "public, max-age=31536000, immutable",
  });

  // 2026-07-04: 本番ドメインに自動追従させるため、リクエストの Origin から動的に公開 URL を生成。
  // 2026-07-07 単一ドメイン化: 配信パスを /api/uploads/* に統一 (key は "uploads/xxx")。
  const url = new URL(c.req.url);
  const publicUrl = `${url.origin}/api/${key}`;

  return c.json({ path: publicUrl, key, ext });
});

// R2 / MinIO からアップロードファイルを配信するルート。
// 2026-07-07 単一ドメイン化: api Worker は /api/* のみを受けるため配信パスは /api/uploads/*。
// (旧 /uploads/* の後方互換ルートは 2026-07-07 リファクタリング Phase1 で撤去済み)
// Phase4: この配信ルートは画像/フォントの静的配信であり、<img src> や @font-face から
// 直接読み込まれる (JSON を期待するフロントの fetchApi 経由ではない) ため、
// 統一エラーエンベロープ (JSON) 化の対象外とする。404/500 とも従来通り text で返す。
const serveUpload = async (c: any) => {
  try {
    // 先頭の "/api/" または "/" を除去して R2 キー (uploads/xxx) を得る
    const key = c.req.path.replace(/^\/api\//, "").replace(/^\//, "");
    const storage = createStorage(c.env as WorkerEnv);
    const obj = await storage.get(key);
    if (!obj) {
      return c.text("Not Found", 404);
    }
    // 2026-07-05: 保存型XSS対策。MIMEスニッフ抑止 + sandbox CSP で、万一 SVG/HTML が
    // 保存されていてもスクリプト実行や能動コンテンツ読込を無効化する。
    return c.body(obj.body, 200, {
      "Content-Type": obj.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
  } catch (error) {
    console.error("Failed to serve upload:", error);
    return c.text("Internal Server Error", 500);
  }
};
app.get("/api/uploads/*", serveUpload);

app.get("/", (c) => c.text("OK"));

export default app;

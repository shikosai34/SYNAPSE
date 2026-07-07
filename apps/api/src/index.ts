/**
 * API Worker エントリ (2026-07-04 Cloudflare Workers 化にリライト)
 *
 * 変更意図:
 * - 旧 apps/server は @hono/node-server の serve() で Node ポートを開き、
 *   アップロードを fs.writeFileSync でローカル public/ に保存していた。
 *   どちらも Workers では動かないため次のように置き換えた:
 *     - serve() → `export default app` (Workers の fetch ハンドラ)
 *     - fs 保存 → @fesflow/storage (本番 R2 / ローカル MinIO)
 * - リクエスト境界で db/auth/env を AsyncLocalStorage に載せ、
 *   既存ルート (db/auth シングルトン参照) を無改修で動かす。
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { nanoid } from "nanoid";

import { createDb, runWithRequest, db, membership, type WorkerEnv } from "@fesflow/db";
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
} from "./routes";

type AppBindings = { Bindings: WorkerEnv };

const app = new Hono<AppBindings>();

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
 * - ローカル: localhost / 127.0.0.1 の 3000(register) / 3001(visitor)
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
 * リクエストごとに db/auth/env を生成し、AsyncLocalStorage に載せる。
 * これ以降のハンドラ内での `import { db }` / `import { auth }` は
 * このストアから実体を解決する。
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
  return runWithRequest({ db, auth, env }, () => next());
});

// Better Auth ハンドラ
// 2026-07-06: sign-in / sign-up への総当たり・スパム対策 (監査 H4)。
// better-auth 自体にはレート制限がないため、既存の auth_attempt ベースの
// ヘルパ (utils/rate-limit.ts) を IP バケットで流用する。対象は POST の
// sign-in / sign-up 系のみ (セッション取得等の GET は対象外)。
app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const path = c.req.path;
  const isAuthAttempt =
    c.req.method === "POST" &&
    (path.includes("sign-in") || path.includes("sign-up"));

  let ipKey = "";
  if (isAuthAttempt) {
    ipKey = `auth:ip:${clientIp(c)}`;
    const retryAfterSec = await isLocked([ipKey]);
    if (retryAfterSec > 0) {
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: lockoutMessage(retryAfterSec) }, 429);
    }
  }

  const auth = createAuth(createDb(c.env.DB), c.env as WorkerEnv);
  const res = await auth.handler(c.req.raw);

  if (isAuthAttempt) {
    if (res.status >= 400) {
      await recordFailure([{ key: ipKey, scope: "auth" }]);
    } else if (res.status >= 200 && res.status < 300) {
      await clearAttempts([ipKey]);
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

app.post("/api/upload", async (c) => {
  try {
    const session = await getSession(c);
    if (!session || !session.user) {
      return c.json({ error: "認証が必要です" }, 401);
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
      return c.json({ error: "アップロード権限がありません" }, 403);
    }

    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      return c.json({ error: "ファイルがありません" }, 400);
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXTS.includes(ext)) {
      return c.json(
        {
          error:
            "許可されていないファイル形式です (画像: jpg, png, webp / フォント: ttf, otf, woff, woff2)",
        },
        400,
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: "ファイルサイズは10MB以下にしてください" }, 400);
    }

    const key = `uploads/${nanoid()}.${ext}`;
    const storage = createStorage(c.env as WorkerEnv);
    await storage.put(key, await file.arrayBuffer(), {
      contentType: file.type || undefined,
      cacheControl: "public, max-age=31536000, immutable",
    });

    // 2026-07-04: 本番ドメインに自動追従させるため、リクエストの Origin から動的に公開 URL を生成
    const url = new URL(c.req.url);
    const publicUrl = `${url.origin}/${key}`;

    return c.json({ path: publicUrl, key, ext });
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "アップロードに失敗しました" }, 500);
  }
});

// 2026-07-04: R2 / MinIO からアップロードファイルを配信するルートを追加 (カスタムドメイン・公開設定不要化)
app.get("/uploads/*", async (c) => {
  try {
    const key = c.req.path.replace(/^\//, "");
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
});

app.get("/", (c) => c.text("OK"));

export default app;

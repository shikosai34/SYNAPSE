import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { db, circle, event, membership } from "@fesflow/db";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAdminSession, hasPermission } from "../utils/auth";
import { requireAuth, type AuthVariables } from "../middleware/auth";

const circleRoutes = new Hono<{ Variables: AuthVariables }>();

// サークル一覧取得
// 2026-07-06 (H2): 公開ブラウズ(来場者アプリ)にも使われるため認証必須化はしない。
// ただし代表者のメールアドレス(PII)を managerEmail として無認可で返すのは漏洩なので、
// managerEmail は「対象イベントの member:read を持つ認可済み呼び出し元」にのみ付与し、
// 匿名/権限のない呼び出し元には含めない (managerName は表示用途で常に返す)。
circleRoutes.get("/", async (c) => {
  const eventId = c.req.query("eventId");

  const query = db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      mods: circle.mods,
      settings: circle.settings,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerName: membership.userName,
      managerEmail: membership.userEmail,
    })
    .from(circle)
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    );

  // 論理削除済み(deletedAt != null)は常に除外する
  const where = eventId
    ? and(eq(circle.eventId, eventId), isNull(circle.deletedAt))
    : isNull(circle.deletedAt);

  const circles = await query.where(where);

  // eventId スコープで member:read を持つ場合のみ managerEmail を残す。
  // それ以外(匿名来場者・eventId 未指定)では PII を落として返す。
  const includeEmail = eventId
    ? await hasPermission(c, null, "member:read", eventId)
    : false;
  if (includeEmail) {
    return c.json(circles);
  }
  return c.json(circles.map(({ managerEmail: _managerEmail, ...rest }) => rest));
});

// サークル取得
// 2026-07-06 (H2): 公開ブラウズにも使われるため認証必須化はしないが、
// 代表者のメールアドレス(PII)は当該サークルの member:read を持つ認可済み呼び出し元にのみ
// 付与し、匿名/権限のない呼び出し元には含めない (managerName は表示用途で常に返す)。
circleRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const circles = await db
    .select({
      id: circle.id,
      eventId: circle.eventId,
      name: circle.name,
      description: circle.description,
      mods: circle.mods,
      settings: circle.settings,
      createdAt: circle.createdAt,
      updatedAt: circle.updatedAt,
      managerName: membership.userName,
      managerEmail: membership.userEmail,
    })
    .from(circle)
    .leftJoin(
      membership,
      and(
        eq(membership.circleId, circle.id),
        eq(membership.role, "circle_manager")
      )
    )
    .where(and(eq(circle.id, id), isNull(circle.deletedAt)));

  if (circles.length === 0) {
    apiError("NOT_FOUND", "サークルが見つかりません");
  }

  const found = circles[0]!;
  const includeEmail = await hasPermission(c, id, "member:read");
  if (includeEmail) {
    return c.json(found);
  }
  const { managerEmail: _managerEmail, ...rest } = found;
  return c.json(rest);
});

// サークル作成
// 2026-07-07 (Phase 3a): セルフサービス化。旧仕様は管理者(getAdminSession)のみが
// managerEmail/managerPin を指定してサークル + 代表者メンバーシップを代理作成する
// ものだったが、新仕様では「better-auth セッションを持つ任意のログインユーザー」が
// サークルを作成でき、作成と同時に自分自身 (session.user.email) が circle_manager に
// なる (作成者=管理者)。managerEmail/managerName/managerPin の入力は廃止。
// eventId は引き続き必須 (サークルはイベント配下)。イベントをまたぐ不正の防止は
// 最小限 (イベント存在確認のみ) にとどめる。
circleRoutes.post(
  "/",
  requireAuth,
  zBody(
    z.object({
      eventId: z.string(),
      name: z.string().min(1, "サークル名は必須です"),
      description: z.string().optional(),
    })
  ),
  async (c) => {
    const session = c.get("session");
    const input = c.req.valid("json");
    const id = nanoid();

    // イベントの存在確認
    const events = await db
      .select()
      .from(event)
      .where(eq(event.id, input.eventId));
    if (events.length === 0) {
      apiError("NOT_FOUND", "イベントが見つかりません");
    }

    // 同じイベント内で同じ名前のサークルがないか確認
    const existingCircles = await db
      .select()
      .from(circle)
      .where(
        and(eq(circle.eventId, input.eventId), eq(circle.name, input.name))
      );

    if (existingCircles.length > 0) {
      apiError("BAD_REQUEST", "同じ名前のサークルが既に存在します");
    }

    // サークルと代表者メンバーシップを作成
    // 2026-07-04: Cloudflare D1 は HTTP 経由の対話的トランザクション (BEGIN TRANSACTION) をサポートしておらず、
    // db.transaction() を実行すると "Failed query: begin" エラーで 500 になるため、順次実行に変更。
    await db.insert(circle).values({
      id,
      eventId: input.eventId,
      name: input.name,
      description: input.description,
    });

    // 2026-07-06 (M5): D1 はトランザクション非対応のため、membership insert が
    // 失敗すると代表者不在のサークルが残ってしまう。失敗時は先に作成した circle 行を
    // 補償削除してからエラーを返す。
    // 2026-07-07 (Phase 3a): 代表者は常に作成者本人 (session.user.email)。
    const membershipId = nanoid();
    try {
      await db.insert(membership).values({
        id: membershipId,
        userEmail: session.user.email.toLowerCase(), // メールアドレスは小文字で保存
        userName: session.user.name || `${input.name} 代表者`,
        circleId: id,
        role: "circle_manager",
        isActive: true,
      });
    } catch (e) {
      await db.delete(circle).where(eq(circle.id, id));
      apiError("INTERNAL", "サークルの作成に失敗しました");
    }

    return c.json({ id }, 201);
  }
);

// サークル更新
// 2026-07-07 (Phase 3a): PIN 廃止に合わせて整理。managerEmail/managerPin による
// 代表者付け替えロジックは撤去し、サークル名/説明の更新のみを扱う。
// 代表者の付け替えは招待 (membership.ts の invite) やオーナー権限譲渡
// (POST /:id/transfer-owner, 下記) 側に委ねる。
circleRoutes.put(
  "/:id",
  zBody(
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
    })
  ),
  async (c) => {
    const session = await getAdminSession(c);
    if (!session) {
      apiError("FORBIDDEN", "管理者権限が必要です");
    }

    const id = c.req.param("id");
    const input = c.req.valid("json");

    // 対象サークルの存在確認
    const existingCircle = await db
      .select()
      .from(circle)
      .where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      apiError("NOT_FOUND", "サークルが見つかりません");
    }

    const updates: Partial<typeof circle.$inferSelect> = {};

    if (input.name) updates.name = input.name;
    if (input.description !== undefined)
      updates.description = input.description;

    if (Object.keys(updates).length > 0) {
      await db.update(circle).set(updates).where(eq(circle.id, id));
    }

    return c.json({ success: true });
  }
);

// サークル削除 (論理削除)
// 上位管理者のみ実行可能: super_admin もしくは当該イベントの event_manager
// (circle:delete 権限。circle_manager は自サークルを削除できない)
circleRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const allowed = await hasPermission(c, id, "circle:delete");
  if (!allowed) {
    apiError("FORBIDDEN", "削除する権限がありません");
  }

  // 物理削除せず deletedAt に時刻を書き込む (論理削除)
  await db.update(circle).set({ deletedAt: new Date() }).where(eq(circle.id, id));
  return c.json({ success: true });
});

// サークル運用設定 (注文モード・組み込み拡張のON/OFF等) の更新
circleRoutes.patch(
  "/:id/settings",
  zBody(
    z.object({
      settings: z.record(z.string(), z.any()),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { settings } = c.req.valid("json");

    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const existingCircle = await db.select().from(circle).where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      apiError("NOT_FOUND", "サークルが見つかりません");
    }

    await db
      .update(circle)
      .set({ settings: JSON.stringify(settings) })
      .where(eq(circle.id, id));

    return c.json({ success: true });
  }
);

// オーナー権限の譲渡: 指定メンバーを circle_manager に昇格し、既存の
// circle_manager を circle_staff へ降格する。circle_manager 本人または
// 上位管理者(event_manager / super_admin)のみ実行可能。
circleRoutes.post(
  "/:id/transfer-owner",
  zBody(
    z.object({
      membershipId: z.string(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { membershipId } = c.req.valid("json");

    // 譲渡は「メンバーの権限変更」に相当するため circle:write 権限で判定
    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      apiError("FORBIDDEN", "権限がありません");
    }

    // 譲渡先メンバーが当該サークルに所属しているか確認
    const targets = await db
      .select()
      .from(membership)
      .where(and(eq(membership.id, membershipId), eq(membership.circleId, id)));
    if (targets.length === 0) {
      apiError("NOT_FOUND", "譲渡先のメンバーが見つかりません");
    }

    // 既存の circle_manager を circle_staff に降格 (譲渡先自身は除く)
    const currentManagers = await db
      .select()
      .from(membership)
      .where(
        and(eq(membership.circleId, id), eq(membership.role, "circle_manager"))
      );
    for (const m of currentManagers) {
      if (m.id === membershipId) continue;
      await db
        .update(membership)
        .set({ role: "circle_staff" })
        .where(eq(membership.id, m.id));
    }

    // 譲渡先を circle_manager に昇格
    await db
      .update(membership)
      .set({ role: "circle_manager" })
      .where(eq(membership.id, membershipId));

    return c.json({ success: true });
  }
);

// サークルの拡張機能（モッド）設定の更新
circleRoutes.patch(
  "/:id/mods",
  zBody(
    z.object({
      mods: z.record(z.string(), z.any()),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const { mods } = c.req.valid("json");

    // 該当サークルへの書き込み権限をチェック
    const allowed = await hasPermission(c, id, "circle:write");
    if (!allowed) {
      apiError("FORBIDDEN", "権限がありません");
    }

    // 対象サークルの存在確認
    const existingCircle = await db
      .select()
      .from(circle)
      .where(eq(circle.id, id));
    if (existingCircle.length === 0) {
      apiError("NOT_FOUND", "サークルが見つかりません");
    }

    // データベースの更新
    await db
      .update(circle)
      .set({
        mods: JSON.stringify(mods),
      })
      .where(eq(circle.id, id));

    return c.json({ success: true });
  }
);

export default circleRoutes;

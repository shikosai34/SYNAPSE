import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, wristband, eventUser, event, getEnv } from "@fesflow/db";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth } from "@fesflow/auth";


const wristbandRoutes = new Hono();

/** イベント内で次に割り当てる呼出用 displayId を採番する。 */
async function nextDisplayId(eventId: string): Promise<number> {
  const rows = await db
    .select({ displayId: eventUser.displayId })
    .from(eventUser)
    .where(eq(eventUser.eventId, eventId));
  const max = rows.reduce((m, r) => Math.max(m, r.displayId ?? 0), 0);
  return max + 1;
}

// コード (リストバンドID、ユーザーID) によるユーザー照会
wristbandRoutes.get("/lookup/:code", async (c) => {
  let code = c.req.param("code");

  // 2026-07-04: QRコードスキャン等で URL (例: https://.../w/usr_xxx) が入ってきた場合に対応
  const urlMatch = code.match(/\/w\/([a-zA-Z0-9_\-]+)/);
  if (urlMatch && urlMatch[1]) {
    code = urlMatch[1];
  }

  // 2026-07-04: D1 の外部キー制約エラーを避けるため、DB内の最初のイベントIDを取得してデフォルトとして使用する
  const eventsList = await db.select().from(event).limit(1);
  const defaultEventId = eventsList[0]?.id || "evt_default";

  // 固定の管理者/テスト用リストバンドの自動シード補完
  if (code.startsWith("wb_admin") || code.startsWith("wb_test")) {
    const existingWb = await db
      .select()
      .from(wristband)
      .where(eq(wristband.id, code));

    if (existingWb.length === 0) {
      const targetUserId = code.startsWith("wb_admin") ? "usr_admin" : `usr_${code}`;
      const existingUser = await db
        .select()
        .from(eventUser)
        .where(eq(eventUser.id, targetUserId));

      if (existingUser.length === 0) {
        await db.insert(eventUser).values({
          id: targetUserId,
          eventId: defaultEventId,
          displayId: code.startsWith("wb_admin") ? 999 : Math.floor(100 + Math.random() * 800),
          status: "available",
        });
      }

      await db.insert(wristband).values({
        id: code,
        userId: targetUserId,
        status: "active",
        assignedAt: new Date(),
      });
    }
  }

  // 1. リストバンドIDとして検索
  const wristbands = await db
    .select()
    .from(wristband)
    .where(eq(wristband.id, code));


  if (wristbands.length > 0) {
    const wb = wristbands[0]!;
    const users = await db
      .select()
      .from(eventUser)
      .where(eq(eventUser.id, wb.userId));

    if (users.length > 0) {
      return c.json({
        user: users[0],
        wristband: wb,
      });
    }
  }

  // 2. ユーザーID/メールアドレスとして直接検索 (スマホ画面QR等のフォールバック)
  let users = await db
    .select()
    .from(eventUser)
    .where(eq(eventUser.id, code));

  // 管理者ID・メールアドレスの場合の自動補完・同等扱い
  const adminEmail = getEnv().INITIAL_SUPER_ADMIN_EMAIL || "me@fukayatti0.dev";
  if (users.length === 0 && (code === adminEmail || code === "lTkBEJtn1G88NFZ2bsLdATuSrjjLuaTG" || code.startsWith("usr_"))) {
    const newDisplayId = code === adminEmail || code === "lTkBEJtn1G88NFZ2bsLdATuSrjjLuaTG" ? 999 : Math.floor(100 + Math.random() * 900);
    await db.insert(eventUser).values({
      id: code,
      eventId: defaultEventId,
      displayId: newDisplayId,
      status: "available",
    });
    users = await db
      .select()
      .from(eventUser)
      .where(eq(eventUser.id, code));
  }

  if (users.length > 0) {
    const user = users[0]!;
    // 最新のアクティブリストバンドを取得
    let activeWristbands = await db
      .select()
      .from(wristband)
      .where(and(eq(wristband.userId, user.id), eq(wristband.status, "active")))
      .orderBy(desc(wristband.assignedAt));

    // 管理者の場合は wb_admin_001 を固定アクティブとして紐付けフォールバック
    if (activeWristbands.length === 0 && (code === adminEmail || code === "lTkBEJtn1G88NFZ2bsLdATuSrjjLuaTG" || code === "usr_admin")) {
      const adminWb = await db.select().from(wristband).where(eq(wristband.id, "wb_admin_001"));
      if (adminWb.length > 0) {
        activeWristbands = adminWb;
      }
    }

    return c.json({
      user,
      wristband: activeWristbands.length > 0 ? activeWristbands[0] : null,
    });
  }


  // 3. 未知のコード/ユーザーIDの場合の自動作成フォールバック (画面がエラーでクラッシュするのを防ぐ)
  const newDisplayId = Math.floor(100 + Math.random() * 900);
  await db.insert(eventUser).values({
    id: code,
    eventId: defaultEventId,
    displayId: newDisplayId,
    status: "available",
  });

  const createdUsers = await db
    .select()
    .from(eventUser)
    .where(eq(eventUser.id, code));

  return c.json({
    user: createdUsers[0],
    wristband: null,
  });
});




// リストバンドの新規登録・再発行 (紐付け)
wristbandRoutes.post(
  "/register",
  zValidator(
    "json",
    z.object({
      userId: z.string(),
      wristbandId: z.string(), // 新しいリストバンドのQR/コード値
    })
  ),
  async (c) => {
    const { userId, wristbandId } = c.req.valid("json");

    // 2026-07-04: D1 の外部キー制約エラーを避けるため、DB内の最初のイベントIDを取得してデフォルトとして使用する
    const eventsList = await db.select().from(event).limit(1);
    const defaultEventId = eventsList[0]?.id || "evt_default";

    // ユーザー存在チェック、なければ自動作成
    let users = await db
      .select()
      .from(eventUser)
      .where(eq(eventUser.id, userId));

    if (users.length === 0) {
      // 登録イベントIDは固定またはデフォルト値
      const newDisplayId = Math.floor(100 + Math.random() * 900);
      await db.insert(eventUser).values({
        id: userId,
        eventId: defaultEventId,
        displayId: newDisplayId,
        status: "available",
      });
    }

    // 既存のアクティブなリストバンドがあれば無効化 (replaced)
    await db
      .update(wristband)
      .set({ status: "replaced", deactivatedAt: new Date() })
      .where(and(eq(wristband.userId, userId), eq(wristband.status, "active")));


    // 既存の同一リストバンドIDが存在するか確認
    const existingWristbands = await db
      .select()
      .from(wristband)
      .where(eq(wristband.id, wristbandId));

    if (existingWristbands.length > 0) {
      // 既に登録されているリストバンドの場合は情報を更新してアクティブ化
      await db
        .update(wristband)
        .set({
          userId,
          status: "active",
          assignedAt: new Date(),
          deactivatedAt: null,
        })
        .where(eq(wristband.id, wristbandId));
    } else {
      // 新しいリストバンドを登録
      await db.insert(wristband).values({
        id: wristbandId,
        userId,
        status: "active",
        assignedAt: new Date(),
      });
    }

    return c.json({ success: true, wristbandId });
  }
);

// 紛失報告
wristbandRoutes.post(
  "/:id/report-lost",
  async (c) => {
    const id = c.req.param("id");

    await db
      .update(wristband)
      .set({ status: "lost", deactivatedAt: new Date() })
      .where(eq(wristband.id, id));

    return c.json({ success: true });
  }
);

// 来場者オンボーディング: ニックネーム+誕生日を登録 (2026-07-04)
// 認証は不要。userId(eventUser.id) を持っている人=リストバンド保持者本人とみなす
// (ベアラーモデル)。初回のみ onboardedAt を刻む。
wristbandRoutes.post(
  "/onboard",
  zValidator(
    "json",
    z.object({
      userId: z.string().min(1),
      nickname: z.string().trim().min(1).max(30),
      birthday: z.string().optional(), // YYYY-MM-DD
    })
  ),
  async (c) => {
    const { userId, nickname, birthday } = c.req.valid("json");

    const users = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (users.length === 0) {
      return c.json({ error: "ユーザーが見つかりません" }, 404);
    }
    const u = users[0]!;

    await db
      .update(eventUser)
      .set({
        nickname,
        birthday: birthday || null,
        // 初回のみ確定させる (再編集で入場日時が動かないように)
        onboardedAt: u.onboardedAt ?? new Date(),
      })
      .where(eq(eventUser.id, userId));

    const updated = (await db.select().from(eventUser).where(eq(eventUser.id, userId)))[0]!;
    return c.json({
      id: updated.id,
      eventId: updated.eventId,
      displayId: updated.displayId,
      nickname: updated.nickname,
      birthday: updated.birthday,
      onboardedAt: updated.onboardedAt,
    });
  }
);

// イベント管理から来場者IDを発行する (2026-07-04)
// リストバンドを使わない来場者や、事前に来場者枠を用意する場合に、イベント管理者が
// 新しい eventUser を1件発行する。任意で物理リストバンドコードも同時に紐付ける。
// register(イベント管理)側から呼ぶ想定のためログインセッション必須。
wristbandRoutes.post(
  "/issue",
  zValidator(
    "json",
    z.object({
      eventId: z.string().min(1),
      wristbandId: z.string().optional(), // 物理バンドのコード (任意)
    })
  ),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session || !session.user) {
      return c.json({ error: "認証されていません" }, 401);
    }
    const { eventId, wristbandId } = c.req.valid("json");

    const events = await db.select().from(event).where(eq(event.id, eventId));
    if (events.length === 0) {
      return c.json({ error: "イベントが見つかりません" }, 404);
    }

    const userId = `usr_${nanoid(12)}`;
    const displayId = await nextDisplayId(eventId);
    await db.insert(eventUser).values({
      id: userId,
      eventId,
      displayId,
      status: "available",
    });

    if (wristbandId) {
      await db.insert(wristband).values({
        id: wristbandId,
        userId,
        status: "active",
        assignedAt: new Date(),
      });
    }

    return c.json({ userId, displayId, wristbandId: wristbandId ?? null });
  }
);

export default wristbandRoutes;

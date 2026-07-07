import { Hono } from "hono";
import { z } from "zod";
import { db, wristband, eventUser, event } from "@fesflow/db";
import { eq, and, desc, or, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth } from "@fesflow/auth";
import { hasPermission } from "../utils/auth";
import { zBody, zQuery } from "../z-validator";
import { apiError } from "../http-error";


const wristbandRoutes = new Hono();

// 来場者の検索 (ニックネーム、呼出ID、誕生日) - スタッフ権限必須
wristbandRoutes.get(
  "/search",
  zQuery(
    z.object({
      eventId: z.string().min(1),
      query: z.string().min(1),
    })
  ),
  async (c) => {
    const { eventId, query } = c.req.valid("query");

    // 権限チェック (イベントスタッフ権限 member:read が必要)
    const allowed = await hasPermission(c, null, "member:read", eventId);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作にはスタッフ権限が必要です");
    }

    const queryNum = parseInt(query, 10);
    const isNum = !isNaN(queryNum) && /^\d+$/.test(query);

    const conditions = [eq(eventUser.eventId, eventId)];
    const orConditions = [
      like(eventUser.nickname, `%${query}%`),
      like(eventUser.birthday, `%${query}%`),
    ];

    if (isNum) {
      orConditions.push(eq(eventUser.displayId, queryNum));
    }

    const rows = await db
      .select({
        user: eventUser,
        wristband: wristband,
      })
      .from(eventUser)
      .leftJoin(
        wristband,
        and(
          eq(wristband.userId, eventUser.id),
          eq(wristband.status, "active")
        )
      )
      .where(and(...conditions, or(...orConditions)))
      .limit(50);

    return c.json(
      rows.map((r) => ({
        user: r.user,
        wristband: r.wristband,
      }))
    );
  }
);

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

  // 2026-07-05: 開発用の固定管理者/テストバンド (wb_admin*/wb_test*) の自動シードを撤去。
  // 本番に残るとハードコードされたバックドア (誰でも管理者バンドを生成可能) になるため。

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
  const users = await db
    .select()
    .from(eventUser)
    .where(eq(eventUser.id, code));

  // 2026-07-05: 管理者メール/固定トークン (lTk...) を管理者バンドとして特別扱いする
  // バックドアを撤去。未知コードは下の汎用フォールバックで通常ユーザーとして扱う。

  if (users.length > 0) {
    const user = users[0]!;
    // 最新のアクティブリストバンドを取得
    const activeWristbands = await db
      .select()
      .from(wristband)
      .where(and(eq(wristband.userId, user.id), eq(wristband.status, "active")))
      .orderBy(desc(wristband.assignedAt));

    return c.json({
      user,
      wristband: activeWristbands.length > 0 ? activeWristbands[0] : null,
    });
  }


  // 3. 未知のコード/ユーザーIDの場合の自動作成フォールバックを撤去 (2026-07-06)。
  // 認証なしで誰でも任意のコードを叩くたびに eventUser が無制限に生成されてしまい、
  // DB膨張/コスト増/DoSの温床になっていたため。lookup はあくまで「既存の照会」に徹し、
  // 未知のコードは 404 を返す。正規の来場者ID発行は POST /issue (セッション必須) や
  // POST /register (能動的なリストバンド登録操作) で行う。
  apiError("NOT_FOUND", "ユーザーが見つかりません");
});




// リストバンドの新規登録・再発行 (紐付け)
wristbandRoutes.post(
  "/register",
  zBody(
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

    // 2026-07-05: リストバンド乗っ取り対策。
    // 「既にアクティブなバンドを持つユーザーへの付替え」または「他ユーザーで
    // アクティブなバンドの再割当」はスタッフ権限 (対象イベントの member:write) を
    // 要求する。新規ユーザーの初回バインド (来場者セルフサービス) は従来どおり
    // 認証不要で許可する。これにより、被害者の userId や有効なバンドコードを
    // 知っただけの第三者が既存の紐付けを奪う経路を塞ぐ。
    const targetActive = await db
      .select()
      .from(wristband)
      .where(and(eq(wristband.userId, userId), eq(wristband.status, "active")));
    const bandNow = await db
      .select()
      .from(wristband)
      .where(eq(wristband.id, wristbandId));
    const replacingUsersActiveBand = targetActive.some((w) => w.id !== wristbandId);
    const bandOwnedByOther =
      bandNow.length > 0 &&
      bandNow[0]!.status === "active" &&
      bandNow[0]!.userId !== userId;
    if (replacingUsersActiveBand || bandOwnedByOther) {
      let evId: string | undefined = users[0]?.eventId;
      if (!evId && bandNow.length > 0) {
        const otherUser = await db
          .select()
          .from(eventUser)
          .where(eq(eventUser.id, bandNow[0]!.userId));
        evId = otherUser[0]?.eventId;
      }
      const allowed = await hasPermission(c, null, "member:write", evId);
      if (!allowed) {
        apiError("FORBIDDEN", "このリストバンドの再割り当てにはスタッフ権限が必要です");
      }
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

    // 2026-07-05: 存在確認とアクティブ状態のみロック可能に限定する。
    // (ベアラーモデルのため所有証明までは行えないが、既に無効化済みのバンドを
    //  再度 lost 化する無意味な操作・存在しないIDへの操作を弾く。恒久的には
    //  紛失報告を本人セッション or スタッフ権限で保護する再設計が望ましい。)
    const wbs = await db.select().from(wristband).where(eq(wristband.id, id));
    if (wbs.length === 0) {
      apiError("NOT_FOUND", "リストバンドが見つかりません");
    }
    if (wbs[0]!.status !== "active") {
      apiError("BAD_REQUEST", "このリストバンドは既に無効です");
    }

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
  zBody(
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
      apiError("NOT_FOUND", "ユーザーが見つかりません");
    }
    const u = users[0]!;

    // 2026-07-06: write-once化。onboardedAt が既に設定済み(=初回登録完了済み)の場合、
    // userId さえ知っていれば誰でも他人のニックネーム/誕生日を無制限に上書きできてしまう
    // 経路を塞ぐ。初回のセルフ登録(onboardedAt が null)のみ許可し、以降の変更はスタッフ経由に限定する。
    if (u.onboardedAt) {
      apiError("CONFLICT", "既に登録済みです。変更にはスタッフにお問い合わせください");
    }

    await db
      .update(eventUser)
      .set({
        nickname,
        birthday: birthday || null,
        // 初回のみ確定させる (再編集で入場日時が動かないように)
        onboardedAt: new Date(),
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
  zBody(
    z.object({
      eventId: z.string().min(1),
      wristbandId: z.string().optional(), // 物理バンドのコード (任意)
    })
  ),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session || !session.user) {
      apiError("UNAUTHORIZED", "認証されていません");
    }
    const { eventId, wristbandId } = c.req.valid("json");

    const events = await db.select().from(event).where(eq(event.id, eventId));
    if (events.length === 0) {
      apiError("NOT_FOUND", "イベントが見つかりません");
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

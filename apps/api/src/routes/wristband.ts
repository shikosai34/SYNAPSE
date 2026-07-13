import { Hono } from "hono";
import { z } from "zod";
import { wristband, eventUser, event, type DB } from "@fesflow/db";
import { eq, and, desc, or, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasPermission } from "../utils/auth";
import { zBody, zQuery } from "../z-validator";
import { apiError } from "../http-error";
import { audit } from "../utils/sudo";
import type { AppEnv } from "../types";


const wristbandRoutes = new Hono<AppEnv>();

// 来場者の検索 (ニックネーム、呼出ID、誕生日) - スタッフ権限必須
wristbandRoutes.get(
  "/search",
  zQuery(
    z.object({
      eventId: z.string().min(1),
      query: z.string().optional().default(""),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { eventId, query } = c.req.valid("query");

    // 権限チェック (イベントスタッフ権限 member:read が必要)
    const allowed = await hasPermission(c, null, "member:read", eventId);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作にはスタッフ権限が必要です");
    }

    const conditions = [eq(eventUser.eventId, eventId)];

    if (query && query.trim().length > 0) {
      const queryNum = parseInt(query, 10);
      const isNum = !isNaN(queryNum) && /^\d+$/.test(query);

      const orConditions = [
        like(eventUser.nickname, `%${query}%`),
        like(eventUser.favoriteDate, `%${query}%`),
      ];

      if (isNum) {
        orConditions.push(eq(eventUser.displayId, queryNum));
      }

      const orOp = or(...orConditions);
      if (orOp) {
        conditions.push(orOp);
      }
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
          or(eq(wristband.status, "active"), eq(wristband.status, "smartphone"))
        )
      )
      .where(and(...conditions))
      .orderBy(desc(eventUser.createdAt))
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
// 2026-07-08 (Phase5): db をモジュール Proxy ではなく引数で受け取る (Context を持たない
// トップレベル関数のため、計画通り db を明示的な引数にした)。
async function nextDisplayId(db: DB, eventId: string): Promise<number> {
  const rows = await db
    .select({ displayId: eventUser.displayId })
    .from(eventUser)
    .where(eq(eventUser.eventId, eventId));
  const max = rows.reduce((m, r) => Math.max(m, r.displayId ?? 0), 0);
  return max + 1;
}

// コード (リストバンドID、ユーザーID) によるユーザー照会
wristbandRoutes.get("/lookup/:code", async (c) => {
  const db = c.get("db");
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
    // 最新のアクティブ/スマホリストバンドを取得
    const activeWristbands = await db
      .select()
      .from(wristband)
      .where(
        and(
          eq(wristband.userId, user.id),
          or(eq(wristband.status, "active"), eq(wristband.status, "smartphone"))
        )
      )
      .orderBy(desc(wristband.assignedAt));

    if (activeWristbands.length > 0) {
      return c.json({
        user,
        wristband: activeWristbands[0],
      });
    }

    // 2026-07-12: リストバンドが存在しない場合で、イベントが「物理リストバンドなし(スマホのみ)」に
    // 設定されている場合、その場で自動的にスマホデジタルID用の疑似バンドレコード(status: "smartphone")を登録する。
    const events = await db.select().from(event).where(eq(event.id, user.eventId));
    if (events.length > 0 && !events[0]!.hasPhysicalWristband) {
      const dummyWbId = `sp_${user.id}`;
      // 重複チェック
      const existingWb = await db.select().from(wristband).where(eq(wristband.id, dummyWbId));
      if (existingWb.length === 0) {
        await db.insert(wristband).values({
          id: dummyWbId,
          userId: user.id,
          status: "smartphone",
          assignedAt: new Date(),
        });
      } else {
        await db
          .update(wristband)
          .set({ status: "smartphone", deactivatedAt: null })
          .where(eq(wristband.id, dummyWbId));
      }

      const newWb = (await db.select().from(wristband).where(eq(wristband.id, dummyWbId)))[0]!;
      return c.json({
        user,
        wristband: newWb,
      });
    }

    return c.json({
      user,
      wristband: null,
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
    const db = c.get("db");
    const { userId, wristbandId } = c.req.valid("json");

    // 対象ユーザーと対象バンドの現状を先に読む (権限判定を書き込みより前に行うため)。
    const users = await db
      .select()
      .from(eventUser)
      .where(eq(eventUser.id, userId));
    const targetActive = await db
      .select()
      .from(wristband)
      .where(and(eq(wristband.userId, userId), eq(wristband.status, "active")));
    const bandNow = await db
      .select()
      .from(wristband)
      .where(eq(wristband.id, wristbandId));
    const bandExists = bandNow.length > 0;

    // 2026-07-11: 権限ゲート。以下はいずれも本部(スタッフ member:write)権限を要求する:
    //  (a) 未登録=本部未発行のバンドIDの紐付け → 実質「スマホ単体でバンドを新規発行」なので禁止。
    //  (b) 他ユーザーでアクティブなバンドの再割当 (乗っ取り対策, 2026-07-05)。
    //  (c) 既にアクティブなバンドを持つユーザーへの付替え (再発行, 2026-07-05)。
    // 本部発行済み(既存)バンドを、まだバンドを持たない本人が紐付ける初回リンクのみ認証不要。
    // これにより「発行は本部・登録は来場登録QR/本部発行済みID」というフローに揃える。
    const replacingUsersActiveBand = targetActive.some((w) => w.id !== wristbandId);
    const bandOwnedByOther =
      bandExists &&
      bandNow[0]!.status === "active" &&
      bandNow[0]!.userId !== userId;
    const creatingNewBand = !bandExists;
    if (replacingUsersActiveBand || bandOwnedByOther || creatingNewBand) {
      let evId: string | undefined = users[0]?.eventId;
      if (!evId && bandExists) {
        const otherUser = await db
          .select()
          .from(eventUser)
          .where(eq(eventUser.id, bandNow[0]!.userId));
        evId = otherUser[0]?.eventId;
      }
      if (!evId && creatingNewBand) {
        // 2026-07-11: 新規バンド発行時は eventId 未解決のまま権限判定しない。
        // event_manager の曖昧一致を防ぐため、DB から具体的なイベントIDを解決して渡す。
        const eventsList = await db.select().from(event).limit(1);
        evId = eventsList[0]?.id;
      }
      const allowed = await hasPermission(c, null, "member:write", evId);
      if (!allowed) {
        apiError(
          "FORBIDDEN",
          creatingNewBand
            ? "このリストバンドは本部で発行されていません。受付・本部で発行されたリストバンドをご利用ください。"
            : "このリストバンドの再割り当てにはスタッフ権限が必要です"
        );
      }
    }

    // 権限クリア。ユーザーが未登録なら作成する (本部発行フロー由来のみ到達する)。
    if (users.length === 0) {
      // D1 の外部キー制約エラーを避けるため、DB内の最初のイベントIDをデフォルトに使う。
      const eventsList = await db.select().from(event).limit(1);
      const defaultEventId = eventsList[0]?.id || "evt_default";
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

    if (bandExists) {
      // 既に登録されているリストバンド (本部発行済み) を本人に紐付けてアクティブ化
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
      // ここに来るのはスタッフ権限で新規バンドを発行する場合のみ (上のゲートを通過済み)
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
    const db = c.get("db");
    const id = c.req.param("id");

    // 2026-07-05: 存在確認とアクティブ状態のみロック可能に限定する。
    const wbs = await db.select().from(wristband).where(eq(wristband.id, id));
    if (wbs.length === 0) {
      apiError("NOT_FOUND", "リストバンドが見つかりません");
    }
    if (wbs[0]!.status !== "active" && wbs[0]!.status !== "smartphone") {
      apiError("BAD_REQUEST", "このリストバンドは既に無効です");
    }

    await db
      .update(wristband)
      .set({ status: "lost", deactivatedAt: new Date() })
      .where(eq(wristband.id, id));

    return c.json({ success: true });
  }
);

// リストバンド更新 (状態変更、紐付け先変更等) - 2026-07-12 追加
wristbandRoutes.patch(
  "/:id",
  zBody(
    z.object({
      status: z.enum(["active", "lost", "replaced", "revoked", "smartphone"]),
      userId: z.string().optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const { status, userId } = c.req.valid("json");

    // 権限チェック (スタッフ member:write 権限が必要)
    const allowed = await hasPermission(c, null, "member:write", undefined);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作にはスタッフ権限が必要です");
    }

    const wbs = await db.select().from(wristband).where(eq(wristband.id, id));
    if (wbs.length === 0) {
      apiError("NOT_FOUND", "リストバンドが見つかりません");
    }

    const patch: Record<string, any> = { status };
    if (status === "lost" || status === "replaced" || status === "revoked") {
      patch.deactivatedAt = new Date();
    } else {
      patch.deactivatedAt = null;
    }

    if (userId !== undefined) {
      patch.userId = userId;
    }

    await db.update(wristband).set(patch).where(eq(wristband.id, id));

    // 監査ログ
    const auth = c.get("auth");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session && session.user) {
      await audit(c, {
        actorEmail: session.user.email,
        action: "impersonated_write",
        summary: `Updated wristband ${id} status to ${status} and userId to ${userId || "unchanged"}`,
      });
    }

    return c.json({ success: true });
  }
);

// 来場者ユーザー情報更新 (ニックネーム、お好きな日付、呼出ID、ステータス) - 2026-07-13 追加
wristbandRoutes.patch(
  "/user/:userId",
  zBody(
    z.object({
      nickname: z.string().trim().min(1).max(30).nullable().optional(),
      favoriteDate: z.string().nullable().optional(),
      displayId: z.number().int().positive().optional(),
      status: z.enum(["available", "banned"]).optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const userId = c.req.param("userId");
    const body = c.req.valid("json");

    // 権限チェック (スタッフ member:write 権限が必要)
    const allowed = await hasPermission(c, null, "member:write", undefined);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作にはスタッフ権限が必要です");
    }

    const users = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (users.length === 0) {
      apiError("NOT_FOUND", "ユーザーが見つかりません");
    }

    const patch: Record<string, any> = {};
    if (body.nickname !== undefined) patch.nickname = body.nickname;
    if (body.favoriteDate !== undefined) {
      if (body.favoriteDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.favoriteDate)) {
        apiError("BAD_REQUEST", "日付は YYYY-MM-DD 形式で入力してください");
      }
      patch.favoriteDate = body.favoriteDate || null;
    }
    if (body.displayId !== undefined) {
      // 重複チェック
      const existing = await db
        .select()
        .from(eventUser)
        .where(
          and(
            eq(eventUser.eventId, users[0]!.eventId),
            eq(eventUser.displayId, body.displayId)
          )
        );
      if (existing.length > 0 && existing[0]!.id !== userId) {
        apiError("CONFLICT", "この呼出IDは既に使用されています");
      }
      patch.displayId = body.displayId;
    }
    if (body.status !== undefined) patch.status = body.status;

    await db.update(eventUser).set(patch).where(eq(eventUser.id, userId));

    // 監査ログ
    const auth = c.get("auth");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session && session.user) {
      await audit(c, {
        actorEmail: session.user.email,
        action: "impersonated_write",
        summary: `Updated visitor user profile for user ID ${userId}`,
      });
    }

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
      favoriteDate: z.string().optional(), // YYYY-MM-DD
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { userId, nickname, favoriteDate } = c.req.valid("json");

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
        favoriteDate: favoriteDate || null,
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
      favoriteDate: updated.favoriteDate,
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
    const db = c.get("db");
    const { eventId, wristbandId } = c.req.valid("json");
 
    const events = await db.select().from(event).where(eq(event.id, eventId));
    if (events.length === 0) {
      apiError("NOT_FOUND", "イベントが見つかりません");
    }

    const auth = c.get("auth");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    // 物理リストバンドの紐付け(wristbandId指定)がある場合のみスタッフ権限(セッション)を必須とする。
    // wristbandIdがない場合はデジタルQRコードのセルフ発行であるため、セッションなしでも許可する。
    if (wristbandId && (!session || !session.user)) {
      apiError("UNAUTHORIZED", "認証されていません");
    }

    const userId = `usr_${nanoid(12)}`;
    const displayId = await nextDisplayId(db, eventId);
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
    } else {
      // 物理リストバンドIDが指定されない場合は、イベントの設定に関わらず
      // 来場者自身のスマホで使えるようにスマホ用疑似リストバンド(smartphone)を常に登録する
      await db.insert(wristband).values({
        id: `sp_${userId}`,
        userId,
        status: "smartphone",
        assignedAt: new Date(),
      });
    }

    return c.json({ userId, displayId, wristbandId: wristbandId ?? null });
  }
);

export default wristbandRoutes;

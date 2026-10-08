import { Hono } from "hono";
import { z } from "zod";
import { eventUser, wristband, wristbandBatch, wristbandBatchChunk, event, type DB } from "@fesflow/db";
import { eq, and, asc, desc, or, like, isNull, isNotNull, countDistinct, count, inArray, max } from "drizzle-orm";
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
      bandType: z.enum(["all", "physical", "smartphone", "unlinked"]).optional().default("all"),
      accountStatus: z.enum(["all", "available", "banned"]).optional().default("all"),
      profileStatus: z.enum(["all", "complete", "pending"]).optional().default("all"),
      offset: z.coerce.number().int().min(0).optional().default(0),
      limit: z.coerce.number().int().min(1).max(500).optional().default(50),
      sortBy: z
        .enum(["createdAt", "displayId", "nickname", "favoriteDate", "accountStatus", "wristbandId", "bandStatus"])
        .optional()
        .default("createdAt"),
      sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { eventId, query, bandType, accountStatus, profileStatus, offset, limit, sortBy, sortDirection } = c.req.valid("query");

    // 権限チェック (イベントスタッフ権限 member:read が必要)
    const allowed = await hasPermission(c, null, "member:read", eventId);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作にはスタッフ権限が必要です");
    }

    const conditions = [eq(eventUser.eventId, eventId)];

    if (bandType === "physical") conditions.push(eq(wristband.status, "active"));
    if (bandType === "smartphone") conditions.push(eq(wristband.status, "smartphone"));
    if (bandType === "unlinked") conditions.push(isNull(wristband.id));
    if (accountStatus !== "all") conditions.push(eq(eventUser.status, accountStatus));
    if (profileStatus === "complete") conditions.push(isNotNull(eventUser.onboardedAt));
    if (profileStatus === "pending") conditions.push(isNull(eventUser.onboardedAt));

    if (query && query.trim().length > 0) {
      const queryNum = parseInt(query, 10);
      const isNum = !isNaN(queryNum) && /^\d+$/.test(query);

      const orConditions = [
        like(eventUser.nickname, `%${query}%`),
        like(eventUser.favoriteDate, `%${query}%`),
        like(wristband.id, `%${query}%`),
      ];

      if (isNum) {
        orConditions.push(eq(eventUser.displayId, queryNum));
      }

      const orOp = or(...orConditions);
      if (orOp) {
        conditions.push(orOp);
      }
    }

    // 2026-10-02: 50件を超える来場者もページ移動で検索できるよう、条件一致件数を返しAPIでは1ページ分だけ取得する。
    const totalRows = await db
      .select({ total: countDistinct(eventUser.id) })
      .from(eventUser)
      .leftJoin(
        wristband,
        and(
          eq(wristband.userId, eventUser.id),
          or(eq(wristband.status, "active"), eq(wristband.status, "smartphone"))
        )
      )
      .where(and(...conditions));

    // 2026-10-02: 並べ替えはページ取得より前のSQLで行い、ページをまたいでも全結果の順序を保つ。
    const sortColumn = {
      createdAt: eventUser.createdAt,
      displayId: eventUser.displayId,
      nickname: eventUser.nickname,
      favoriteDate: eventUser.favoriteDate,
      accountStatus: eventUser.status,
      wristbandId: wristband.id,
      bandStatus: wristband.status,
    }[sortBy];
    const primaryOrder = sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);

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
      .orderBy(primaryOrder, desc(eventUser.createdAt), desc(eventUser.id))
      .limit(limit)
      .offset(offset);

    return c.json({
      items: rows.map((r) => ({
        user: r.user,
        wristband: r.wristband,
      })),
      total: totalRows[0]?.total ?? 0,
      offset,
      limit,
    });
  }
);

/** イベント内で次に割り当てる呼出用 displayId を採番する。 */
// 2026-07-08 (Phase5): db をモジュール Proxy ではなく引数で受け取る (Context を持たない
// トップレベル関数のため、計画通り db を明示的な引数にした)。
async function nextDisplayId(db: DB, eventId: string): Promise<number> {
  const rows = await db
    .select({ displayId: max(eventUser.displayId) })
    .from(eventUser)
    .where(eq(eventUser.eventId, eventId));
  // 2026-10-06: バッチごとの全来場者走査を避け、履歴再開でもイベント規模に比例した読み込みをしない。
  return (rows[0]?.displayId ?? 0) + 1;
}

// コード (リストバンドID、ユーザーID) によるユーザー照会
// 2026-07-13: URLエンコードされたスラッシュを含むコードに対応するため、正規表現でスラッシュを含む全文字列をキャッチできるようにする
wristbandRoutes.get("/lookup/:code{.+}", async (c) => {
  const db = c.get("db");
  let code = c.req.param("code");

  // 2026-07-04: QRコードスキャン等で URL (例: https://.../w/usr_xxx) が入ってきた場合に対応
  const urlMatch = code.match(/\/w\/([a-zA-Z0-9_\-]+)/);
  if (urlMatch && urlMatch[1]) {
    code = urlMatch[1];
  }

  // 2026-07-13: 店頭スキャン等でチェックインURL (例: https://.../circle/checkin?wb=sp_usr_xxx) が入ってきた場合に対応
  const wbMatch = code.match(/[\?&]wb=([a-zA-Z0-9_\-]+)/);
  if (wbMatch && wbMatch[1]) {
    code = wbMatch[1];
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
    const bandOwner = bandExists
      ? await db.select().from(eventUser).where(eq(eventUser.id, bandNow[0]!.userId))
      : [];

    // 2026-10-08: 来場登録QRは同一イベント内で既発行バンドを紐付ける導線。
    // 既存バンドの所属イベントと対象ユーザーのイベントが異なる場合は、管理者権限があっても移管させない。
    const targetEventId = users[0]?.eventId;
    const bandEventId = bandOwner[0]?.eventId;
    if (targetEventId && bandEventId && targetEventId !== bandEventId) {
      apiError("FORBIDDEN", "別のイベントで登録されたリストバンドは使用できません");
    }

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
      let evId: string | undefined = targetEventId ?? bandEventId;
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
      // 初回チェックインでは、読み取った既発行バンドのイベントに来場者を作成する。
      // 新規バンド発行のスタッフ導線では従来どおり先頭イベントを使う。
      const eventsList = await db.select().from(event).limit(1);
      const defaultEventId = bandEventId ?? eventsList[0]?.id ?? "evt_default";
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

    const wbs = await db.select().from(wristband).where(eq(wristband.id, id));
    if (wbs.length === 0) {
      apiError("NOT_FOUND", "リストバンドが見つかりません");
    }
    const currentUsers = await db.select().from(eventUser).where(eq(eventUser.id, wbs[0]!.userId));
    if (currentUsers.length === 0) {
      apiError("NOT_FOUND", "リストバンドの来場者が見つかりません");
    }

    // 2026-10-08: リソースのイベントを権限評価へ渡し、別イベントのスタッフによる更新を防ぐ。
    const allowed = await hasPermission(c, null, "member:write", currentUsers[0]!.eventId);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作には対象イベントのスタッフ権限が必要です");
    }

    const patch: Record<string, any> = { status };
    if (status === "lost" || status === "replaced" || status === "revoked") {
      patch.deactivatedAt = new Date();
    } else {
      patch.deactivatedAt = null;
    }

    if (userId !== undefined) {
      const targetUsers = await db.select().from(eventUser).where(eq(eventUser.id, userId));
      if (targetUsers.length === 0) {
        apiError("NOT_FOUND", "紐付け先の来場者が見つかりません");
      }
      if (targetUsers[0]!.eventId !== currentUsers[0]!.eventId) {
        apiError("FORBIDDEN", "イベントをまたぐリストバンドの付け替えはできません");
      }
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

    const users = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (users.length === 0) {
      apiError("NOT_FOUND", "ユーザーが見つかりません");
    }

    // 2026-10-08: 来場者行から対象イベントを解決してから権限を確認し、
    // 別イベントのスタッフがIDを知っていてもプロフィールを変更できないようにする。
    const allowed = await hasPermission(c, null, "member:write", users[0]!.eventId);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作には対象イベントのスタッフ権限が必要です");
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

// 来場者オンボーディング / プロフィール自己編集 (2026-07-04, 2026-07-15 セルフ編集対応)
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

    // 日付は保存前に形式検証する (マイページのセルフ編集からも入ってくるため)。
    if (favoriteDate && !/^\d{4}-\d{2}-\d{2}$/.test(favoriteDate)) {
      apiError("BAD_REQUEST", "日付は YYYY-MM-DD 形式で入力してください");
    }

    // 2026-07-15: 2026-07-06 の write-once (登録後は変更不可) を緩和し、来場者が自分の
    // ニックネーム/お好きな日付を後から編集できるようにする (プロダクト要件)。
    // ベアラーモデル(userId 保持者=本人)は来場者アプリ全体の信頼境界なので、編集もこれに委ねる
    // — userId は QR/localStorage に入る実質トークンであり、所持=本人とみなすのは lookup 等と同じ。
    // ただし onboardedAt(入場確定時刻)は初回のみ設定し以降は動かさない。これにより
    //   (a) オンボーディングゲートが再編集で再発火しない、(b) 入場日時がぶれない、を保つ。
    await db
      .update(eventUser)
      .set({
        nickname,
        favoriteDate: favoriteDate || null,
        onboardedAt: u.onboardedAt ?? new Date(),
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

// 既存の未紐付けユーザーにスマホ用デジタルリストバンド(sp_)を発行する (2026-07-14)
// 物理リストバンドを持たない/紛失した来場者に対し、本部側からスマホ単体で使えるIDを
// 明示的に付与するための操作。lookup が !hasPhysicalWristband 時に自動発行する処理を、
// スタッフが任意のユーザーへ能動的に実行できるようにした (未紐付けのままでは決済/スタンプが
// 使えないため、その場でスマホIDを立ち上げられる導線が必要だった)。
wristbandRoutes.post(
  "/issue-smartphone",
  zBody(z.object({ userId: z.string().min(1) })),
  async (c) => {
    const db = c.get("db");
    const { userId } = c.req.valid("json");

    const users = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (users.length === 0) {
      apiError("NOT_FOUND", "ユーザーが見つかりません");
    }

    // 権限チェック (スタッフ member:write 権限が必要)。ユーザーの所属イベントで判定する。
    const allowed = await hasPermission(c, null, "member:write", users[0]!.eventId);
    if (!allowed) {
      apiError("FORBIDDEN", "この操作にはスタッフ権限が必要です");
    }

    // 二重発行を避けるため、既存のアクティブ/スマホバンドは先に無効化する。
    await db
      .update(wristband)
      .set({ status: "replaced", deactivatedAt: new Date() })
      .where(
        and(
          eq(wristband.userId, userId),
          or(eq(wristband.status, "active"), eq(wristband.status, "smartphone"))
        )
      );

    // スマホ用IDは userId から決定的に導出する (sp_ プレフィックス)。既存レコードがあれば再有効化。
    const spId = `sp_${userId}`;
    const existing = await db.select().from(wristband).where(eq(wristband.id, spId));
    if (existing.length === 0) {
      await db.insert(wristband).values({
        id: spId,
        userId,
        status: "smartphone",
        assignedAt: new Date(),
      });
    } else {
      await db
        .update(wristband)
        .set({ status: "smartphone", userId, assignedAt: new Date(), deactivatedAt: null })
        .where(eq(wristband.id, spId));
    }

    return c.json({ success: true, wristbandId: spId });
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
    // 物理リストバンドの紐付け(wristbandId指定)がある場合のみログインと対象イベントのスタッフ権限を必須とする。
    // wristbandIdがない場合はデジタルQRコードのセルフ発行であるため、セッションなしでも許可する。
    if (wristbandId && (!session || !session.user)) {
      apiError("UNAUTHORIZED", "認証されていません");
    }
    if (wristbandId) {
      // 2026-10-08: ログインしているだけでは別イベントの物理バンドを発行できないよう、
      // 来場者・バンド管理と同じ対象イベントの member:write を確認する。
      const allowed = await hasPermission(c, null, "member:write", eventId);
      if (!allowed) {
        apiError("FORBIDDEN", "このイベントでリストバンドを発行する権限がありません");
      }
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

// 2026-10-06: 元URLと進捗を永続化し、画面を離れても履歴からダウンロード・再開できるようにする。
// URLは400件ずつD1へ保存し、1行サイズ制限を避けつつ、Workerリクエストの回数を抑える。
const WRISTBAND_BATCH_CHUNK_SIZE = 400;
const WRISTBAND_BATCH_INSERT_SIZE = 20;

function wristbandIdFromUrl(url: string): string | null {
  const match = url.match(/\/w\/([a-zA-Z0-9_-]+)(?:[?#].*)?$/);
  return match?.[1] ?? (url.match(/^[a-zA-Z0-9_-]+$/)?.[0] ?? null);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

// 2026-10-06: イベントの最新発行/取込履歴。イベント権限を毎回サーバーで確認する。
wristbandRoutes.get(
  "/batches",
  zQuery(z.object({
    eventId: z.string().min(1),
    offset: z.coerce.number().int().min(0).optional().default(0),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })),
  async (c) => {
    const db = c.get("db");
    const { eventId, offset, limit } = c.req.valid("query");
    if (!(await hasPermission(c, null, "member:read", eventId))) {
      apiError("FORBIDDEN", "履歴を表示する権限がありません");
    }
    const [totalRow] = await db
      .select({ total: count() })
      .from(wristbandBatch)
      .where(eq(wristbandBatch.eventId, eventId));
    const items = await db
      .select()
      .from(wristbandBatch)
      .where(eq(wristbandBatch.eventId, eventId))
      .orderBy(desc(wristbandBatch.createdAt), desc(wristbandBatch.id))
      .limit(limit)
      .offset(offset);
    return c.json({ items, total: totalRow?.total ?? 0, offset, limit });
  }
);

// 2026-10-06: URL一覧を先に保存してから登録を始め、途中で画面を閉じても処理とCSVを復旧できるようにする。
wristbandRoutes.post(
  "/batches",
  zBody(z.object({
    eventId: z.string().min(1),
    source: z.enum(["generated", "csv"]),
    prefix: z.string().trim().min(1).max(32).optional(),
    suffixLength: z.number().int().min(4).max(32).optional(),
    urls: z.array(z.string().trim().min(1)).min(1),
  })),
  async (c) => {
    const db = c.get("db");
    const { eventId, source, prefix, suffixLength, urls } = c.req.valid("json");
    if (!(await hasPermission(c, null, "member:write", eventId))) {
      apiError("FORBIDDEN", "この操作にはイベントの編集権限が必要です");
    }
    const events = await db.select({ id: event.id }).from(event).where(eq(event.id, eventId));
    if (events.length === 0) apiError("NOT_FOUND", "イベントが見つかりません");

    if (source === "generated" && (!prefix || !suffixLength || urls.length > 50_000)) {
      apiError("BAD_REQUEST", "生成設定が正しくありません");
    }
    const ids = urls.map(wristbandIdFromUrl);
    if (ids.some((id) => !id)) {
      apiError("BAD_REQUEST", "CSVには /w/ID 形式のURLだけを入力してください");
    }
    const wristbandIds = ids as string[];
    if (source === "generated" && wristbandIds.some((id) => {
      const expectedPrefix = `${prefix}-`;
      return !id.startsWith(expectedPrefix) || id.slice(expectedPrefix.length).length !== suffixLength;
    })) {
      apiError("BAD_REQUEST", "生成したIDが指定されたイベントIDまたは文字数と一致しません");
    }
    if (new Set(wristbandIds).size !== wristbandIds.length) {
      apiError("CONFLICT", "入力内に重複したリストバンドURLがあります。重複を解消して再度お試しください");
    }

    const batchId = nanoid(16);
    const storedChunks = chunkItems(urls, WRISTBAND_BATCH_CHUNK_SIZE).map((chunk, chunkIndex) => ({
      batchId,
      chunkIndex,
      urlsJson: JSON.stringify(chunk),
    }));
    const statements: Parameters<DB["batch"]>[0] = [
      db.insert(wristbandBatch).values({
        id: batchId,
        eventId,
        source,
        prefix: prefix ?? null,
        suffixLength: suffixLength ?? null,
        totalCount: urls.length,
      }),
      ...chunkItems(storedChunks, WRISTBAND_BATCH_INSERT_SIZE).map((rows) =>
        db.insert(wristbandBatchChunk).values(rows)
      ),
    ];
    // 2026-10-06: D1 batchは全statementを同一トランザクションで実行し、親履歴とURLを一緒に確定する。
    await db.batch(statements);
    const [created] = await db.select().from(wristbandBatch).where(eq(wristbandBatch.id, batchId));
    return c.json(created, 201);
  }
);

// 2026-10-06: 保存済みIDの次の400件だけを登録し、進捗更新もD1 batchに含めて再試行を冪等にする。
wristbandRoutes.post("/batches/:batchId/process", async (c) => {
  const db = c.get("db");
  const batchId = c.req.param("batchId");
  const [batch] = await db.select().from(wristbandBatch).where(eq(wristbandBatch.id, batchId));
  if (!batch) apiError("NOT_FOUND", "発行履歴が見つかりません");
  if (!(await hasPermission(c, null, "member:write", batch.eventId))) {
    apiError("FORBIDDEN", "この操作にはイベントの編集権限が必要です");
  }
  if (batch.status === "completed" || batch.status === "conflict") return c.json(batch);

  const chunkIndex = Math.floor(batch.processedCount / WRISTBAND_BATCH_CHUNK_SIZE);
  const [storedChunk] = await db
    .select({ urlsJson: wristbandBatchChunk.urlsJson })
    .from(wristbandBatchChunk)
    .where(and(eq(wristbandBatchChunk.batchId, batchId), eq(wristbandBatchChunk.chunkIndex, chunkIndex)));
  if (!storedChunk) apiError("NOT_FOUND", "未処理のURLデータが見つかりません");
  const storedUrls = JSON.parse(storedChunk.urlsJson) as string[];
  const startInChunk = batch.processedCount % WRISTBAND_BATCH_CHUNK_SIZE;
  const urls = storedUrls.slice(startInChunk, startInChunk + WRISTBAND_BATCH_CHUNK_SIZE);
  const ids = urls.map(wristbandIdFromUrl) as string[];
  const existingIds: string[] = [];
  // D1の1クエリ100バインド変数上限に合わせて、既存ID照合も100件単位に分ける。
  for (const idGroup of chunkItems(ids, 100)) {
    const existing = await db
      .select({ id: wristband.id })
      .from(wristband)
      .where(inArray(wristband.id, idGroup));
    existingIds.push(...existing.map((row) => row.id));
  }
  if (existingIds.length > 0) {
    const errorMessage = `登録済みIDが${existingIds.length}件含まれるため、登録を中断しました。CSVを修正して新しいバッチとして取り込んでください。`;
    await db.update(wristbandBatch).set({
      status: "conflict",
      conflictCount: existingIds.length,
      errorMessage,
    }).where(and(eq(wristbandBatch.id, batchId), eq(wristbandBatch.processedCount, batch.processedCount)));
    const [conflicted] = await db.select().from(wristbandBatch).where(eq(wristbandBatch.id, batchId));
    return c.json(conflicted);
  }

  const firstDisplayId = await nextDisplayId(db, batch.eventId);
  const userRows = ids.map((_, index) => ({
    id: `usr_${nanoid(12)}`,
    eventId: batch.eventId,
    displayId: firstDisplayId + index,
    status: "available",
  }));
  const bandRows = ids.map((id, index) => ({
    id,
    userId: userRows[index]!.id,
    status: "active",
  }));
  const processedCount = batch.processedCount + ids.length;
  const isComplete = processedCount >= batch.totalCount;
  const statements: Parameters<DB["batch"]>[0] = [
    // 2026-10-06: 処理可能な履歴は必ず1件以上あるため、先頭statementを明示してD1 batchのtuple型を保つ。
    db.insert(eventUser).values(userRows.slice(0, WRISTBAND_BATCH_INSERT_SIZE)),
    ...chunkItems(userRows.slice(WRISTBAND_BATCH_INSERT_SIZE), WRISTBAND_BATCH_INSERT_SIZE)
      .map((rows) => db.insert(eventUser).values(rows)),
    ...chunkItems(bandRows, WRISTBAND_BATCH_INSERT_SIZE).map((rows) => db.insert(wristband).values(rows)),
    db.update(wristbandBatch).set({
      processedCount,
      importedCount: batch.importedCount + ids.length,
      status: isComplete ? "completed" : "processing",
      errorMessage: null,
      completedAt: isComplete ? new Date() : null,
    }).where(and(
      eq(wristbandBatch.id, batchId),
      eq(wristbandBatch.processedCount, batch.processedCount),
      eq(wristbandBatch.status, batch.status)
    )),
  ];
  // 2026-10-06: 来場者→バンド→進捗の順にコミットし、失敗時は全て戻して次回同じ位置から再開する。
  await db.batch(statements);
  const [updated] = await db.select().from(wristbandBatch).where(eq(wristbandBatch.id, batchId));
  return c.json(updated);
});

// 2026-10-06: 保存URLは権限確認後にだけCSVとして返し、R2/公開URLには置かずイベント管理画面から再取得させる。
wristbandRoutes.get("/batches/:batchId/csv", async (c) => {
  const db = c.get("db");
  const batchId = c.req.param("batchId");
  const [batch] = await db.select().from(wristbandBatch).where(eq(wristbandBatch.id, batchId));
  if (!batch) apiError("NOT_FOUND", "発行履歴が見つかりません");
  if (!(await hasPermission(c, null, "member:read", batch.eventId))) {
    apiError("FORBIDDEN", "このCSVをダウンロードする権限がありません");
  }
  const chunks = await db
    .select({ chunkIndex: wristbandBatchChunk.chunkIndex, urlsJson: wristbandBatchChunk.urlsJson })
    .from(wristbandBatchChunk)
    .where(eq(wristbandBatchChunk.batchId, batchId))
    .orderBy(asc(wristbandBatchChunk.chunkIndex));
  const urls = chunks.flatMap((chunk) => JSON.parse(chunk.urlsJson) as string[]);
  const csv = `\uFEFFurl\r\n${urls.join("\r\n")}`;
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="wristbands_${batchId}_${batch.totalCount}.csv"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
});

// 2026-10-02: 印刷会社から戻ったリストバンドURL CSVをイベント単位で一括登録する。
// 任意のURLアクセスでユーザーを自動生成すると、推測されたIDで来場者枠を無制限に
// 作成できるため、スタッフ権限のある管理画面から先に発行・紐付ける方式に固定する。
wristbandRoutes.post(
  "/import",
  zBody(
    z.object({
      eventId: z.string().min(1),
      // D1の1クエリ100バインド変数上限に対し、eventUserは1行4列を挿入するため20件まで。
      // 大きなCSVは管理画面側がこの上限に合わせて分割して送る。
      urls: z.array(z.string().trim().min(1)).min(1).max(20),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { eventId, urls } = c.req.valid("json");
    const allowed = await hasPermission(c, null, "member:write", eventId);
    if (!allowed) apiError("FORBIDDEN", "この操作にはイベントの編集権限が必要です");

    const events = await db.select().from(event).where(eq(event.id, eventId));
    if (events.length === 0) apiError("NOT_FOUND", "イベントが見つかりません");

    const ids = urls.map((url) => {
      const match = url.match(/\/w\/([a-zA-Z0-9_-]+)(?:[?#].*)?$/);
      return match?.[1] ?? (url.match(/^[a-zA-Z0-9_-]+$/)?.[0] ?? null);
    });
    if (ids.some((id) => !id)) {
      apiError("BAD_REQUEST", "CSVには /w/ID 形式のURLだけを入力してください");
    }
    const wristbandIds = ids as string[];
    const uniqueIds = [...new Set(wristbandIds)];
    if (uniqueIds.length !== wristbandIds.length) {
      apiError("CONFLICT", "CSV内に重複したリストバンドURLがあります");
    }

    const existing = await db.select().from(wristband).where(or(...uniqueIds.map((id) => eq(wristband.id, id))));
    if (existing.length > 0) {
      apiError("CONFLICT", `登録済みのリストバンドが ${existing.length} 件あります`);
    }

    const startDisplayId = await nextDisplayId(db, eventId);
    const userRows = wristbandIds.map((_, index) => ({
      id: `usr_${nanoid(12)}`,
      eventId,
      displayId: startDisplayId + index,
      status: "available",
    }));
    const bandRows = wristbandIds.map((id, index) => ({
      id,
      userId: userRows[index]!.id,
      status: "active",
    }));

    // D1の対話型トランザクションは使えないため、FKの親→子順でbulk insertする。
    await db.insert(eventUser).values(userRows);
    await db.insert(wristband).values(bandRows);
    return c.json({ imported: wristbandIds.length, firstDisplayId: startDisplayId });
  }
);

export default wristbandRoutes;

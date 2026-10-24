import { Hono } from "hono";
import { z } from "zod";
import { circle, circleVisit, eventUser, wristband, wristbandBatch, wristbandBatchChunk, event, type DB } from "@fesflow/db";
import { eq, and, asc, desc, or, like, isNull, isNotNull, countDistinct, count, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasPermission } from "../utils/auth";
import { zBody, zQuery } from "../z-validator";
import { apiError } from "../http-error";
import type { AppEnv } from "../types";
import { JAPANESE_ALLERGENS_28 } from "@fesflow/config/allergens";
import { VISITOR_AGE_GROUP_VALUES } from "@fesflow/config/visitor-profile";


const wristbandRoutes = new Hono<AppEnv>();
const WRISTBAND_SEARCH_USER_ID_CHUNK_SIZE = 98;
const allergyListSchema = z.array(z.enum(JAPANESE_ALLERGENS_28)).max(28)
  .refine((allergies) => new Set(allergies).size === allergies.length, "アレルギー項目の重複を解消してください");
const visitorAgeGroupSchema = z.enum(VISITOR_AGE_GROUP_VALUES);

async function getFamilyWristbands(db: DB, userId: string) {
  return db
    .select()
    .from(wristband)
    .where(and(
      eq(wristband.userId, userId),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone"))
    ))
    .orderBy(asc(wristband.assignedAt), asc(wristband.id));
}

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
        .enum(["createdAt", "displayId", "nickname", "favoriteDate", "ageGroup", "onboardedAt", "accountStatus", "wristbandId", "bandStatus"])
        .optional()
        .default("createdAt"),
      sortDirection: z.enum(["asc", "desc"]).optional().default("desc"),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { eventId, query, bandType, accountStatus, profileStatus, offset, limit, sortBy, sortDirection } = c.req.valid("query");

    const canReadMembers = await hasPermission(c, null, "member:read", eventId);
    const canReplaceWristbands = await hasPermission(c, null, "wristband:replace", eventId);
    const canOperateStampRally = await hasPermission(c, null, "stamp-rally:operate", eventId);
    // 2026-10-25: リストバンド管理を既存の交換担当・景品交換担当にも開放する。書き込みAPIは引き続き各操作の権限で保護する。
    if (!canReadMembers && !canReplaceWristbands && !canOperateStampRally) {
      apiError("FORBIDDEN", "この操作にはスタッフ権限が必要です");
    }
    const restrictedVisitorProfile = !canReadMembers;

    const conditions = [eq(eventUser.eventId, eventId)];

    if (bandType === "physical") conditions.push(eq(wristband.status, "active"));
    if (bandType === "smartphone") conditions.push(eq(wristband.status, "smartphone"));
    if (bandType === "unlinked") conditions.push(isNull(wristband.id));
    if (accountStatus !== "all") conditions.push(eq(eventUser.status, accountStatus));
    if (profileStatus === "complete") conditions.push(isNotNull(eventUser.onboardedAt));
    if (profileStatus === "pending") conditions.push(isNull(eventUser.onboardedAt));

    if (query && query.trim().length > 0) {
      const normalizedQuery = query.trim();
      const queryNum = Number(normalizedQuery);
      const isNum = Number.isSafeInteger(queryNum) && /^\d+$/.test(normalizedQuery);

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
      ageGroup: eventUser.ageGroup,
      onboardedAt: eventUser.onboardedAt,
      accountStatus: eventUser.status,
      wristbandId: wristband.id,
      bandStatus: wristband.status,
    }[sortBy];
    const primaryOrder = sortDirection === "asc" ? asc(sortColumn) : desc(sortColumn);

    const rowsQuery = db
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
      // 2026-10-15 (#125): ページング単位をリストバンドではなく共有アカウントにし、
      // 家族が複数バンドを持っていても同じ来場者を複数ページに重複表示しない。
      .groupBy(eventUser.id);
    const numericQuery = query.trim();
    const numericDisplayId = /^\d+$/.test(numericQuery) && Number.isSafeInteger(Number(numericQuery))
      ? Number(numericQuery)
      : null;
    // 2026-10-25: 数字だけの検索は呼出ID完全一致を先頭に固定し、ページをまたいでも見つけやすくする。
    const order = numericDisplayId === null
      ? [primaryOrder, desc(eventUser.createdAt), desc(eventUser.id)] as const
      : [sql`CASE WHEN ${eventUser.displayId} = ${numericDisplayId} THEN 0 ELSE 1 END`, primaryOrder, desc(eventUser.createdAt), desc(eventUser.id)] as const;
    const rows = await rowsQuery
      .orderBy(...order)
      .limit(limit)
      .offset(offset);

    const userIds = rows.map((r) => r.user.id);
    const familyWristbands: Awaited<ReturnType<typeof getFamilyWristbands>> = [];
    // 2026-10-19: D1の100バインド上限から状態条件2件分を引き、500人表示時のIN句失敗を防ぐ。
    for (const userIdChunk of chunkItems(userIds, WRISTBAND_SEARCH_USER_ID_CHUNK_SIZE)) {
      const chunkWristbands = await db
        .select()
        .from(wristband)
        .where(and(
          inArray(wristband.userId, userIdChunk),
          or(eq(wristband.status, "active"), eq(wristband.status, "smartphone"))
        ))
        .orderBy(asc(wristband.assignedAt), asc(wristband.id));
      familyWristbands.push(...chunkWristbands);
    }

    return c.json({
      items: rows.map((r) => {
        const visitorBands = familyWristbands.filter((band) => band.userId === r.user.id);
        return {
          user: restrictedVisitorProfile
            ? {
                id: r.user.id,
                eventId: r.user.eventId,
                displayId: r.user.displayId,
                status: r.user.status,
                nickname: r.user.nickname,
                favoriteDate: r.user.favoriteDate,
                ageGroup: r.user.ageGroup,
                onboardedAt: r.user.onboardedAt,
                createdAt: r.user.createdAt,
              }
            : r.user,
          wristband: restrictedVisitorProfile && r.wristband
            ? { id: r.wristband.id, userId: r.wristband.userId, status: r.wristband.status, nickname: r.wristband.nickname, assignedAt: r.wristband.assignedAt }
            : r.wristband,
          familyWristbands: restrictedVisitorProfile
            ? visitorBands.map(({ id, userId, status, nickname, assignedAt }) => ({ id, userId, status, nickname, assignedAt }))
            : visitorBands,
          familyBandCount: visitorBands.length,
        };
      }),
      total: totalRows[0]?.total ?? 0,
      offset,
      limit,
    });
  }
);

// 2026-10-19: 現行の来場者検索は有効なバンドだけを結合するため、紛失履歴を
// 専用一覧で取得し、再発行時に対象バンドと来場者を取り違えないようにする。
wristbandRoutes.get(
  "/lost",
  zQuery(z.object({
    eventId: z.string().min(1),
    query: z.string().optional().default(""),
    offset: z.coerce.number().int().min(0).optional().default(0),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  })),
  async (c) => {
    const db = c.get("db");
    const { eventId, query, offset, limit } = c.req.valid("query");
    if (!(await hasPermission(c, null, "member:read", eventId))) {
      apiError("FORBIDDEN", "紛失リストバンドを表示する権限がありません");
    }

    const conditions = [eq(eventUser.eventId, eventId), eq(wristband.status, "lost")];
    const normalizedQuery = query.trim();
    if (normalizedQuery) {
      const matches = [
        like(eventUser.nickname, `%${normalizedQuery}%`),
        like(wristband.nickname, `%${normalizedQuery}%`),
        like(wristband.id, `%${normalizedQuery}%`),
      ];
      if (/^\d+$/.test(normalizedQuery)) {
        matches.push(eq(eventUser.displayId, Number(normalizedQuery)));
      }
      const match = or(...matches);
      if (match) conditions.push(match);
    }

    const where = and(...conditions);
    const [totalRow] = await db
      .select({ total: count() })
      .from(wristband)
      .innerJoin(eventUser, eq(eventUser.id, wristband.userId))
      .where(where);
    const items = await db
      .select({
        user: {
          id: eventUser.id,
          displayId: eventUser.displayId,
          nickname: eventUser.nickname,
          status: eventUser.status,
        },
        wristband: {
          id: wristband.id,
          userId: wristband.userId,
          status: wristband.status,
          nickname: wristband.nickname,
          assignedAt: wristband.assignedAt,
          deactivatedAt: wristband.deactivatedAt,
        },
      })
      .from(wristband)
      .innerJoin(eventUser, eq(eventUser.id, wristband.userId))
      .where(where)
      .orderBy(desc(wristband.deactivatedAt), desc(wristband.assignedAt), asc(wristband.id))
      .limit(limit)
      .offset(offset);

    return c.json({ items, total: totalRow?.total ?? 0, offset, limit });
  }
);

/** イベント内の呼出ID範囲をDBの単一書き込みで確保する。 */
async function allocateDisplayIds(db: DB, eventId: string, count: number): Promise<number> {
  // 2026-10-17: MAX(display_id)+1 は並行発行で衝突するため、D1のatomic upsertで範囲を予約する。
  // 既存データの最大値も毎回下限に使い、導入時の既存来場者を安全に引き継ぐ。
  const row = await db.$client.prepare(`
    INSERT INTO event_user_sequence (event_id, value)
    SELECT ?, COALESCE(MAX(display_id), 0) + ? FROM event_user WHERE event_id = ?
    ON CONFLICT(event_id) DO UPDATE SET value =
      max(event_user_sequence.value, (SELECT COALESCE(MAX(display_id), 0) FROM event_user WHERE event_id = ?)) + ?
    RETURNING value
  `).bind(eventId, count, eventId, eventId, count).first<{ value: number }>();
  if (!row) throw new Error("来場者番号を確保できませんでした");
  return row.value - count + 1;
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
    .where(and(
      eq(wristband.id, code),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
    ));


  if (wristbands.length > 0) {
    const wb = wristbands[0]!;
    const users = await db
      .select()
      .from(eventUser)
      .where(eq(eventUser.id, wb.userId));

    if (users.length > 0) {
      const familyWristbands = await getFamilyWristbands(db, users[0]!.id);
      return c.json({
        user: users[0],
        wristband: wb,
        familyWristbands,
        familyBandCount: familyWristbands.length,
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
    const activeWristbands = await getFamilyWristbands(db, user.id);

    if (activeWristbands.length > 0) {
      return c.json({
        user,
        wristband: activeWristbands[activeWristbands.length - 1],
        familyWristbands: activeWristbands,
        familyBandCount: activeWristbands.length,
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
        familyWristbands: [newWb],
        familyBandCount: 1,
      });
    }

    return c.json({
      user,
      wristband: null,
      familyWristbands: [],
      familyBandCount: 0,
    });
  }


  // 3. 未知のコード/ユーザーIDの場合の自動作成フォールバックを撤去 (2026-07-06)。
  // 認証なしで誰でも任意のコードを叩くたびに eventUser が無制限に生成されてしまい、
  // DB膨張/コスト増/DoSの温床になっていたため。lookup はあくまで「既存の照会」に徹し、
  // 未知のコードは 404 を返す。正規の来場者ID発行は POST /issue (セッション必須) や
  // POST /register (能動的なリストバンド登録操作) で行う。
  apiError("NOT_FOUND", "ユーザーが見つかりません");
});

// 2026-10-20: 公開スキャン用 lookup に管理情報を混ぜず、イベント権限を確認した編集専用 API で
// 来場者・家族バンド・サークル体験ログをまとめて取得/保存する。内部IDは履歴参照のため変更させない。
const visitorEditorProfileSchema = z.object({
  displayId: z.number().int().positive(),
  status: z.enum(["available", "banned"]),
  nickname: z.string().trim().max(30).nullable(),
  favoriteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  ageGroup: visitorAgeGroupSchema.nullable(),
  allergies: allergyListSchema.nullable(),
  onboardedAt: z.string().datetime().nullable(),
});

const visitorEditorWristbandSchema = z.object({
  id: z.string().trim().min(1).max(180),
  isNew: z.boolean().optional().default(false),
  status: z.enum(["active", "lost", "replaced", "revoked", "smartphone"]),
  nickname: z.string().trim().max(30).nullable(),
  ageGroup: visitorAgeGroupSchema.nullable(),
  onboardedAt: z.string().datetime().nullable(),
  assignedAt: z.string().datetime(),
  deactivatedAt: z.string().datetime().nullable(),
});

const visitorEditorCircleVisitSchema = z.object({
  id: z.string().optional(),
  isNew: z.boolean().optional().default(false),
  isDeleted: z.boolean().optional().default(false),
  circleId: z.string().min(1),
  staffId: z.string().trim().max(100).nullable(),
  createdAt: z.string().datetime(),
});

const visitorEditorUpdateSchema = z.object({
  profile: visitorEditorProfileSchema,
  wristbands: z.array(visitorEditorWristbandSchema).max(100),
  circleVisits: z.array(visitorEditorCircleVisitSchema).max(200),
});

wristbandRoutes.get(
  "/event/:eventId/admin/:userId",
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("eventId");
    const userId = c.req.param("userId");
    if (!(await hasPermission(c, null, "member:read", eventId))) {
      apiError("FORBIDDEN", "来場者情報を閲覧するイベントスタッフ権限が必要です");
    }

    const [user] = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (!user || user.eventId !== eventId) apiError("NOT_FOUND", "イベント内の来場者が見つかりません");

    const [wristbands, visits, circles] = await Promise.all([
      db.select().from(wristband).where(eq(wristband.userId, userId))
        .orderBy(asc(wristband.assignedAt), asc(wristband.id)),
      db.select({
        id: circleVisit.id,
        circleId: circleVisit.circleId,
        circleName: circle.name,
        staffId: circleVisit.staffId,
        deletedAt: circleVisit.deletedAt,
        createdAt: circleVisit.createdAt,
      })
        .from(circleVisit)
        .innerJoin(circle, eq(circleVisit.circleId, circle.id))
        .where(eq(circleVisit.eventUserId, userId))
        .orderBy(desc(circleVisit.createdAt), desc(circleVisit.id)),
      db.select({ id: circle.id, name: circle.name }).from(circle)
        .where(eq(circle.eventId, eventId)).orderBy(asc(circle.name), asc(circle.id)),
    ]);

    return c.json({ user, wristbands, circleVisits: visits, circles });
  },
);

wristbandRoutes.put(
  "/event/:eventId/admin/:userId",
  zBody(visitorEditorUpdateSchema),
  async (c) => {
    const db = c.get("db");
    const eventId = c.req.param("eventId");
    const userId = c.req.param("userId");
    const { profile, wristbands, circleVisits } = c.req.valid("json");
    if (!(await hasPermission(c, null, "member:write", eventId))) {
      apiError("FORBIDDEN", "来場者情報を編集するイベントスタッフ権限が必要です");
    }

    const [user] = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (!user || user.eventId !== eventId) apiError("NOT_FOUND", "イベント内の来場者が見つかりません");
    if (profile.favoriteDate && Number.isNaN(Date.parse(`${profile.favoriteDate}T00:00:00Z`))) {
      apiError("BAD_REQUEST", "お好きな日付を確認してください");
    }
    const duplicateUsers = await db.select({ id: eventUser.id }).from(eventUser).where(and(
      eq(eventUser.eventId, eventId),
      eq(eventUser.displayId, profile.displayId),
    ));
    if (duplicateUsers.some((candidate) => candidate.id !== userId)) {
      apiError("CONFLICT", "この呼出IDは別の来場者が使用しています");
    }
    const [existingBands, existingVisits] = await Promise.all([
      db.select().from(wristband).where(eq(wristband.userId, userId)),
      db.select({ id: circleVisit.id }).from(circleVisit).where(eq(circleVisit.eventUserId, userId)),
    ]);
    const existingBandById = new Map(existingBands.map((band) => [band.id, band]));
    const existingVisitIds = new Set(existingVisits.map((visit) => visit.id));
    const newBandIds = wristbands.filter((band) => band.isNew).map((band) => band.id);
    const duplicateBandIds = new Set<string>();
    for (const id of wristbands.map((band) => band.id)) {
      if (duplicateBandIds.has(id)) apiError("BAD_REQUEST", "リストバンドIDが重複しています");
      duplicateBandIds.add(id);
    }
    if (wristbands.some((band) => !band.isNew && !existingBandById.has(band.id))) {
      apiError("FORBIDDEN", "この来場者に紐付いていないリストバンドは編集できません");
    }
    if (newBandIds.length > 0) {
      const [conflict] = await db.select({ id: wristband.id }).from(wristband).where(inArray(wristband.id, newBandIds)).limit(1);
      if (conflict) apiError("CONFLICT", "登録済みのリストバンドIDがあります");
    }

    const visitIds = circleVisits.flatMap((visit) => visit.id && !visit.isNew ? [visit.id] : []);
    if (visitIds.length !== new Set(visitIds).size) apiError("BAD_REQUEST", "サークル利用実績IDが重複しています");
    if (circleVisits.some((visit) => !visit.isNew && (!visit.id || !existingVisitIds.has(visit.id)))) {
      apiError("FORBIDDEN", "この来場者に紐付いていないサークル利用実績は編集できません");
    }
    const circleIds = [...new Set(circleVisits.filter((visit) => !visit.isDeleted).map((visit) => visit.circleId))];
    if (circleIds.length > 0) {
      const allowedCircles = await db.select({ id: circle.id }).from(circle)
        .where(and(eq(circle.eventId, eventId), inArray(circle.id, circleIds)));
      if (allowedCircles.length !== circleIds.length) {
        apiError("BAD_REQUEST", "別イベントのサークルは利用実績に設定できません");
      }
    }

    const statements: Array<Parameters<DB["batch"]>[0][number]> = [
      db.update(eventUser).set({
        displayId: profile.displayId,
        status: profile.status,
        nickname: profile.nickname || null,
        favoriteDate: profile.favoriteDate,
        ageGroup: profile.ageGroup,
        allergies: profile.allergies === null ? null : JSON.stringify(profile.allergies),
        onboardedAt: profile.onboardedAt ? new Date(profile.onboardedAt) : null,
      }).where(and(eq(eventUser.id, userId), eq(eventUser.eventId, eventId))),
    ];

    for (const band of wristbands) {
      const values = {
        status: band.status,
        nickname: band.nickname || null,
        ageGroup: band.ageGroup,
        onboardedAt: band.onboardedAt ? new Date(band.onboardedAt) : null,
        assignedAt: new Date(band.assignedAt),
        deactivatedAt: band.deactivatedAt ? new Date(band.deactivatedAt) : null,
      };
      statements.push(band.isNew
        ? db.insert(wristband).values({ id: band.id, userId, ...values })
        : db.update(wristband).set(values).where(and(eq(wristband.id, band.id), eq(wristband.userId, userId))));
    }

    for (const visit of circleVisits) {
      if (visit.isNew && visit.isDeleted) continue;
      if (visit.isDeleted) {
        // 2026-10-21: 来訪実績はレビュー資格・統計の根拠なので、削除ではなく利用対象から外す。
        statements.push(db.update(circleVisit).set({ deletedAt: new Date() }).where(and(
          eq(circleVisit.id, visit.id!),
          eq(circleVisit.eventUserId, userId),
          isNull(circleVisit.deletedAt),
        )));
      } else if (visit.isNew) {
        statements.push(db.insert(circleVisit).values({
          id: nanoid(),
          eventUserId: userId,
          circleId: visit.circleId,
          staffId: visit.staffId || null,
          createdAt: new Date(visit.createdAt),
        }));
      } else {
        statements.push(db.update(circleVisit).set({
          circleId: visit.circleId,
          staffId: visit.staffId || null,
          createdAt: new Date(visit.createdAt),
          deletedAt: null,
        }).where(and(eq(circleVisit.id, visit.id!), eq(circleVisit.eventUserId, userId))));
      }
    }

    await db.batch(statements as [Parameters<DB["batch"]>[0][number], ...Parameters<DB["batch"]>[0][number][]]);
    return c.json({ success: true });
  },
);




// 未オンボードの発行済みバンドだけを家族アカウントへ追加する。
// 2026-10-15 (#125): 既存アカウントを統合せず、履歴のない受付前アカウントのみを
// 同一トランザクション内で移し替えることで、注文・抽選等の所有者を変えない。
wristbandRoutes.post(
  "/family-member",
  zBody(z.object({
    userId: z.string().min(1),
    wristbandId: z.string().trim().min(1),
    nickname: z.string().trim().min(1).max(30),
    ageGroup: visitorAgeGroupSchema,
  })),
  async (c) => {
    const db = c.get("db");
    const { userId, wristbandId, nickname, ageGroup } = c.req.valid("json");
    const [account] = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (!account) apiError("NOT_FOUND", "家族を追加するアカウントが見つかりません");
    if (!account.onboardedAt || account.status !== "available") {
      apiError("CONFLICT", "代表者の入場登録完了後に家族を追加できます");
    }

    const [band] = await db.select().from(wristband).where(eq(wristband.id, wristbandId));
    if (!band) apiError("NOT_FOUND", "リストバンドが見つかりません");
    if (band.userId === userId) apiError("CONFLICT", "このアカウントのリストバンドは追加できません");
    if (band.status !== "active" && band.status !== "smartphone") {
      apiError("CONFLICT", "有効なリストバンドのみ追加できます");
    }
    if (band.onboardedAt) {
      apiError("CONFLICT", "入場登録済みのリストバンドは家族に追加できません");
    }

    const [source] = await db.select().from(eventUser).where(eq(eventUser.id, band.userId));
    if (!source || source.eventId !== account.eventId) {
      apiError("CONFLICT", "同じイベントで発行されたリストバンドを入力してください");
    }
    if (source.onboardedAt || source.status !== "available") {
      apiError("CONFLICT", "入場登録済みのアカウントは家族に追加できません");
    }

    // batch 内でも未登録/履歴なしを条件にし、確認後の状態変化による巻き込みを防止する。
    // いずれかの履歴があれば代表者へ移さず拒否する。
    const historyFree = `
      AND NOT EXISTS (SELECT 1 FROM pre_order WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM coupon_redemption WHERE event_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM circle_visit WHERE event_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM numbered_ticket WHERE event_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM review WHERE event_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM lottery_entry WHERE event_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM lottery_winner WHERE event_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM stamp_rally_redemption WHERE event_user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM orders WHERE user_id = ?)
      AND NOT EXISTS (SELECT 1 FROM user_stamp WHERE user_id = ?)
    `;
    const historyBindings = Array.from({ length: 10 }, () => source.id);
    const update = c.env.DB.prepare(`
      UPDATE wristband
      SET user_id = ?, nickname = ?, age_group = ?, onboarded_at = ?
      WHERE id = ? AND user_id = ? AND status IN ('active', 'smartphone') AND onboarded_at IS NULL
        AND EXISTS (SELECT 1 FROM event_user WHERE id = ? AND event_id = ? AND onboarded_at IS NULL AND status = 'available')
        AND (SELECT COUNT(*) FROM wristband WHERE user_id = ?) = 1
        ${historyFree}
    `).bind(
      account.id, nickname, ageGroup, Date.now(),
      wristbandId, source.id, source.id, account.eventId, source.id,
      ...historyBindings,
    );
    const removeEmptySource = c.env.DB.prepare(`
      DELETE FROM event_user
      WHERE id = ? AND onboarded_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM wristband WHERE user_id = ?)
        ${historyFree}
    `).bind(source.id, source.id, ...historyBindings);
    const result = await c.env.DB.batch([update, removeEmptySource]);
    if (result[0]?.meta.changes !== 1 || result[1]?.meta.changes !== 1) {
      apiError("CONFLICT", "このリストバンドは登録済み、または利用履歴があるため家族に追加できません");
    }

    const familyWristbands = await getFamilyWristbands(db, account.id);
    return c.json({
      success: true,
      familyWristbands,
      familyBandCount: familyWristbands.length,
    }, 201);
  }
);

// 2026-10-16: 家族を代表者のアカウントにまとめた後も、バンド単位のプロフィールを編集できるようにする。
wristbandRoutes.patch(
  "/family-member/:wristbandId",
  zBody(z.object({
    userId: z.string().min(1),
    nickname: z.string().trim().min(1).max(30),
    ageGroup: visitorAgeGroupSchema,
  })),
  async (c) => {
    const db = c.get("db");
    const wristbandId = c.req.param("wristbandId");
    const { userId, nickname, ageGroup } = c.req.valid("json");
    const [account] = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (!account) apiError("NOT_FOUND", "代表者が見つかりません");
    if (!account.onboardedAt || account.status !== "available") {
      apiError("CONFLICT", "代表者の入場登録完了後に家族情報を編集できます");
    }

    const [band] = await db.select().from(wristband).where(and(
      eq(wristband.id, wristbandId),
      eq(wristband.userId, userId),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
    ));
    if (!band) apiError("NOT_FOUND", "このアカウントの有効な家族リストバンドが見つかりません");
    if (!band.onboardedAt) apiError("CONFLICT", "入場登録前のリストバンドは家族一覧から編集できません");

    await db.update(wristband).set({ nickname, ageGroup }).where(and(
      eq(wristband.id, wristbandId),
      eq(wristband.userId, userId),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
    ));
    return c.json({ success: true });
  }
);

// リストバンドの新規登録・再発行 (紐付け)
wristbandRoutes.post(
  "/register",
  zBody(
    z.object({
      userId: z.string(),
      wristbandId: z.string(), // 新しいリストバンドのQR/コード値
      replacesWristbandId: z.string().optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { userId, wristbandId, replacesWristbandId } = c.req.valid("json");

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
    let replacementSource: typeof wristband.$inferSelect | undefined;

    // 2026-10-08: 来場登録QRは同一イベント内で既発行バンドを紐付ける導線。
    // 既存バンドの所属イベントと対象ユーザーのイベントが異なる場合は、管理者権限があっても移管させない。
    const targetEventId = users[0]?.eventId;
    const bandEventId = bandOwner[0]?.eventId;
    if (targetEventId && bandEventId && targetEventId !== bandEventId) {
      apiError("FORBIDDEN", "別のイベントで登録されたリストバンドは使用できません");
    }

    if (replacesWristbandId) {
      if (replacesWristbandId === wristbandId) {
        apiError("BAD_REQUEST", "交換対象とは別のIDを指定してください");
      }
      const [sourceBand] = await db.select().from(wristband).where(and(
        eq(wristband.id, replacesWristbandId),
        eq(wristband.userId, userId),
        eq(wristband.status, "active"),
      ));
      if (!sourceBand || !targetEventId) {
        apiError("NOT_FOUND", "交換対象の有効な物理リストバンドが見つかりません");
      }
      if (!bandExists) {
        apiError("BAD_REQUEST", "先に発行済みの物理リストバンドIDを指定してください");
      }
      const replacementBand = bandNow[0]!;
      const replacementBandOwner = bandOwner[0];
      const replacementBandOwnerBands = replacementBandOwner
        ? await db.select({ id: wristband.id }).from(wristband).where(and(
            eq(wristband.userId, replacementBandOwner.id),
            eq(wristband.status, "active"),
          ))
        : [];
      // 2026-10-20: 交換担当が別来場者のバンドを奪えないよう、交換先は未使用の発行済みバンドに限定する。
      if (
        replacementBand.status !== "active" ||
        !replacementBandOwner ||
        replacementBandOwner.eventId !== targetEventId ||
        replacementBandOwner.status !== "available" ||
        replacementBandOwner.nickname ||
        replacementBandOwner.favoriteDate ||
        replacementBandOwner.onboardedAt ||
        replacementBand.nickname ||
        replacementBand.ageGroup ||
        replacementBand.onboardedAt ||
        replacementBandOwnerBands.length !== 1
      ) {
        apiError("BAD_REQUEST", "未使用の発行済み物理リストバンドIDを指定してください");
      }
      if (!(await hasPermission(c, null, "wristband:replace", targetEventId))) {
        apiError("FORBIDDEN", "物理リストバンドの交換にはスタッフ権限が必要です");
      }
      replacementSource = sourceBand;
    }

    // 2026-07-11: 権限ゲート。以下はいずれも本部(スタッフ member:write)権限を要求する:
    //  (a) 未登録=本部未発行のバンドIDの紐付け → 実質「スマホ単体でバンドを新規発行」なので禁止。
    //  (b) 他ユーザーに紐付いたバンドの再割当。lost/replaced/revoked もIDを知る者が
    //      再有効化できないよう対象にする (2026-10-08)。
    //  (c) 既にアクティブなバンドを持つユーザーへの付替え (再発行, 2026-07-05)。
    // 本部発行済み(既存)バンドを、まだバンドを持たない本人が紐付ける初回リンクのみ認証不要。
    // これにより「発行は本部・登録は来場登録QR/本部発行済みID」というフローに揃える。
    const replacingUsersActiveBand = targetActive.some((w) => w.id !== wristbandId);
    const bandOwnedByOther =
      bandExists &&
      bandNow[0]!.userId !== userId;
    const creatingNewBand = !bandExists;
    if (!replacementSource && (replacingUsersActiveBand || bandOwnedByOther || creatingNewBand)) {
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

    // 2026-10-20: 物理バンド交換は通常一覧から選んだ有効IDだけを差し替え、家族の別バンドは停止しない。
    if (!replacementSource) {
      await db
        .update(wristband)
        .set({ status: "replaced", deactivatedAt: new Date() })
        .where(and(eq(wristband.userId, userId), eq(wristband.status, "active")));
    }

    if (bandExists) {
      // 既に登録されているリストバンド (本部発行済み) を本人に紐付けてアクティブ化
      await db
        .update(wristband)
        .set(replacementSource
          ? {
              // 物理IDの交換後も、紛失バンドに付いていた家族プロフィールを引き継ぐ。
              userId,
              status: "active",
              nickname: replacementSource.nickname,
              ageGroup: replacementSource.ageGroup,
              onboardedAt: replacementSource.onboardedAt,
              assignedAt: new Date(),
              deactivatedAt: null,
            }
          : {
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

    // 2026-10-20: 交換元に選ばれた有効バンドを履歴に残し、新IDに紐づけを移す。
    if (replacesWristbandId) {
      await db.update(wristband)
        .set({ status: "replaced", deactivatedAt: new Date() })
        .where(and(eq(wristband.id, replacesWristbandId), eq(wristband.status, "active")));
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

    // 2026-10-16: 監査記録は認証済み変更を共通ミドルウェアで記録し、対象IDを含む個別ログを廃止する。

    return c.json({ success: true });
  }
);

// 2026-10-20: 来場者編集はイベント単位の統合APIに一本化し、部分更新APIを廃止した。
// 来場者オンボーディング / プロフィール自己編集 (2026-07-04, 2026-07-15 セルフ編集対応)
// 認証は不要。userId(eventUser.id) を持っている人=リストバンド保持者本人とみなす
// (ベアラーモデル)。初回のみ onboardedAt を刻む。
wristbandRoutes.post(
  "/onboard",
  zBody(
    z.object({
      userId: z.string().min(1),
      // 2026-10-16: SPA はスマホ入場時に wristbandId=null を送るため、API も null を受け付ける。
      wristbandId: z.string().nullable().optional(),
      nickname: z.string().trim().min(1).max(30),
      favoriteDate: z.string().optional(), // YYYY-MM-DD
      ageGroup: visitorAgeGroupSchema.optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { userId, wristbandId, nickname, favoriteDate, ageGroup } = c.req.valid("json");

    const users = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (users.length === 0) {
      apiError("NOT_FOUND", "ユーザーが見つかりません");
    }
    const u = users[0]!;

    // 日付は保存前に形式検証する (マイページのセルフ編集からも入ってくるため)。
    if (favoriteDate && !/^\d{4}-\d{2}-\d{2}$/.test(favoriteDate)) {
      apiError("BAD_REQUEST", "日付は YYYY-MM-DD 形式で入力してください");
    }

    // 2026-10-20: 年代未登録のプロフィールは年代区分を必須にし、誕生日と実年齢は保持しない。
    if (!u.ageGroup && ageGroup === undefined) {
      apiError("BAD_REQUEST", "年代を選択してください");
    }

    // 2026-07-15: 2026-07-06 の write-once (登録後は変更不可) を緩和し、来場者が自分の
    // ニックネーム/お好きな日付を後から編集できるようにする (プロダクト要件)。
    // ベアラーモデル(userId 保持者=本人)は来場者アプリ全体の信頼境界なので、編集もこれに委ねる
    // — userId は QR/localStorage に入る実質トークンであり、所持=本人とみなすのは lookup 等と同じ。
    // ただし onboardedAt(入場確定時刻)は初回のみ設定し以降は動かさない。これにより
    //   (a) オンボーディングゲートが再編集で再発火しない、(b) 入場日時がぶれない、を保つ。
    const activeBands = await getFamilyWristbands(db, userId);
    const profileBand = wristbandId
      ? activeBands.find((band) => band.id === wristbandId)
      : activeBands.length === 1 ? activeBands[0] : undefined;
    if (wristbandId && !profileBand) {
      apiError("BAD_REQUEST", "このアカウントの有効なリストバンドを指定してください");
    }

    await db
      .update(eventUser)
      .set({
        nickname,
        favoriteDate: favoriteDate || null,
        ...(ageGroup !== undefined ? { ageGroup } : {}),
        onboardedAt: u.onboardedAt ?? new Date(),
      })
      .where(eq(eventUser.id, userId));

    if (profileBand) {
      await db.update(wristband).set({
        nickname,
        ...(ageGroup !== undefined ? { ageGroup } : {}),
        onboardedAt: new Date(),
      }).where(eq(wristband.id, profileBand.id));
    }

    const updated = (await db.select().from(eventUser).where(eq(eventUser.id, userId)))[0]!;
    return c.json({
      id: updated.id,
      eventId: updated.eventId,
      displayId: updated.displayId,
      nickname: updated.nickname,
      favoriteDate: updated.favoriteDate,
      ageGroup: updated.ageGroup,
      allergies: updated.allergies,
      onboardedAt: updated.onboardedAt,
    });
  }
);

// 入場ウィザードの家族アレルギー登録 (2026-10-15, #124)。空配列は「なし」の確定値として保存する。
wristbandRoutes.post(
  "/allergies",
  zBody(z.object({
    userId: z.string().min(1),
    allergies: allergyListSchema,
  })),
  async (c) => {
    const db = c.get("db");
    const { userId, allergies } = c.req.valid("json");
    const [user] = await db.select().from(eventUser).where(eq(eventUser.id, userId));
    if (!user) apiError("NOT_FOUND", "ユーザーが見つかりません");
    if (!user.onboardedAt || user.status !== "available") {
      apiError("CONFLICT", "入場登録後に家族のアレルギーを登録できます");
    }

    await db.update(eventUser)
      .set({ allergies: JSON.stringify(allergies) })
      .where(eq(eventUser.id, userId));
    return c.json({ success: true, allergies });
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
    const [targetEvent] = await db.select().from(event).where(eq(event.id, users[0]!.eventId));
    if (!targetEvent || targetEvent.deletedAt || !["upcoming", "live"].includes(targetEvent.lifecycleStatus)) {
      apiError("BAD_REQUEST", "開催前または開催中のイベントでのみ発行できます");
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
    const targetEvent = events[0]!;
    if (targetEvent.deletedAt || !["upcoming", "live"].includes(targetEvent.lifecycleStatus)) {
      apiError("BAD_REQUEST", "終了したイベントでは発行できません");
    }
    if (targetEvent.billingStatus === "suspended") {
      apiError("FORBIDDEN", "停止中のイベントでは発行できません");
    }
    // 2026-10-17: 物理・デジタルとも開催前または開催中に限定し、セルフ発行はイベント設定で制御する。
    if (!wristbandId && targetEvent.allowSelfIssue !== true) {
      apiError("FORBIDDEN", "このイベントでは来場者によるセルフ発行を受け付けていません");
    }
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
    const displayId = await allocateDisplayIds(db, eventId, 1);
    const newUser = {
      id: userId,
      eventId,
      displayId,
      status: "available",
    };
    const assignedId = wristbandId ?? `sp_${userId}`;
    const assignedStatus = wristbandId ? "active" : "smartphone";
    // 2026-10-17: 来場者とバンドの片方だけが残る発行事故を避けるため、D1 batchで同時確定する。
    await db.batch([
      db.insert(eventUser).values(newUser),
      db.insert(wristband).values({ id: assignedId, userId, status: assignedStatus, assignedAt: new Date() }),
    ]);

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
  const [targetEvent] = await db.select().from(event).where(eq(event.id, batch.eventId));
  if (!targetEvent || targetEvent.deletedAt || !["upcoming", "live"].includes(targetEvent.lifecycleStatus)) {
    apiError("BAD_REQUEST", "開催前または開催中のイベントでのみ発行できます");
  }

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

  const firstDisplayId = await allocateDisplayIds(db, batch.eventId, ids.length);
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
    if (events[0]!.deletedAt || !["upcoming", "live"].includes(events[0]!.lifecycleStatus)) {
      apiError("BAD_REQUEST", "開催前または開催中のイベントでのみ発行できます");
    }

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

    const startDisplayId = await allocateDisplayIds(db, eventId, wristbandIds.length);
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

    // 2026-10-17: CSV取込でも来場者と物理バンドを同じD1 batchで確定する。
    await db.batch([
      db.insert(eventUser).values(userRows),
      db.insert(wristband).values(bandRows),
    ]);
    return c.json({ imported: wristbandIds.length, firstDisplayId: startDisplayId });
  }
);

export default wristbandRoutes;

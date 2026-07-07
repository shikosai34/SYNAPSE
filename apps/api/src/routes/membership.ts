import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { db, membership, inviteToken, circle, event, getEnv, notification } from "@fesflow/db";
import { eq, and, inArray, gt, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Context } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/auth";

// 2026-07-07 (Phase 3a): 独自 PIN 認証 (authenticate-pin) を廃止したのに伴い、
// このルーター配下の全エンドポイントが better-auth セッション必須になったため、
// requireAuth middleware で一括ガードする (下記 membershipRoutes.use("*", requireAuth))。
// 各ハンドラ内で個別に auth.api.getSession を呼んでいた定型コードはこれで不要になる。
const membershipRoutes = new Hono<{ Variables: AuthVariables }>();
membershipRoutes.use("*", requireAuth);

// ロール定義 (SaaS対応 - 2026-07-04)
const ROLES = [
  "super_admin",
  "event_manager",
  "circle_manager",
  "circle_staff",
] as const;

type Role = (typeof ROLES)[number];

// ロールの権限マッピング (SaaS簡素化)
const ROLE_PERMISSIONS: Record<Role, string[]> = {
  super_admin: ["*"], // 全権限
  event_manager: [
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
  circle_manager: [
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
  circle_staff: [
    "circle:read",
    "menu:read",
    "order:read",
    "order:write",
    "stock:read",
    "stock:write",
    "staff:read",
  ],
};

// 権限チェック関数
function hasPermission(role: Role, permission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.includes("*") || permissions.includes(permission);
}

// 管理者権限チェック（権限の序列チェック - 2026-07-04 SaaS対応）
// 2026-07-07 (Phase 3a): membershipRoutes.use("*", requireAuth) により、この関数が
// 呼ばれる時点でセッションは既に確立済みなので c.get("session") から取得する
// (auth.api.getSession の再呼び出しをやめる)。
async function checkMemberWritePermission(
  c: Context<{ Variables: AuthVariables }>,
  targetCircleId: string | null,
  targetCurrentRole: string,
  targetNewRole?: string,
  targetEventId?: string | null
) {
  const session = c.get("session");
  const email = session.user.email.toLowerCase();
  const initialAdminEmail = getEnv().INITIAL_SUPER_ADMIN_EMAIL;

  // 1. super_admin / system_manager (システムレベルの管理者) は何でも可能
  // 2026-07-06 (C1): initialAdminEmail 一致だけでの system admin 昇格は、
  // メール未検証でも成立してしまう抜け道だった。session.user.emailVerified === true
  // の場合に限定する（未検証なら下の通常の super_admin メンバーシップ判定に委ねる）。
  const emailVerified =
    (session.user as { emailVerified?: boolean }).emailVerified === true;
  let isSystemAdmin = false;
  if (initialAdminEmail && email === initialAdminEmail.toLowerCase() && emailVerified) {
    isSystemAdmin = true;
  } else {
    const systemMembers = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, email),
          eq(membership.isActive, true)
        )
      );
    if (systemMembers.some((m) => m.role === "super_admin")) {
      isSystemAdmin = true;
    }
  }

  if (isSystemAdmin) return null;

  // 2. システムロールの操作はシステム管理者のみ可能
  const isSystemRole = (role: string) => role === "super_admin";
  if (isSystemRole(targetCurrentRole) || (targetNewRole && isSystemRole(targetNewRole))) {
    return { code: "FORBIDDEN" as const, error: "システム管理者権限を操作する権限がありません", status: 403 as const };
  }

  // 3. イベントレベル (event_manager) の操作は、そのイベントの event_manager のみ可能
  const isEventRole = (role: string) => role === "event_manager";
  if (!targetCircleId || isEventRole(targetCurrentRole) || (targetNewRole && isEventRole(targetNewRole))) {
    let checkEventId = targetEventId;
    if (!checkEventId && targetCircleId) {
      const circles = await db.select().from(circle).where(eq(circle.id, targetCircleId));
      checkEventId = circles[0]?.eventId;
    }
    if (!checkEventId) {
      return { code: "FORBIDDEN" as const, error: "イベントレベルのメンバーを操作する権限がありません", status: 403 as const };
    }
    const eventManagerMemberships = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, email),
          eq(membership.eventId, checkEventId),
          eq(membership.role, "event_manager"),
          eq(membership.isActive, true)
        )
      );
    if (eventManagerMemberships.length === 0) {
      return { code: "FORBIDDEN" as const, error: "このイベントのメンバーを管理する権限がありません", status: 403 as const };
    }
    return null;
  }

  // 4. サークルレベルの操作 (circle_manager / circle_staff) の確認
  const circles = await db.select().from(circle).where(eq(circle.id, targetCircleId));
  if (circles.length === 0) {
    return { code: "NOT_FOUND" as const, error: "対象のサークルが存在しません", status: 404 as const };
  }
  const eventId = circles[0]!.eventId;

  // イベントマネージャーであればサークルのメンバーも操作可能
  const eventManagerMemberships = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.userEmail, email),
        eq(membership.eventId, eventId),
        eq(membership.role, "event_manager"),
        eq(membership.isActive, true)
      )
    );
  if (eventManagerMemberships.length > 0) {
    return null;
  }

  // サークルマネージャーか確認
  const managerMemberships = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.userEmail, email),
        eq(membership.circleId, targetCircleId),
        eq(membership.role, "circle_manager"),
        eq(membership.isActive, true)
      )
    );

  if (managerMemberships.length === 0) {
    return { code: "FORBIDDEN" as const, error: "このサークルのメンバーを管理する権限がありません", status: 403 as const };
  }

  // サークルマネージャーは一般スタッフ (circle_staff) のみ管理可能
  if (targetCurrentRole === "circle_manager" || targetNewRole === "circle_manager") {
    return { code: "FORBIDDEN" as const, error: "サークルマネージャー権限を操作する権限がありません", status: 403 as const };
  }

  return null;
}

// ロール一覧取得
membershipRoutes.get("/roles", (c) => {
  return c.json(
    ROLES.map((role) => ({
      role,
      permissions: ROLE_PERMISSIONS[role],
    }))
  );
});

// 自分のメンバーシップ一覧取得
// 2026-07-05: 無認証で任意の userEmail の所属一覧(PIN含む)を閲覧でき、かつ
// INITIAL_SUPER_ADMIN_EMAIL 一致時に super_admin を自動生成する副作用があった。
// セッション必須化し、対象は必ずセッション本人のメールに固定する。
// super_admin 自動生成は getAdminSession 側で既にセッション必須で行われているため、
// ここでの自動生成ロジックは完全に削除する。
membershipRoutes.get("/my", async (c) => {
  const session = c.get("session");
  const userEmail = session.user.email;

  const initialAdminEmail = getEnv().INITIAL_SUPER_ADMIN_EMAIL;
  if (initialAdminEmail && userEmail.toLowerCase() === initialAdminEmail.toLowerCase()) {
    const existing = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, userEmail.toLowerCase()),
          eq(membership.role, "super_admin"),
          eq(membership.isActive, true)
        )
      );
    if (existing.length === 0) {
      await db.insert(membership).values({
        id: nanoid(),
        userEmail: userEmail.toLowerCase(),
        userName: session.user.name || "Super Admin",
        role: "super_admin",
        isActive: true,
      });
    }
  }

  const memberships = await db
    .select()
    .from(membership)
    .where(
      and(eq(membership.userEmail, userEmail.toLowerCase()), eq(membership.isActive, true))
    );

  // サークルとイベント情報を取得
  const circleIds = memberships
    .map((m) => m.circleId)
    .filter(Boolean) as string[];
  const eventIds = memberships
    .map((m) => m.eventId)
    .filter(Boolean) as string[];

  // 論理削除済み(deletedAt != null)のサークル/イベントは取得対象から除外する
  const circles =
    circleIds.length > 0
      ? await db
          .select()
          .from(circle)
          .where(and(inArray(circle.id, circleIds), isNull(circle.deletedAt)))
      : [];

  const events =
    eventIds.length > 0
      ? await db
          .select()
          .from(event)
          .where(and(inArray(event.id, eventIds), isNull(event.deletedAt)))
      : [];

  const result = memberships
    // 参照先が論理削除済みのメンバーシップはスペース一覧に出さない
    // (circleId を持つなら生存サークル必須、eventId のみなら生存イベント必須)
    .filter((m) => {
      if (m.circleId) return circles.some((c) => c.id === m.circleId);
      if (m.eventId) return events.some((e) => e.id === m.eventId);
      return true; // super_admin 等 (circle/event 紐付けなし) は常に残す
    })
    .map((m) => ({
      ...m,
      circle: circles.find((c) => c.id === m.circleId),
      event: events.find((e) => e.id === m.eventId),
    }));

  return c.json(result);
});

// サークルのメンバー一覧取得
// 2026-07-05: 無認証で全カラム(メール含む)を返していた脆弱性を修正。
// セッション必須化し、対象サークルのメンバー閲覧権限(member:read)を要求する。
// 2026-07-07 (Phase 3a): membership.pin カラム自体を廃止したため、pin 除外の
// サニタイズ処理は不要になった (返却カラムに元々含まれない)。
membershipRoutes.get("/circle/:circleId", async (c) => {
  const circleId = c.req.param("circleId");

  const circles = await db.select().from(circle).where(eq(circle.id, circleId));
  if (circles.length === 0) {
    apiError("NOT_FOUND", "サークルが見つかりません");
  }

  const err = await checkMemberWritePermission(c, circleId, "viewer", undefined, circles[0]!.eventId);
  if (err) apiError(err.code, err.error, { status: err.status });

  const memberships = await db
    .select()
    .from(membership)
    .where(eq(membership.circleId, circleId));

  return c.json(memberships);
});

// イベントのメンバー一覧取得
// 2026-07-05: 無認証で全カラム(メール含む)を返していた脆弱性を修正。
// セッション必須化し、対象イベントのメンバー閲覧権限(member:read)を要求する。
// 2026-07-07 (Phase 3a): membership.pin カラム自体を廃止したため、pin 除外の
// サニタイズ処理は不要になった。
membershipRoutes.get("/event/:eventId", async (c) => {
  const eventId = c.req.param("eventId");

  const err = await checkMemberWritePermission(c, null, "viewer", undefined, eventId);
  if (err) apiError(err.code, err.error, { status: err.status });

  const memberships = await db
    .select()
    .from(membership)
    .where(eq(membership.eventId, eventId));

  return c.json(memberships);
});

// 権限チェック
// 2026-07-06 (H2): 無認可で任意の userEmail × circleId/eventId の権限を問い合わせでき、
// メンバー構成の列挙に使えた。セッション必須化し、問い合わせ対象は本人のメールのみ許可する
// (register/visitor フロントの呼び出し元を確認したところ、現状このエンドポイントの
// 呼び出し自体が存在せず、他人のメールを渡す用途もないため「本人チェックのみ許可」で十分)。
membershipRoutes.post(
  "/check-permission",
  zBody(
    z.object({
      userEmail: z.string(),
      circleId: z.string().optional(),
      eventId: z.string().optional(),
      permission: z.string(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

    const session = c.get("session");
    if (session.user.email.toLowerCase() !== input.userEmail.toLowerCase()) {
      apiError("FORBIDDEN", "他のユーザーの権限は照会できません");
    }

    // メンバーシップを検索
    let membershipQuery;
    if (input.circleId) {
      membershipQuery = db
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.userEmail, input.userEmail),
            eq(membership.circleId, input.circleId),
            eq(membership.isActive, true)
          )
        );
    } else if (input.eventId) {
      membershipQuery = db
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.userEmail, input.userEmail),
            eq(membership.eventId, input.eventId),
            eq(membership.isActive, true)
          )
        );
    } else {
      apiError("BAD_REQUEST", "circleIdまたはeventIdが必要です");
    }

    const memberships = await membershipQuery;

    if (memberships.length === 0) {
      return c.json({ hasPermission: false });
    }

    const userMembership = memberships[0]!;
    const has = hasPermission(userMembership.role as Role, input.permission);

    return c.json({ hasPermission: has, role: userMembership.role });
  }
);

// メンバー追加
// 2026-07-07 (Phase 3a): 独自 PIN 認証の廃止に伴い pin フィールドを撤去。
// メンバーはこの後 better-auth アカウントでログインする前提になる。
membershipRoutes.post(
  "/",
  zBody(
    z.object({
      userEmail: z.string(),
      userName: z.string(),
      circleId: z.string().optional(),
      eventId: z.string().optional(),
      role: z.enum(ROLES),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");
    const id = nanoid();

    const err = await checkMemberWritePermission(c, input.circleId || null, "viewer", input.role, input.eventId);
    if (err) apiError(err.code, err.error, { status: err.status });

    await db.insert(membership).values({
      id,
      userEmail: input.userEmail.toLowerCase(),
      userName: input.userName,
      circleId: input.circleId,
      eventId: input.eventId,
      role: input.role,
      isActive: true,
    });

    return c.json({ id }, 201);
  }
);

// ロール更新
membershipRoutes.patch(
  "/:id/role",
  zBody(
    z.object({
      role: z.enum(ROLES),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const targets = await db.select().from(membership).where(eq(membership.id, id));
    if (targets.length === 0) apiError("NOT_FOUND", "メンバーが見つかりません");
    
    const target = targets[0]!;
    const err = await checkMemberWritePermission(c, target.circleId, target.role, input.role, target.eventId);
    if (err) apiError(err.code, err.error, { status: err.status });

    await db
      .update(membership)
      .set({ role: input.role })
      .where(eq(membership.id, id));

    return c.json({ success: true });
  }
);

// メンバー無効化
membershipRoutes.patch("/:id/deactivate", async (c) => {
  const id = c.req.param("id");

  const targets = await db.select().from(membership).where(eq(membership.id, id));
  if (targets.length === 0) apiError("NOT_FOUND", "メンバーが見つかりません");
  
  const target = targets[0]!;
  const err = await checkMemberWritePermission(c, target.circleId, target.role, undefined, target.eventId);
  if (err) apiError(err.code, err.error, { status: err.status });

  await db
    .update(membership)
    .set({ isActive: false })
    .where(eq(membership.id, id));

  return c.json({ success: true });
});

// メンバー削除
membershipRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const targets = await db.select().from(membership).where(eq(membership.id, id));
  if (targets.length === 0) apiError("NOT_FOUND", "メンバーが見つかりません");
  
  const target = targets[0]!;
  const err = await checkMemberWritePermission(c, target.circleId, target.role, undefined, target.eventId);
  if (err) apiError(err.code, err.error, { status: err.status });

  await db.delete(membership).where(eq(membership.id, id));

  return c.json({ success: true });
});

// 招待トークン作成
membershipRoutes.post(
  "/invite",
  zBody(
    z.object({
      circleId: z.string().optional(),
      eventId: z.string().optional(),
      role: z.enum(ROLES),
      expiresInHours: z.number().min(1).max(168).default(24), // 1時間〜7日
      maxUses: z.number().min(1).max(100).optional(),
      createdBy: z.string(), // 作成者のメールアドレス
      targetEmail: z.string().optional(), // 招待相手のメールアドレス
    })
  ),
  async (c) => {
    const input = c.req.valid("json");
    const id = nanoid();
    const token = nanoid(32);

    const err = await checkMemberWritePermission(c, input.circleId || null, "viewer", input.role, input.eventId);
    if (err) apiError(err.code, err.error, { status: err.status });

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + input.expiresInHours);

    // トークン作成
    await db.insert(inviteToken).values({
      id,
      token,
      circleId: input.circleId,
      eventId: input.eventId,
      role: input.role,
      expiresAt,
      maxUses: input.maxUses,
      usedCount: 0,
      createdBy: input.createdBy,
      targetEmail: input.targetEmail ? input.targetEmail.toLowerCase() : null,
    });

    // 宛先メールアドレス（targetEmail）があれば通知を作成
    if (input.targetEmail) {
      let circleName: string | null = null;
      let eventName: string | null = null;

      if (input.circleId) {
        const circles = await db.select().from(circle).where(eq(circle.id, input.circleId));
        if (circles.length > 0) circleName = circles[0]!.name;
      }
      if (input.eventId) {
        const events = await db.select().from(event).where(eq(event.id, input.eventId));
        if (events.length > 0) eventName = events[0]!.eventName;
      }

      const spaceName = circleName || eventName || "新しいスペース";
      const displayRole = input.role === "circle_manager" ? "管理者" : input.role === "circle_staff" ? "スタッフ" : input.role === "event_manager" ? "イベントマネージャー" : "メンバー";

      await db.insert(notification).values({
        id: nanoid(),
        userEmail: input.targetEmail.toLowerCase(),
        title: `${spaceName} からの招待`,
        message: `${spaceName} から ${displayRole} として招待されました。`,
        type: "invite",
        status: "unread",
        circleName,
        eventName,
        token,
        role: input.role,
        createdAt: new Date(),
      });
    }

    return c.json({ token, expiresAt }, 201);
  }
);

// 招待を受け入れ
// 2026-07-05: (1) セッション不要で任意の userEmail としてメンバーシップを
//   作成できた（なりすまし/権限昇格チェーン）ため、セッション必須化し、
//   メンバーシップの userEmail は必ずセッションのメールを使う。
//   targetEmail 指定付きトークンは、そのメールのセッションでしか使えないようにする。
// (2) usedCount 更新が「読んで+1して書く」楽観更新でガードが無く、
//   同時アクセスで maxUses を超過しうる(TOCTOU)ため、メンバーシップ作成前に
//   `WHERE used_count < max_uses` 付き条件UPDATEを行い、更新0件なら中断する。
membershipRoutes.post(
  "/invite/accept",
  zBody(
    z.object({
      token: z.string(),
      userName: z.string(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

    const session = c.get("session");
    const userEmail = session.user.email.toLowerCase();

    // トークンを検索
    const tokens = await db
      .select()
      .from(inviteToken)
      .where(
        and(
          eq(inviteToken.token, input.token),
          gt(inviteToken.expiresAt, new Date())
        )
      );

    if (tokens.length === 0) {
      apiError("BAD_REQUEST", "無効または期限切れの招待トークンです");
    }

    const foundToken = tokens[0]!;

    // targetEmail が指定されたトークンは、そのメール宛のセッションでしか使えない
    if (foundToken.targetEmail && foundToken.targetEmail.toLowerCase() !== userEmail) {
      apiError("FORBIDDEN", "この招待は別のメールアドレス宛です");
    }

    // 使用回数チェック（事前チェック。確定は下の条件付きUPDATEで行う）
    if (
      foundToken.maxUses !== null &&
      foundToken.usedCount >= foundToken.maxUses
    ) {
      apiError("BAD_REQUEST", "招待トークンの使用回数上限に達しました");
    }

    // 既存のメンバーシップをチェック
    const existingMembership = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, userEmail),
          foundToken.circleId
            ? eq(membership.circleId, foundToken.circleId)
            : foundToken.eventId
            ? eq(membership.eventId, foundToken.eventId)
            : undefined
        )
      );

    if (existingMembership.length > 0) {
      apiError("BAD_REQUEST", "既にメンバーとして登録されています");
    }

    // トークンの使用回数を条件付きで更新する（TOCTOU対策）。
    // D1 は対話的トランザクション(BEGIN)非対応のため、
    // `used_count < max_uses` (または上限なし) を満たす場合のみ更新されるようにし、
    // 更新0件なら他リクエストと競合して上限に達したとみなし中断する。
    const updateResult = await db
      .update(inviteToken)
      .set({ usedCount: foundToken.usedCount + 1 })
      .where(
        and(
          eq(inviteToken.id, foundToken.id),
          foundToken.maxUses !== null
            ? lt(inviteToken.usedCount, foundToken.maxUses)
            : undefined
        )
      );

    const changes = (updateResult as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 0;
    if (changes === 0) {
      apiError("BAD_REQUEST", "招待トークンの使用回数上限に達しました");
    }

    // メンバーシップを作成
    // 2026-07-07 (Phase 3a): 独自 PIN 認証の廃止に伴い pin 保存を撤去。
    const membershipId = nanoid();
    await db.insert(membership).values({
      id: membershipId,
      userEmail,
      userName: input.userName,
      circleId: foundToken.circleId,
      eventId: foundToken.eventId,
      role: foundToken.role,
      isActive: true,
    });

    return c.json({ membershipId }, 201);
  }
);

// 招待トークン一覧取得
// 2026-07-05: 無認可で生トークン(token)を含む一覧を誰でも取得できた
// （権限昇格チェーンの起点になりうる）ため、メンバー管理権限を要求し、
// レスポンスから生の token を除外する。
membershipRoutes.get("/invite/list", async (c) => {
  const circleId = c.req.query("circleId");
  const eventId = c.req.query("eventId");

  let query;
  if (circleId) {
    const err = await checkMemberWritePermission(c, circleId, "viewer", undefined, eventId || undefined);
    if (err) apiError(err.code, err.error, { status: err.status });
    query = db
      .select()
      .from(inviteToken)
      .where(eq(inviteToken.circleId, circleId));
  } else if (eventId) {
    const err = await checkMemberWritePermission(c, null, "viewer", undefined, eventId);
    if (err) apiError(err.code, err.error, { status: err.status });
    query = db
      .select()
      .from(inviteToken)
      .where(eq(inviteToken.eventId, eventId));
  } else {
    apiError("BAD_REQUEST", "circleIdまたはeventIdが必要です");
  }

  const tokens = await query;

  // 期限切れのトークンを除外
  const activeTokens = tokens.filter((t) => new Date(t.expiresAt) > new Date());

  // 生トークンの値をレスポンスから除外し、一覧に必要な項目のみ返す
  const sanitized = activeTokens.map((t) => ({
    id: t.id,
    circleId: t.circleId,
    eventId: t.eventId,
    role: t.role,
    expiresAt: t.expiresAt,
    usedCount: t.usedCount,
    maxUses: t.maxUses,
    targetEmail: t.targetEmail,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
  }));

  return c.json(sanitized);
});

// 招待トークン削除
membershipRoutes.delete("/invite/:id", async (c) => {
  const id = c.req.param("id");

  const tokens = await db.select().from(inviteToken).where(eq(inviteToken.id, id));
  if (tokens.length === 0) apiError("NOT_FOUND", "トークンが見つかりません");

  const targetToken = tokens[0]!;
  const err = await checkMemberWritePermission(c, targetToken.circleId, "viewer", undefined, targetToken.eventId);
  if (err) apiError(err.code, err.error, { status: err.status });

  await db.delete(inviteToken).where(eq(inviteToken.id, id));

  return c.json({ success: true });
});

// 2026-07-07 (Phase 3a): 独自 PIN 認証 (POST /authenticate-pin) と PIN 更新
// (PATCH /:id/pin) ルートを廃止。認証は better-auth (メール/パスワード + passkey +
// Google) に一本化する。並行して存在していた PIN ベースの簡易ログイン導線は撤去済み
// (フロント側の呼び出し・PINフォームは Phase 3b で対応する)。

// 通知一覧取得 (2026-07-04 SaaS通知対応)
membershipRoutes.get("/notifications/list", async (c) => {
  const session = c.get("session");
  const email = session.user.email.toLowerCase();

  const list = await db
    .select()
    .from(notification)
    .where(and(eq(notification.userEmail, email), eq(notification.status, "unread")));

  // JS側で作成日時順に降順ソート
  list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return c.json(list);
});

// 通知を既読にする
membershipRoutes.post("/notifications/:id/read", async (c) => {
  const id = c.req.param("id");
  const session = c.get("session");

  await db
    .update(notification)
    .set({ status: "read" })
    .where(and(eq(notification.id, id), eq(notification.userEmail, session.user.email.toLowerCase())));

  return c.json({ success: true });
});

// 招待に対する回答 (承認 / 拒否)
membershipRoutes.post(
  "/notifications/:id/respond",
  zBody(
    z.object({
      action: z.enum(["accept", "decline"]),
      userName: z.string().optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const session = c.get("session");
    const email = session.user.email.toLowerCase();

    // 通知を検索
    const notifications = await db
      .select()
      .from(notification)
      .where(and(eq(notification.id, id), eq(notification.userEmail, email)));

    if (notifications.length === 0) {
      apiError("NOT_FOUND", "通知が見つかりません");
    }

    const notif = notifications[0]!;

    if (input.action === "accept") {
      if (!notif.token) {
        apiError("BAD_REQUEST", "無効な招待です");
      }

      // トークンを検索
      const tokens = await db
        .select()
        .from(inviteToken)
        .where(
          and(
            eq(inviteToken.token, notif.token),
            gt(inviteToken.expiresAt, new Date())
          )
        );

      if (tokens.length === 0) {
        apiError("BAD_REQUEST", "無効または期限切れの招待トークンです");
      }

      const foundToken = tokens[0]!;

      // 2026-07-05: targetEmail 指定付きトークンは、そのメール宛のセッションでしか使えない
      if (foundToken.targetEmail && foundToken.targetEmail.toLowerCase() !== email) {
        apiError("FORBIDDEN", "この招待は別のメールアドレス宛です");
      }

      // 使用上限チェック（事前チェック。確定は下の条件付きUPDATEで行う）
      if (foundToken.maxUses !== null && foundToken.usedCount >= foundToken.maxUses) {
        apiError("BAD_REQUEST", "招待の上限に達しています");
      }

      // 既存のメンバーシップがあるかチェック
      const existing = await db
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.userEmail, email),
            foundToken.circleId ? eq(membership.circleId, foundToken.circleId) : undefined,
            foundToken.eventId ? eq(membership.eventId, foundToken.eventId) : undefined
          )
        );

      if (existing.length > 0) {
        apiError("BAD_REQUEST", "既にメンバーとして登録されています");
      }

      // 2026-07-05: トークンの使用回数を条件付きで更新する（TOCTOU対策）。
      // D1 は対話的トランザクション非対応のため、`used_count < max_uses` を
      // 満たす場合のみ更新されるようにし、更新0件なら他リクエストと競合して
      // 上限に達したとみなし中断する。メンバーシップ作成より前に確定させる。
      const updateResult = await db
        .update(inviteToken)
        .set({ usedCount: foundToken.usedCount + 1 })
        .where(
          and(
            eq(inviteToken.id, foundToken.id),
            foundToken.maxUses !== null
              ? lt(inviteToken.usedCount, foundToken.maxUses)
              : undefined
          )
        );

      const changes = (updateResult as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 0;
      if (changes === 0) {
        apiError("BAD_REQUEST", "招待の上限に達しています");
      }

      // メンバーシップ作成
      // 2026-07-07 (Phase 3a): 独自 PIN 認証の廃止に伴い pin 保存を撤去。
      await db.insert(membership).values({
        id: nanoid(),
        userEmail: email,
        userName: input.userName || session.user.name || "メンバー",
        circleId: foundToken.circleId,
        eventId: foundToken.eventId,
        role: foundToken.role,
        isActive: true,
      });

      // (使用回数は上でメンバーシップ作成前に確定更新済みのため、ここでは何もしない)
    }

    // 通知を既読（回答済）にする
    await db
      .update(notification)
      .set({ status: "read" })
      .where(eq(notification.id, id));

    return c.json({ success: true });
  }
);

export default membershipRoutes;

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db, membership, inviteToken, circle, event, user, getEnv } from "@fesflow/db";
import { eq, and, inArray, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { auth } from "@fesflow/auth";
import { Context } from "hono";

const membershipRoutes = new Hono();

// ロール定義 (SaaS対応 - 2026-07-04)
const ROLES = [
  "super_admin",
  "system_manager",
  "system_staff",
  "event_manager",
  "event_staff",
  "circle_manager",
  "circle_staff",
] as const;

type Role = (typeof ROLES)[number];

// ロールの権限マッピング
const ROLE_PERMISSIONS: Record<Role, string[]> = {
  super_admin: ["*"], // 全権限
  system_manager: [
    "system:read",
    "system:write",
    "event:read",
    "event:write",
    "circle:read",
    "circle:write",
    "menu:read",
    "order:read",
    "sales:read",
  ],
  system_staff: [
    "system:read",
    "event:read",
    "circle:read",
  ],
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
  event_staff: [
    "event:read",
    "circle:read",
    "order:read",
    "member:read",
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
async function checkMemberWritePermission(
  c: Context,
  targetCircleId: string | null,
  targetCurrentRole: string,
  targetNewRole?: string,
  targetEventId?: string | null
) {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session || !session.user) {
    return { error: "認証されていません", status: 401 as const };
  }

  const email = session.user.email.toLowerCase();
  const initialAdminEmail = getEnv().INITIAL_SUPER_ADMIN_EMAIL;

  // 1. super_admin / system_manager (システムレベルの管理者) は何でも可能
  let isSystemAdmin = false;
  if (initialAdminEmail && email === initialAdminEmail.toLowerCase()) {
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
    if (systemMembers.some((m) => m.role === "super_admin" || m.role === "system_manager")) {
      isSystemAdmin = true;
    }
  }

  if (isSystemAdmin) return null;

  // 2. システムロールの操作はシステム管理者のみ可能
  const isSystemRole = (role: string) => ["super_admin", "system_manager", "system_staff"].includes(role);
  if (isSystemRole(targetCurrentRole) || (targetNewRole && isSystemRole(targetNewRole))) {
    return { error: "システム管理者権限を操作する権限がありません", status: 403 as const };
  }

  // 3. イベントレベル (event_manager / event_staff) の操作は、そのイベントの event_manager のみ可能
  const isEventRole = (role: string) => ["event_manager", "event_staff"].includes(role);
  if (!targetCircleId || isEventRole(targetCurrentRole) || (targetNewRole && isEventRole(targetNewRole))) {
    let checkEventId = targetEventId;
    if (!checkEventId && targetCircleId) {
      const circles = await db.select().from(circle).where(eq(circle.id, targetCircleId));
      checkEventId = circles[0]?.eventId;
    }
    if (!checkEventId) {
      return { error: "イベントレベルのメンバーを操作する権限がありません", status: 403 as const };
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
      return { error: "このイベントのメンバーを管理する権限がありません", status: 403 as const };
    }
    return null;
  }

  // 4. サークルレベルの操作 (circle_manager / circle_staff) の確認
  const circles = await db.select().from(circle).where(eq(circle.id, targetCircleId));
  if (circles.length === 0) {
    return { error: "対象のサークルが存在しません", status: 404 as const };
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
    return { error: "このサークルのメンバーを管理する権限がありません", status: 403 as const };
  }

  // サークルマネージャーは一般スタッフ (circle_staff) のみ管理可能
  if (targetCurrentRole === "circle_manager" || targetNewRole === "circle_manager") {
    return { error: "サークルマネージャー権限を操作する権限がありません", status: 403 as const };
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
membershipRoutes.get("/my", async (c) => {
  const userEmail = c.req.query("userEmail");

  if (!userEmail) {
    return c.json({ error: "userEmailが必要です" }, 400);
  }

  const initialAdminEmail = getEnv().INITIAL_SUPER_ADMIN_EMAIL;
  if (initialAdminEmail && userEmail.toLowerCase() === initialAdminEmail.toLowerCase()) {
    const existingAdmin = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, userEmail.toLowerCase()),
          eq(membership.role, "super_admin"),
          eq(membership.isActive, true)
        )
      );

    if (existingAdmin.length === 0) {
      await db.insert(membership).values({
        id: nanoid(),
        userEmail: userEmail.toLowerCase(),
        userName: "Super Admin",
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

  const circles =
    circleIds.length > 0
      ? await db.select().from(circle).where(inArray(circle.id, circleIds))
      : [];

  const events =
    eventIds.length > 0
      ? await db.select().from(event).where(inArray(event.id, eventIds))
      : [];

  const result = memberships.map((m) => ({
    ...m,
    circle: circles.find((c) => c.id === m.circleId),
    event: events.find((e) => e.id === m.eventId),
  }));

  return c.json(result);
});

// サークルのメンバー一覧取得
membershipRoutes.get("/circle/:circleId", async (c) => {
  const circleId = c.req.param("circleId");

  const memberships = await db
    .select()
    .from(membership)
    .where(eq(membership.circleId, circleId));

  return c.json(memberships);
});

// イベントのメンバー一覧取得
membershipRoutes.get("/event/:eventId", async (c) => {
  const eventId = c.req.param("eventId");

  const memberships = await db
    .select()
    .from(membership)
    .where(eq(membership.eventId, eventId));

  return c.json(memberships);
});

// 権限チェック
membershipRoutes.post(
  "/check-permission",
  zValidator(
    "json",
    z.object({
      userEmail: z.string(),
      circleId: z.string().optional(),
      eventId: z.string().optional(),
      permission: z.string(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

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
      return c.json({ error: "circleIdまたはeventIdが必要です" }, 400);
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
membershipRoutes.post(
  "/",
  zValidator(
    "json",
    z.object({
      userEmail: z.string(),
      userName: z.string(),
      circleId: z.string().optional(),
      eventId: z.string().optional(),
      role: z.enum(ROLES),
      pin: z.string().optional(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");
    const id = nanoid();

    const err = await checkMemberWritePermission(c, input.circleId || null, "viewer", input.role, input.eventId);
    if (err) return c.json({ error: err.error }, err.status);

    // PINをハッシュ化
    // 2026-07-04: Cloudflare Workers の CPU 時間制限（最大50ms）超過による 500 エラーを避けるため、
    // ストレッチングコスト（ソルトラウンド）を 10 から 4 に引き下げ。
    let pinHash: string | null = null;
    if (input.pin) {
      pinHash = await bcrypt.hash(input.pin, 4);
    }

    await db.insert(membership).values({
      id,
      userEmail: input.userEmail,
      userName: input.userName,
      circleId: input.circleId,
      eventId: input.eventId,
      role: input.role,
      pin: pinHash,
      isActive: true,
    });

    return c.json({ id }, 201);
  }
);

// ロール更新
membershipRoutes.patch(
  "/:id/role",
  zValidator(
    "json",
    z.object({
      role: z.enum(ROLES),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const targets = await db.select().from(membership).where(eq(membership.id, id));
    if (targets.length === 0) return c.json({ error: "メンバーが見つかりません" }, 404);
    
    const target = targets[0]!;
    const err = await checkMemberWritePermission(c, target.circleId, target.role, input.role, target.eventId);
    if (err) return c.json({ error: err.error }, err.status);

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
  if (targets.length === 0) return c.json({ error: "メンバーが見つかりません" }, 404);
  
  const target = targets[0]!;
  const err = await checkMemberWritePermission(c, target.circleId, target.role, undefined, target.eventId);
  if (err) return c.json({ error: err.error }, err.status);

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
  if (targets.length === 0) return c.json({ error: "メンバーが見つかりません" }, 404);
  
  const target = targets[0]!;
  const err = await checkMemberWritePermission(c, target.circleId, target.role, undefined, target.eventId);
  if (err) return c.json({ error: err.error }, err.status);

  await db.delete(membership).where(eq(membership.id, id));

  return c.json({ success: true });
});

// 招待トークン作成
membershipRoutes.post(
  "/invite",
  zValidator(
    "json",
    z.object({
      circleId: z.string().optional(),
      eventId: z.string().optional(),
      role: z.enum(ROLES),
      expiresInHours: z.number().min(1).max(168).default(24), // 1時間〜7日
      maxUses: z.number().min(1).max(100).optional(),
      createdBy: z.string(), // 作成者のメールアドレス
    })
  ),
  async (c) => {
    const input = c.req.valid("json");
    const id = nanoid();
    const token = nanoid(32);

    const err = await checkMemberWritePermission(c, input.circleId || null, "viewer", input.role, input.eventId);
    if (err) return c.json({ error: err.error }, err.status);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + input.expiresInHours);

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
    });

    return c.json({ token, expiresAt }, 201);
  }
);

// 招待を受け入れ
membershipRoutes.post(
  "/invite/accept",
  zValidator(
    "json",
    z.object({
      token: z.string(),
      userEmail: z.string(),
      userName: z.string(),
      pin: z.string().optional(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

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
      return c.json({ error: "無効または期限切れの招待トークンです" }, 400);
    }

    const foundToken = tokens[0]!;

    // 使用回数チェック
    if (
      foundToken.maxUses !== null &&
      foundToken.usedCount >= foundToken.maxUses
    ) {
      return c.json({ error: "招待トークンの使用回数上限に達しました" }, 400);
    }

    // 既存のメンバーシップをチェック
    const existingMembership = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, input.userEmail),
          foundToken.circleId
            ? eq(membership.circleId, foundToken.circleId)
            : foundToken.eventId
            ? eq(membership.eventId, foundToken.eventId)
            : undefined
        )
      );

    if (existingMembership.length > 0) {
      return c.json({ error: "既にメンバーとして登録されています" }, 400);
    }

    // PINをハッシュ化
    // 2026-07-04: Cloudflare Workers の CPU 時間制限超過防止のため、ソルトラウンドを 4 に設定。
    let pinHash: string | null = null;
    if (input.pin) {
      pinHash = await bcrypt.hash(input.pin, 4);
    }

    // メンバーシップを作成
    const membershipId = nanoid();
    await db.insert(membership).values({
      id: membershipId,
      userEmail: input.userEmail,
      userName: input.userName,
      circleId: foundToken.circleId,
      eventId: foundToken.eventId,
      role: foundToken.role,
      pin: pinHash,
      isActive: true,
    });

    // トークンの使用回数を更新
    await db
      .update(inviteToken)
      .set({ usedCount: foundToken.usedCount + 1 })
      .where(eq(inviteToken.id, foundToken.id));

    return c.json({ membershipId }, 201);
  }
);

// 招待トークン一覧取得
membershipRoutes.get("/invite/list", async (c) => {
  const circleId = c.req.query("circleId");
  const eventId = c.req.query("eventId");

  let query;
  if (circleId) {
    query = db
      .select()
      .from(inviteToken)
      .where(eq(inviteToken.circleId, circleId));
  } else if (eventId) {
    query = db
      .select()
      .from(inviteToken)
      .where(eq(inviteToken.eventId, eventId));
  } else {
    return c.json({ error: "circleIdまたはeventIdが必要です" }, 400);
  }

  const tokens = await query;

  // 期限切れのトークンを除外
  const activeTokens = tokens.filter((t) => new Date(t.expiresAt) > new Date());

  return c.json(activeTokens);
});

// 招待トークン削除
membershipRoutes.delete("/invite/:id", async (c) => {
  const id = c.req.param("id");

  const tokens = await db.select().from(inviteToken).where(eq(inviteToken.id, id));
  if (tokens.length === 0) return c.json({ error: "トークンが見つかりません" }, 404);

  const targetToken = tokens[0]!;
  const err = await checkMemberWritePermission(c, targetToken.circleId, "viewer", undefined, targetToken.eventId);
  if (err) return c.json({ error: err.error }, err.status);

  await db.delete(inviteToken).where(eq(inviteToken.id, id));

  return c.json({ success: true });
});

// PIN認証
membershipRoutes.post(
  "/authenticate-pin",
  zValidator(
    "json",
    z.object({
      circleId: z.string().optional(),
      eventId: z.string().optional(),
      email: z.string().email().optional(),
      pin: z.string(),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

    // メンバーシップを検索
    let query;
    if (input.circleId) {
      const conditions = [
        eq(membership.circleId, input.circleId),
        eq(membership.isActive, true)
      ];
      if (input.email) {
        conditions.push(eq(membership.userEmail, input.email.toLowerCase()));
      }
      query = db
        .select()
        .from(membership)
        .where(and(...conditions));
    } else if (input.eventId) {
      const conditions = [
        eq(membership.eventId, input.eventId),
        eq(membership.isActive, true)
      ];
      if (input.email) {
        conditions.push(eq(membership.userEmail, input.email.toLowerCase()));
      }
      query = db
        .select()
        .from(membership)
        .where(and(...conditions));
    } else {
      return c.json({ error: "circleIdまたはeventIdが必要です" }, 400);
    }

    const memberships = await query;

    // PINがnullでないメンバーシップをチェック
    for (const m of memberships) {
      if (m.pin) {
        const isValid = await bcrypt.compare(input.pin, m.pin);
        if (isValid) {
          // 該当メンバーシップの user テーブルのレコードを検索
          const users = await db
            .select()
            .from(user)
            .where(eq(user.email, m.userEmail.toLowerCase()));
          
          const matchedUser = users[0];

          return c.json({
            success: true,
            membership: {
              ...m,
              pin: undefined,
            },
            // user が見つからない場合は、名前とメールの一時オブジェクトを組み立てて返す
            user: matchedUser
              ? {
                  id: matchedUser.id,
                  name: matchedUser.name,
                  email: matchedUser.email,
                }
              : {
                  id: m.id, // 一時的なIDとしてmembership IDを使用
                  name: m.userName,
                  email: m.userEmail,
                },
          });
        }
      }
    }

    return c.json({ error: "PINが正しくありません" }, 401);
  }
);

// PIN更新
membershipRoutes.patch(
  "/:id/pin",
  zValidator(
    "json",
    z.object({
      pin: z.string().min(4, "PINは4文字以上必要です"),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    const targets = await db.select().from(membership).where(eq(membership.id, id));
    if (targets.length === 0) return c.json({ error: "メンバーが見つかりません" }, 404);
    
    const target = targets[0]!;

    // 権限チェック: 自分自身か、管理者（circle_manager or event_admin）のみPINを変更可能
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session || !session.user) {
      return c.json({ error: "認証されていません" }, 401);
    }
    
    const isSelf = session.user.email.toLowerCase() === target.userEmail.toLowerCase();
    
    if (!isSelf) {
      const err = await checkMemberWritePermission(c, target.circleId, target.role, undefined, target.eventId);
      if (err) return c.json({ error: err.error }, err.status);
    }

    // 2026-07-04: Cloudflare Workers の CPU 時間制限超過防止のため、ソルトラウンドを 4 に設定。
    const pinHash = await bcrypt.hash(input.pin, 4);

    await db
      .update(membership)
      .set({ pin: pinHash })
      .where(eq(membership.id, id));

    return c.json({ success: true });
  }
);

export default membershipRoutes;

import { auth } from "@fesflow/auth";
import { db, membership, circle, getEnv } from "@fesflow/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Context } from "hono";
import { ROLE_PERMISSIONS, type Permission } from "@fesflow/db";

export async function getSession(c: Context) {
  return await auth.api.getSession({
    headers: c.req.raw.headers,
  });
}


export async function getAdminSession(c: Context) {
  // Better Auth からセッションを取得
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session || !session.user) {
    return null;
  }

  const email = session.user.email;
  const initialAdminEmail = getEnv().INITIAL_SUPER_ADMIN_EMAIL;

  // 初期管理者メールアドレスに一致する場合、自動昇格/登録チェック
  if (initialAdminEmail && email.toLowerCase() === initialAdminEmail.toLowerCase()) {
    const existing = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, email),
          eq(membership.role, "super_admin"),
          eq(membership.isActive, true)
        )
      );

    if (existing.length === 0) {
      // super_admin としてメンバーシップを自動作成
      await db.insert(membership).values({
        id: nanoid(),
        userEmail: email.toLowerCase(),
        userName: session.user.name || "Super Admin",
        role: "super_admin",
        isActive: true,
      });
    }
    return session;
  }

  // データベースから super_admin 権限を持っているかチェック (2026-07-04 SaaS簡素化)
  const adminMembership = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.userEmail, email),
        eq(membership.isActive, true)
      )
    );

  const hasSystemAdmin = adminMembership.some((m) => m.role === "super_admin");
  if (!hasSystemAdmin) {
    return null;
  }

  return session;
}

export async function hasPermission(
  c: Context,
  circleId: string | null,
  requiredPermission: Permission,
  eventId?: string
): Promise<boolean> {
  const session = await getSession(c);
  if (!session || !session.user) return false;

  const email = session.user.email.toLowerCase();
  const activeMembershipId = c.req.header("X-Active-Membership-Id");

  let memberships = [];
  if (activeMembershipId) {
    // アクティブなメンバーシップが明示されている場合は、そのメンバーシップのみを対象に評価する (SaaSコンテキスト分離)
    memberships = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.id, activeMembershipId),
          eq(membership.userEmail, email),
          eq(membership.isActive, true)
        )
      );
  } else {
    // 互換性維持: 明示されない場合は、ユーザーのすべてのアクティブメンバーシップを取得
    memberships = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.userEmail, email),
          eq(membership.isActive, true)
        )
      );
  }

  if (memberships.length === 0) return false;

  // 1. super_admin のチェック
  const superAdminM = memberships.find((m) => m.role === "super_admin");
  if (superAdminM) {
    return true;
  }

  // 2. event_manager のチェック (イベント内のすべてのサークル/設定に対して権限を持つ)
  let resolvedEventId = eventId;
  if (!resolvedEventId && circleId) {
    const circles = await db.select().from(circle).where(eq(circle.id, circleId));
    if (circles.length > 0) {
      resolvedEventId = circles[0]!.eventId;
    }
  }

  const eventM = memberships.find((m) => m.role === "event_manager");
  if (eventM && eventM.eventId) {
    if (!resolvedEventId || eventM.eventId === resolvedEventId) {
      const permissions = ROLE_PERMISSIONS["event_manager"];
      if (permissions && (permissions as readonly string[]).includes(requiredPermission)) {
        return true;
      }
    }
  }

  // 3. circle_manager / circle_staff のチェック
  if (circleId) {
    const circleM = memberships.find((m) => m.circleId === circleId);
    if (circleM) {
      const role = circleM.role as keyof typeof ROLE_PERMISSIONS;
      const permissions = ROLE_PERMISSIONS[role];
      if (permissions && (permissions as readonly string[]).includes(requiredPermission)) {
        return true;
      }
    }
  }

  return false;
}

import { membership, circle } from "@fesflow/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Context } from "hono";
import { ROLE_PERMISSIONS, type Permission } from "@fesflow/db";
import type { AppEnv } from "../types";
import { getImpersonation, betterAuthSessionId, audit } from "./sudo";

// 2026-07-08 (Phase5): db/auth はモジュール Proxy ではなく、index.ts の middleware で
// c.set("db"/"auth", ...) された実体を c.get() で明示的に受け取る (ALS+Proxy 撤去)。
// このファイルの関数は全て Context を受け取るので、c.get("db") / c.get("auth") /
// c.env で解決できる。

export async function getSession(c: Context<AppEnv>) {
  const auth = c.get("auth");
  return await auth.api.getSession({
    headers: c.req.raw.headers,
  });
}


export async function getAdminSession(c: Context<AppEnv>) {
  const db = c.get("db");
  const auth = c.get("auth");

  // Better Auth からセッションを取得
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session || !session.user) {
    return null;
  }

  const email = session.user.email;
  // 旧 getEnv().INITIAL_SUPER_ADMIN_EMAIL → c.env から直接参照 (Phase5: getEnv 廃止)
  const initialAdminEmail = c.env.INITIAL_SUPER_ADMIN_EMAIL;

  // 2026-07-06: 初期管理者メールアドレスへの自動昇格は emailVerified === true の場合に限定する (監査 C1)。
  // better-auth はメール検証なしでもサインアップ・ログインできるため、検証前は
  // 「文字列が一致しただけ」の任意人物が super_admin になれてしまっていた。
  if (
    initialAdminEmail &&
    email.toLowerCase() === initialAdminEmail.toLowerCase() &&
    session.user.emailVerified === true
  ) {
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
  c: Context<AppEnv>,
  circleId: string | null,
  requiredPermission: Permission,
  eventId?: string
): Promise<boolean> {
  const db = c.get("db");
  const session = await getSession(c);
  if (!session || !session.user) return false;

  // 2026-07-12 (Phase E): なりすまし中は「対象ロール×スコープ」として評価する。
  // これが super_admin がテナント内容に触れる唯一の経路 (それ以外は下で false になる)。
  const imp = await getImpersonation(c, betterAuthSessionId(session));
  if (imp) {
    const perms = ROLE_PERMISSIONS[imp.role as keyof typeof ROLE_PERMISSIONS] as
      | readonly string[]
      | undefined;
    if (!perms || !perms.includes(requiredPermission)) return false;
    // 対象スコープ内のリクエストかを確認する
    let reqEventId = eventId;
    if (!reqEventId && circleId) {
      const cs = await db.select().from(circle).where(eq(circle.id, circleId));
      reqEventId = cs[0]?.eventId;
    }
    let allowed = false;
    if (imp.role === "event_manager") {
      allowed = !!imp.eventId && (!reqEventId || imp.eventId === reqEventId);
    } else if (imp.role === "circle_manager" || imp.role === "circle_staff") {
      allowed = !!imp.circleId && (!circleId || imp.circleId === circleId);
    }
    // なりすまし中の変更操作 (write/delete) は監査ログに記録する。
    if (allowed && /:(write|delete)$/.test(requiredPermission)) {
      await audit(c, {
        actorEmail: session.user.email.toLowerCase(),
        action: "impersonated_write",
        asRole: imp.role,
        eventId: imp.eventId,
        circleId: imp.circleId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        summary: requiredPermission,
      });
    }
    return allowed;
  }

  const email = session.user.email.toLowerCase();
  const activeMembershipId = c.req.header("X-Active-Membership-Id");

  // 2026-07-07 (Phase 3a): 「X-Active-Membership-Id が無ければ全 membership を評価する」
  // 互換フォールバックを撤去。このフォールバックがあると、どれか1つでも super_admin
  // membership を持つ人が、アクティブスペースを明示していなくても全ルートを通過できてしまい、
  // 「明示されたスペースの権限だけを見る」という SaaS のコンテキスト分離の前提が崩れていた。
  // ヘッダー必須化: 無ければ常に権限なし (false) として扱う。
  if (!activeMembershipId) return false;

  const memberships = await db
    .select()
    .from(membership)
    .where(
      and(
        eq(membership.id, activeMembershipId),
        eq(membership.userEmail, email),
        eq(membership.isActive, true)
      )
    );

  if (memberships.length === 0) return false;

  // 1. super_admin はテナント内容にアクセスできない (2026-07-12 Phase D 分離)。
  //    SaaS 運営者がテナントのメニュー/注文/売上を素通しで覗ける状態をなくす。
  //    内容を見る必要がある時は「昇格(sudo)→なりすまし」経由に限る (上の imp 分岐)。
  const superAdminM = memberships.find((m) => m.role === "super_admin");
  if (superAdminM) {
    return false;
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

import { membership, circle, event } from "@fesflow/db";
import { eq, and } from "drizzle-orm";
import { ulid } from "ulidx";
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
        id: ulid(),
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

/**
 * イベントが「閲覧のみモード」かを判定する (2026-07-16)。
 * lifecycleStatus が ended/archived のイベントは終了済みなので、配下の変更操作を止めて
 * データを凍結する (集計・エクスポートなどの参照系は従来どおり通す)。
 */
async function isEventReadOnly(
  c: Context<AppEnv>,
  circleId: string | null,
  eventId?: string
): Promise<boolean> {
  const db = c.get("db");
  let targetEventId = eventId;
  if (!targetEventId && circleId) {
    const cs = await db.select().from(circle).where(eq(circle.id, circleId));
    targetEventId = cs[0]?.eventId;
  }
  // イベントを特定できない操作 (システム系など) はこのゲートの対象外。
  if (!targetEventId) return false;
  const ev = await db.select().from(event).where(eq(event.id, targetEventId));
  const status = ev[0]?.lifecycleStatus;
  return status === "ended" || status === "archived";
}

export async function hasPermission(
  c: Context<AppEnv>,
  circleId: string | null,
  requiredPermission: Permission,
  eventId?: string,
  // 閲覧のみモードのゲートを外す (2026-07-16)。終了したイベントを「開催中」に戻す
  // 操作 (lifecycle-status) 自体まで止めてしまうとロックアウトするため、その経路だけ true にする。
  opts?: { allowWhenClosed?: boolean }
): Promise<boolean> {
  const db = c.get("db");
  const session = await getSession(c);
  if (!session || !session.user) return false;

  // 閲覧のみモード (2026-07-16): 終了/保持中のイベント配下では変更操作を一律拒否する。
  // なりすまし・正規ロールのどちらの経路より前に判定して、UIの導線に関わらずサーバで凍結する。
  if (
    !opts?.allowWhenClosed &&
    /:(write|delete)$/.test(requiredPermission) &&
    (await isEventReadOnly(c, circleId, eventId))
  ) {
    return false;
  }

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

  // 対象イベントの解決 (circleId 指定時はその親イベント)。super_admin 分岐でも使う。
  let resolvedEventId = eventId;
  if (!resolvedEventId && circleId) {
    const circles = await db.select().from(circle).where(eq(circle.id, circleId));
    if (circles.length > 0) {
      resolvedEventId = circles[0]!.eventId;
    }
  }

  // 1. super_admin は「肩書きだけ」ではテナント内容にアクセスできない (2026-07-12 Phase D 分離)。
  //    SaaS 運営者がテナントのメニュー/注文/売上を素通しで覗ける状態をなくす。
  //    ただし本人が「対象イベント/サークルの正規ロール(event_manager / circle_*)」も実際に
  //    持っている場合は、その正規ロールとして許可する (自分でイベントを作った=super_admin かつ
  //    event_manager である運営者が、自分のイベントの統計等を見られないと困るため)。
  //    対象に正規ロールが無ければ従来どおり不可 = 昇格→なりすまし経由でのみ閲覧 (分離を維持)。
  const superAdminM = memberships.find((m) => m.role === "super_admin");
  if (superAdminM) {
    const legit = await db
      .select()
      .from(membership)
      .where(and(eq(membership.userEmail, email), eq(membership.isActive, true)));
    const em = legit.find(
      (m) => m.role === "event_manager" && m.eventId && (!resolvedEventId || m.eventId === resolvedEventId)
    );
    if (em) {
      const perms = ROLE_PERMISSIONS["event_manager"] as readonly string[];
      if (perms.includes(requiredPermission)) return true;
    }
    if (circleId) {
      const cm = legit.find(
        (m) => m.circleId === circleId && (m.role === "circle_manager" || m.role === "circle_staff")
      );
      if (cm) {
        const perms = ROLE_PERMISSIONS[cm.role as keyof typeof ROLE_PERMISSIONS] as readonly string[] | undefined;
        if (perms && perms.includes(requiredPermission)) return true;
      }
    }
    return false;
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

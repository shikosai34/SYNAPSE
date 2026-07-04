import { z } from "zod";
import { router, publicProcedure } from "../index";
import {
  db,
  membership,
  inviteToken,
  circle,
  event,
  ROLES,
  ROLE_PERMISSIONS,
  type RoleType,
} from "@fesflow/db";
import { eq, and, or, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";

// ロールのZodスキーマ
const roleSchema = z.enum([
  "super_admin",
  "event_manager",
  "circle_manager",
  "circle_staff",
]);

// 権限チェックヘルパー関数
export function hasPermission(role: RoleType, permission: string): boolean {
  const permissions = ROLE_PERMISSIONS[role] as readonly string[];
  return permissions?.includes(permission) ?? false;
}

// ロールの階層チェック（上位ロールは下位ロールの操作が可能）
export function canManageRole(
  managerRole: RoleType,
  targetRole: RoleType
): boolean {
  const hierarchy: Record<RoleType, number> = {
    [ROLES.SUPER_ADMIN]: 100,
    [ROLES.EVENT_MANAGER]: 80,
    [ROLES.CIRCLE_MANAGER]: 60,
    [ROLES.CIRCLE_STAFF]: 50,
  };

  return hierarchy[managerRole] > hierarchy[targetRole];
}

export const membershipRouter = router({
  // 自分のメンバーシップ一覧取得
  myMemberships: publicProcedure
    .input(z.object({ userEmail: z.string().email() }))
    .query(async ({ input }) => {
      return await db
        .select({
          membership: membership,
          circle: circle,
          event: event,
        })
        .from(membership)
        .leftJoin(circle, eq(membership.circleId, circle.id))
        .leftJoin(event, eq(membership.eventId, event.id))
        .where(
          and(
            eq(membership.userEmail, input.userEmail),
            eq(membership.isActive, true)
          )
        );
    }),

  // サークルのメンバー一覧取得
  listByCircle: publicProcedure
    .input(z.object({ circleId: z.string() }))
    .query(async ({ input }) => {
      return await db
        .select()
        .from(membership)
        .where(eq(membership.circleId, input.circleId));
    }),

  // イベントのメンバー一覧取得
  listByEvent: publicProcedure
    .input(z.object({ eventId: z.string() }))
    .query(async ({ input }) => {
      return await db
        .select()
        .from(membership)
        .where(eq(membership.eventId, input.eventId));
    }),

  // メンバーシップの権限チェック
  checkPermission: publicProcedure
    .input(
      z.object({
        userEmail: z.string().email(),
        circleId: z.string().optional(),
        eventId: z.string().optional(),
        permission: z.string(),
      })
    )
    .query(async ({ input }) => {
      // サークルまたはイベントでのメンバーシップを取得
      const memberships = await db
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.userEmail, input.userEmail),
            eq(membership.isActive, true),
            or(
              input.circleId
                ? eq(membership.circleId, input.circleId)
                : sql`1=0`,
              input.eventId ? eq(membership.eventId, input.eventId) : sql`1=0`
            )
          )
        );

      if (memberships.length === 0) {
        return { hasPermission: false, role: null };
      }

      // 最も高い権限を持つロールを使用
      const highestRole = memberships.reduce((highest, m) => {
        const roleHierarchy: Record<string, number> = {
          event_admin: 100,
          circle_manager: 80,
          stock_manager: 60,
          cashier: 50,
          kitchen_staff: 50,
          waiter: 40,
          viewer: 10,
        };
        return (roleHierarchy[m.role] ?? 0) > (roleHierarchy[highest] ?? 0)
          ? m.role
          : highest;
      }, "viewer");

      const permitted = hasPermission(
        highestRole as RoleType,
        input.permission
      );

      return { hasPermission: permitted, role: highestRole };
    }),

  // メンバーを直接追加（管理者用）
  addMember: publicProcedure
    .input(
      z.object({
        userEmail: z.string().email(),
        userName: z.string(),
        circleId: z.string().optional(),
        eventId: z.string().optional(),
        role: roleSchema,
        pin: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = nanoid();
      const hashedPin = input.pin
        // 2026-07-04: Cloudflare Workers の CPU 時間制限（最大50ms）超過による 500 エラーを避けるため、ソルトラウンドを 4 に引き下げ。
        ? await bcrypt.hash(input.pin, 4)
        : undefined;

      await db.insert(membership).values({
        id,
        userEmail: input.userEmail.toLowerCase(),
        userName: input.userName,
        circleId: input.circleId,
        eventId: input.eventId,
        role: input.role,
        pin: hashedPin,
        acceptedAt: new Date(),
      });

      return { id };
    }),

  // メンバーのロール更新
  updateRole: publicProcedure
    .input(
      z.object({
        membershipId: z.string(),
        role: roleSchema,
      })
    )
    .mutation(async ({ input }) => {
      await db
        .update(membership)
        .set({ role: input.role })
        .where(eq(membership.id, input.membershipId));

      return { success: true };
    }),

  // メンバーを非アクティブ化（削除の代わり）
  deactivateMember: publicProcedure
    .input(z.object({ membershipId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(membership)
        .set({ isActive: false })
        .where(eq(membership.id, input.membershipId));

      return { success: true };
    }),

  // メンバーを削除
  removeMember: publicProcedure
    .input(z.object({ membershipId: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(membership).where(eq(membership.id, input.membershipId));
      return { success: true };
    }),

  // 招待トークン生成
  createInviteToken: publicProcedure
    .input(
      z.object({
        circleId: z.string().optional(),
        eventId: z.string().optional(),
        role: roleSchema,
        maxUses: z.number().min(1).default(1),
        expiresInHours: z.number().min(1).default(24),
        createdBy: z.string().email(),
      })
    )
    .mutation(async ({ input }) => {
      const id = nanoid();
      const token = nanoid(32);
      const expiresAt = new Date(
        Date.now() + input.expiresInHours * 60 * 60 * 1000
      );

      await db.insert(inviteToken).values({
        id,
        token,
        circleId: input.circleId,
        eventId: input.eventId,
        role: input.role,
        maxUses: input.maxUses,
        expiresAt,
        createdBy: input.createdBy,
      });

      return { token, expiresAt };
    }),

  // 招待トークンで参加
  acceptInvite: publicProcedure
    .input(
      z.object({
        token: z.string(),
        userEmail: z.string().email(),
        userName: z.string(),
        pin: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // トークンを取得
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
        throw new Error("無効または期限切れの招待トークンです");
      }

      const tokenData = tokens[0]!;

      if (
        tokenData.maxUses !== null &&
        tokenData.usedCount >= tokenData.maxUses
      ) {
        throw new Error("この招待トークンは使用上限に達しています");
      }

      // 既存のメンバーシップをチェック
      const existing = await db
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.userEmail, input.userEmail),
            or(
              tokenData.circleId
                ? eq(membership.circleId, tokenData.circleId)
                : sql`1=0`,
              tokenData.eventId
                ? eq(membership.eventId, tokenData.eventId)
                : sql`1=0`
            )
          )
        );

      if (existing.length > 0) {
        throw new Error("既にメンバーとして登録されています");
      }

      // メンバーシップを作成
      const id = nanoid();
      const hashedPin = input.pin
        // 2026-07-04: Cloudflare Workers の CPU 時間制限超過防止のため、ソルトラウンドを 4 に設定。
        ? await bcrypt.hash(input.pin, 4)
        : undefined;

      await db.insert(membership).values({
        id,
        userEmail: input.userEmail.toLowerCase(),
        userName: input.userName,
        circleId: tokenData.circleId,
        eventId: tokenData.eventId,
        role: tokenData.role,
        pin: hashedPin,
        invitedAt: tokenData.createdAt,
        acceptedAt: new Date(),
      });

      // トークンの使用回数を更新
      await db
        .update(inviteToken)
        .set({ usedCount: tokenData.usedCount + 1 })
        .where(eq(inviteToken.id, tokenData.id));

      return { membershipId: id, role: tokenData.role };
    }),

  // 招待トークン一覧取得
  listInviteTokens: publicProcedure
    .input(
      z.object({
        circleId: z.string().optional(),
        eventId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      if (input.circleId) {
        return await db
          .select()
          .from(inviteToken)
          .where(eq(inviteToken.circleId, input.circleId));
      }
      if (input.eventId) {
        return await db
          .select()
          .from(inviteToken)
          .where(eq(inviteToken.eventId, input.eventId));
      }
      return [];
    }),

  // 招待トークン削除
  deleteInviteToken: publicProcedure
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(inviteToken).where(eq(inviteToken.id, input.tokenId));
      return { success: true };
    }),

  // PINで認証（簡易ログイン用）
  authenticateWithPin: publicProcedure
    .input(
      z.object({
        userEmail: z.string().email(),
        pin: z.string(),
        circleId: z.string().optional(),
        eventId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const memberships = await db
        .select()
        .from(membership)
        .where(
          and(
            eq(membership.userEmail, input.userEmail),
            eq(membership.isActive, true),
            or(
              input.circleId
                ? eq(membership.circleId, input.circleId)
                : sql`1=0`,
              input.eventId ? eq(membership.eventId, input.eventId) : sql`1=0`
            )
          )
        );

      if (memberships.length === 0) {
        throw new Error("メンバーシップが見つかりません");
      }

      const memberData = memberships[0]!;

      if (!memberData.pin) {
        throw new Error("PINが設定されていません");
      }

      const isValid = await bcrypt.compare(input.pin, memberData.pin);
      if (!isValid) {
        throw new Error("PINが正しくありません");
      }

      return {
        membershipId: memberData.id,
        role: memberData.role,
        userName: memberData.userName,
      };
    }),

  // ロール一覧取得（フロントエンド表示用）
  getRoles: publicProcedure.query(() => {
    return {
      roles: ROLES,
      roleDescriptions: {
        [ROLES.SUPER_ADMIN]: {
          name: "システム最高管理者",
          description: "システム全体の管理権限を持つ最上位の管理者",
        },
        [ROLES.EVENT_MANAGER]: {
          name: "イベントマネージャー",
          description: "イベント全体の管理権限を持つ主催者管理者",
        },
        [ROLES.CIRCLE_MANAGER]: {
          name: "サークルマネージャー",
          description: "サークルの設定、メニュー、スタッフを管理できる店舗責任者",
        },
        [ROLES.CIRCLE_STAFF]: {
          name: "サークルスタッフ",
          description: "模擬店のレジ・調理・在庫などを担当する店舗スタッフ",
        },
      },
    };
  }),
});

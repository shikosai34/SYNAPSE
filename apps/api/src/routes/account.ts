/**
 * アカウント管理ルート (2026-07-04 追加)
 *
 * 自分自身のアカウント (better-auth の user) を操作するセルフサービスAPI。
 * すべて better-auth セッション必須で、対象は常に session.user 本人。
 *
 * 重要な整合性の注意:
 * - membership / notification はユーザーを `userEmail` で紐付けている
 *   (userId ではない)。そのためメール変更時はこれらもカスケード更新しないと
 *   所属・通知が孤立する。ここで一括更新する。
 * - session / account テーブルは user.id への FK が onDelete: cascade なので
 *   user 行を消せば自動で消える。membership / notification は userEmail 参照で
 *   FK が無いため明示的に削除する。
 */
import { Hono, type Context } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import { db, user, membership, notification } from "@fesflow/db";
import { eq, and } from "drizzle-orm";
import { auth } from "@fesflow/auth";

const accountRoutes = new Hono();

/** セッションから本人のメール(小文字)を取り出す。未認証なら null。 */
async function getSelf(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session || !session.user) return null;
  return {
    id: session.user.id,
    email: session.user.email.toLowerCase(),
    name: session.user.name ?? null,
  };
}

// 自分のアカウント情報を取得 (localStorage が古い場合の正本)
accountRoutes.get("/me", async (c) => {
  const self = await getSelf(c);
  if (!self) apiError("UNAUTHORIZED", "認証されていません");

  const rows = await db.select().from(user).where(eq(user.id, self.id));
  const u = rows[0];
  if (!u) apiError("NOT_FOUND", "ユーザーが見つかりません");

  return c.json({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    emailVerified: u.emailVerified,
  });
});

// プロフィール更新 (ユーザー名 / アイコン画像)
accountRoutes.patch(
  "/profile",
  zBody(
    z.object({
      name: z.string().trim().min(1).max(60).optional(),
      // 画像は URL 文字列。空文字/null でアイコン削除を許可。
      image: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const self = await getSelf(c);
    if (!self) apiError("UNAUTHORIZED", "認証されていません");
    const input = c.req.valid("json");

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.image !== undefined) patch.image = input.image || null;

    if (Object.keys(patch).length === 0) {
      apiError("BAD_REQUEST", "更新項目がありません");
    }

    await db.update(user).set(patch).where(eq(user.id, self.id));

    // 表示名を membership 側にも反映し、一覧の表示名がズレないようにする
    if (input.name !== undefined) {
      await db
        .update(membership)
        .set({ userName: input.name })
        .where(eq(membership.userEmail, self.email));
    }

    return c.json({ success: true });
  }
);

// メールアドレス変更 (membership / notification へカスケード)
accountRoutes.patch(
  "/email",
  zBody(
    z.object({
      newEmail: z.string().email(),
    })
  ),
  async (c) => {
    const self = await getSelf(c);
    if (!self) apiError("UNAUTHORIZED", "認証されていません");
    const newEmail = c.req.valid("json").newEmail.toLowerCase();

    if (newEmail === self.email) {
      apiError("BAD_REQUEST", "現在のメールアドレスと同じです");
    }

    // 重複チェック (user.email は unique)
    const dup = await db.select().from(user).where(eq(user.email, newEmail));
    if (dup.length > 0) {
      apiError("CONFLICT", "このメールアドレスは既に使われています");
    }

    // user 本体を更新。メール変更後は再検証扱いにする (email_verified=false)
    await db
      .update(user)
      .set({ email: newEmail, emailVerified: false })
      .where(eq(user.id, self.id));

    // userEmail で紐付く所属・通知をカスケード更新
    await db
      .update(membership)
      .set({ userEmail: newEmail })
      .where(eq(membership.userEmail, self.email));
    await db
      .update(notification)
      .set({ userEmail: newEmail })
      .where(eq(notification.userEmail, self.email));

    return c.json({ success: true, email: newEmail });
  }
);

// 権限(所属)を1件削除 = 自分がそのスペースから抜ける
// 2026-07-05: circle_manager / event_manager が自分の所属を退出すると、
// そのサークル/イベントの管理者が誰もいなくなる(オーナー不在化)おそれがあった。
// 同じ circleId/eventId に他にアクティブな同ロールの管理者がいない場合は退出を拒否し、
// 先にオーナー権限を他のメンバーに譲渡(ロール変更)するよう促す。
accountRoutes.delete("/membership/:id", async (c) => {
  const self = await getSelf(c);
  if (!self) apiError("UNAUTHORIZED", "認証されていません");
  const id = c.req.param("id");

  const rows = await db.select().from(membership).where(eq(membership.id, id));
  const m = rows[0];
  if (!m) apiError("NOT_FOUND", "所属が見つかりません");
  // 本人の所属のみ削除可 (他人の権限は管理者APIから)
  if (m.userEmail.toLowerCase() !== self.email) {
    apiError("FORBIDDEN", "この権限を削除する権限がありません");
  }

  if (m.role === "circle_manager" && m.circleId) {
    const otherManagers = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.circleId, m.circleId),
          eq(membership.role, "circle_manager"),
          eq(membership.isActive, true)
        )
      );
    if (otherManagers.filter((om) => om.id !== m.id).length === 0) {
      apiError("FORBIDDEN", "オーナー権限を他のメンバーに譲渡してから退出してください");
    }
  }

  if (m.role === "event_manager" && m.eventId) {
    const otherEventManagers = await db
      .select()
      .from(membership)
      .where(
        and(
          eq(membership.eventId, m.eventId),
          eq(membership.role, "event_manager"),
          eq(membership.isActive, true)
        )
      );
    if (otherEventManagers.filter((om) => om.id !== m.id).length === 0) {
      apiError("FORBIDDEN", "オーナー権限を他のメンバーに譲渡してから退出してください");
    }
  }

  await db.delete(membership).where(eq(membership.id, id));
  return c.json({ success: true });
});

// アカウント削除 (本人)。所属・通知を消してから user を削除 (session/account は FK cascade)
accountRoutes.delete("/", async (c) => {
  const self = await getSelf(c);
  if (!self) apiError("UNAUTHORIZED", "認証されていません");

  await db.delete(membership).where(eq(membership.userEmail, self.email));
  await db.delete(notification).where(eq(notification.userEmail, self.email));
  await db.delete(user).where(eq(user.id, self.id));

  return c.json({ success: true });
});

export default accountRoutes;

/**
 * ⚠️ ローカル開発専用の手動シードスクリプト — 本番 DB では絶対に実行しないこと。
 *
 * 2026-07-05 注記 (セキュリティ監査の後始末):
 * - 管理者アカウントに固定リストバンド wb_admin_001 と固定 AuthID を直接紐付ける。
 *   これらは監査 C5「ハードコード管理者バックドア」対応で本番アプリの自動シードからは撤去済み。
 *   本スクリプトはローカル検証用に残しているだけで、本番 Worker のバンドルには一切含まれない。
 * - 実行は `bun run seed-admin-wristband.ts` の手動のみ。package.json のスクリプトからは呼ばれない。
 * - 誤って本番 D1 (`--remote`) に対して実行すると、既知のリストバンドIDで有効な管理者帯が
 *   生成され、管理者なりすましの経路になる。実行前に接続先が local であることを必ず確認する。
 */
import { db, user as authUser, event, eventUser, wristband } from "./src";
import { eq } from "drizzle-orm";

async function seedAdmin() {
  const adminEmail = process.env.INITIAL_SUPER_ADMIN_EMAIL || "me@fukayatti0.dev";
  console.log(`管理者メール (${adminEmail}) へのリストバンド直接紐付けを開始します...`);

  // 0. イベント存在チェック
  const existingEvents = await db.select().from(event).where(eq(event.id, "evt_default"));
  if (existingEvents.length === 0) {
    await db.insert(event).values({
      id: "evt_default",
      eventName: "メインイベント (学園祭・フェス)",
    });
  }

  // 1. authUser テーブルから me@fukayatti0.dev を検索
  const usersInAuth = await db.select().from(authUser).where(eq(authUser.email, adminEmail));
  let adminAuthUserId = "usr_admin";
  if (usersInAuth.length > 0) {
    adminAuthUserId = usersInAuth[0]!.id;
    console.log(`Authユーザーが見つかりました: ID = ${adminAuthUserId}`);
  }

  const targetUserIds = Array.from(new Set([adminAuthUserId, adminEmail, "usr_admin"]));
  let baseDisplayId = 990;

  for (const targetId of targetUserIds) {
    baseDisplayId += 1;
    // eventUser 存在チェック＆作成
    const existingEU = await db.select().from(eventUser).where(eq(eventUser.id, targetId));
    if (existingEU.length === 0) {
      await db.insert(eventUser).values({
        id: targetId,
        eventId: "evt_default",
        displayId: baseDisplayId,
        status: "available",
      });
      console.log(`[eventUser] ID: ${targetId} (#${baseDisplayId}) を作成しました。`);
    } else {
      console.log(`[eventUser] ID: ${targetId} は既に存在します。`);
    }

    // wristband (wb_admin_001) 存在チェック＆紐付け
    const wbCode = targetId === adminAuthUserId ? "wb_admin_001" : `wb_${targetId.slice(0, 10)}`;
    const existingWb = await db.select().from(wristband).where(eq(wristband.id, wbCode));
    if (existingWb.length === 0) {
      await db.insert(wristband).values({
        id: wbCode,
        userId: targetId,
        status: "active",
        assignedAt: new Date(),
      });
      console.log(`[wristband] ${wbCode} -> ${targetId} を登録しました。`);
    } else {
      await db
        .update(wristband)
        .set({ userId: targetId, status: "active" })
        .where(eq(wristband.id, wbCode));
      console.log(`[wristband] ${wbCode} -> ${targetId} に更新・アクティブ化しました。`);
    }
  }

  // 特に AuthID (lTkBEJtn1G88NFZ2bsLdATuSrjjLuaTG) に wb_admin_001 を確実に紐付ける
  await db
    .insert(wristband)
    .values({
      id: "wb_admin_001",
      userId: adminAuthUserId,
      status: "active",
      assignedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: wristband.id,
      set: { userId: adminAuthUserId, status: "active" },
    });
  console.log(`⭐ wb_admin_001 を管理者アカウント (${adminAuthUserId} / ${adminEmail}) にアクティブバインド完了！`);

  console.log("🎉 管理者リストバンドの直接DB登録が正常完了しました！");
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});

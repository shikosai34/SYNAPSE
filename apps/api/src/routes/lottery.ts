import { Hono } from "hono";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { z } from "zod";
import {
  event,
  circle,
  eventUser,
  userStamp,
  review,
  lottery,
  lotteryPrize,
  lotteryEntry,
  lotteryWinner,
} from "@fesflow/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";

// イベント単位の抽選 (2026-07-12)
// 主催者(event_manager)が景品と口数(当選確率)の重みを設定し、応募者から重み付き抽選する。
// 口数 = base + perStamp*スタンプ数 + perReview*レビュー数 (entryConfig)。
// 「様々なニーズ」に応えるため重みを可変にし、誰でも1口/スタンプ重視/レビュー重視を表現できる。
const lotteryRoutes = new Hono<AppEnv>();

const entryConfigSchema = z.object({
  base: z.number().min(0).max(1000),
  perStamp: z.number().min(0).max(1000),
  perReview: z.number().min(0).max(1000),
});

/** イベントの生存サークルIDを返す。 */
async function eventCircleIds(db: any, eventId: string): Promise<string[]> {
  const rows = await db
    .select({ id: circle.id })
    .from(circle)
    .where(and(eq(circle.eventId, eventId), isNull(circle.deletedAt)));
  return rows.map((r: any) => r.id);
}

// 抽選の取得 (設定+景品+当選者+応募数)。event:read 権限。
lotteryRoutes.get("/", async (c) => {
  const db = c.get("db");
  const eventId = c.req.query("eventId");
  if (!eventId) apiError("BAD_REQUEST", "eventId が必要です");
  if (!(await hasPermission(c, null, "event:read", eventId))) {
    apiError("FORBIDDEN", "この抽選を閲覧する権限がありません");
  }

  const lots = await db.select().from(lottery).where(eq(lottery.eventId, eventId!));
  const lot = lots[0];
  if (!lot) return c.json({ lottery: null });

  const prizes = await db.select().from(lotteryPrize).where(eq(lotteryPrize.lotteryId, lot.id));
  const entries = await db.select().from(lotteryEntry).where(eq(lotteryEntry.lotteryId, lot.id));
  const winners = await db.select().from(lotteryWinner).where(eq(lotteryWinner.lotteryId, lot.id));

  // 当選者の表示名 (ニックネーム/表示ID) を解決
  const winnerUserIds = winners.map((w: any) => w.eventUserId);
  const users = winnerUserIds.length
    ? await db.select().from(eventUser).where(inArray(eventUser.id, winnerUserIds))
    : [];
  const userLabel = new Map(users.map((u: any) => [u.id, u.nickname || `#${u.displayId}`]));
  const prizeName = new Map(prizes.map((p: any) => [p.id, p.name]));

  return c.json({
    lottery: { ...lot, entryConfig: JSON.parse(lot.entryConfig) },
    prizes,
    entryCount: entries.length,
    winners: winners.map((w: any) => ({
      id: w.id,
      prizeId: w.prizeId,
      prizeName: prizeName.get(w.prizeId) || "",
      eventUserId: w.eventUserId,
      userLabel: userLabel.get(w.eventUserId) || w.eventUserId,
      claimedAt: w.claimedAt,
    })),
  });
});

// 抽選の作成/更新 (イベントに1つ)。event:write 権限。
lotteryRoutes.post(
  "/",
  zBody(
    z.object({
      eventId: z.string(),
      name: z.string().min(1).max(120),
      drawAt: z.string().optional(),
      entryConfig: entryConfigSchema.optional(),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const input = c.req.valid("json");
    if (!(await hasPermission(c, null, "event:write", input.eventId))) {
      apiError("FORBIDDEN", "抽選を設定する権限がありません");
    }
    const existing = await db.select().from(lottery).where(eq(lottery.eventId, input.eventId));
    const cfg = JSON.stringify(input.entryConfig ?? { base: 1, perStamp: 0, perReview: 0 });
    const drawAt = input.drawAt ? new Date(input.drawAt) : null;
    if (existing[0]) {
      await db
        .update(lottery)
        .set({ name: input.name, drawAt, entryConfig: cfg })
        .where(eq(lottery.id, existing[0].id));
      return c.json({ id: existing[0].id });
    }
    const id = ulid();
    await db.insert(lottery).values({ id, eventId: input.eventId, name: input.name, drawAt, entryConfig: cfg });
    return c.json({ id }, 201);
  }
);

// 景品の追加。event:write 権限。
lotteryRoutes.post(
  "/:id/prizes",
  zBody(z.object({ name: z.string().min(1).max(120), quantity: z.number().int().min(1).max(10000) })),
  async (c) => {
    const db = c.get("db");
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const lots = await db.select().from(lottery).where(eq(lottery.id, id));
    if (!lots[0]) apiError("NOT_FOUND", "抽選が見つかりません");
    if (!(await hasPermission(c, null, "event:write", lots[0]!.eventId))) {
      apiError("FORBIDDEN", "景品を追加する権限がありません");
    }
    const prizeId = ulid();
    await db.insert(lotteryPrize).values({ id: prizeId, lotteryId: id, name: input.name, quantity: input.quantity });
    return c.json({ id: prizeId }, 201);
  }
);

// 景品の削除。
lotteryRoutes.delete("/:id/prizes/:prizeId", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const prizeId = c.req.param("prizeId");
  const lots = await db.select().from(lottery).where(eq(lottery.id, id));
  if (!lots[0]) apiError("NOT_FOUND", "抽選が見つかりません");
  if (!(await hasPermission(c, null, "event:write", lots[0]!.eventId))) {
    apiError("FORBIDDEN", "景品を削除する権限がありません");
  }
  await db.delete(lotteryPrize).where(and(eq(lotteryPrize.id, prizeId), eq(lotteryPrize.lotteryId, id)));
  return c.json({ success: true });
});

// 抽選の実行 (重み付き・当選者は1人1回まで)。event:write 権限。
lotteryRoutes.post("/:id/draw", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const lots = await db.select().from(lottery).where(eq(lottery.id, id));
  const lot = lots[0];
  if (!lot) apiError("NOT_FOUND", "抽選が見つかりません");
  if (!(await hasPermission(c, null, "event:write", lot!.eventId))) {
    apiError("FORBIDDEN", "抽選を実行する権限がありません");
  }
  if (lot!.status === "drawn") apiError("BAD_REQUEST", "この抽選は既に実行済みです");

  const prizes = await db.select().from(lotteryPrize).where(eq(lotteryPrize.lotteryId, id));
  if (prizes.length === 0) apiError("BAD_REQUEST", "景品がありません");
  const entries = await db.select().from(lotteryEntry).where(eq(lotteryEntry.lotteryId, id));
  if (entries.length === 0) apiError("BAD_REQUEST", "応募者がいません");

  // 口数計算に必要なスタンプ/レビューを集める
  const circleIds = await eventCircleIds(db, lot!.eventId);
  const stamps = circleIds.length
    ? await db.select().from(userStamp).where(inArray(userStamp.circleId, circleIds))
    : [];
  const reviews = circleIds.length
    ? await db.select().from(review).where(inArray(review.circleId, circleIds))
    : [];
  const stampCount = new Map<string, number>();
  for (const s of stamps) stampCount.set(s.userId, (stampCount.get(s.userId) || 0) + 1);
  const reviewCount = new Map<string, number>();
  for (const r of reviews) reviewCount.set(r.eventUserId, (reviewCount.get(r.eventUserId) || 0) + 1);

  const cfg = JSON.parse(lot!.entryConfig) as { base: number; perStamp: number; perReview: number };
  // 応募者を口数付きプールに (口数<=0 は除外)
  let pool = entries
    .map((e: any) => ({
      eventUserId: e.eventUserId as string,
      tickets:
        cfg.base + cfg.perStamp * (stampCount.get(e.eventUserId) || 0) + cfg.perReview * (reviewCount.get(e.eventUserId) || 0),
    }))
    .filter((p: { tickets: number }) => p.tickets > 0);

  const winners: { prizeId: string; eventUserId: string }[] = [];
  for (const prize of prizes) {
    for (let i = 0; i < prize.quantity; i++) {
      if (pool.length === 0) break;
      const total = pool.reduce((s: number, p: { tickets: number }) => s + p.tickets, 0);
      // Workers ランタイムの Math.random は利用可能 (workflow スクリプトではないため)
      let r = Math.random() * total;
      let idx = 0;
      for (let k = 0; k < pool.length; k++) {
        r -= pool[k]!.tickets;
        if (r <= 0) { idx = k; break; }
        idx = k;
      }
      const picked = pool[idx]!;
      winners.push({ prizeId: prize.id, eventUserId: picked.eventUserId });
      pool = pool.filter((_: unknown, k: number) => k !== idx); // 1人1回まで
    }
  }

  for (const w of winners) {
    await db.insert(lotteryWinner).values({ id: ulid(), lotteryId: id, prizeId: w.prizeId, eventUserId: w.eventUserId });
  }
  await db.update(lottery).set({ status: "drawn" }).where(eq(lottery.id, id));
  return c.json({ drawn: winners.length });
});

// 当選景品の受取記録。event:write 権限。
lotteryRoutes.post("/:id/winners/:winnerId/claim", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const winnerId = c.req.param("winnerId");
  const lots = await db.select().from(lottery).where(eq(lottery.id, id));
  if (!lots[0]) apiError("NOT_FOUND", "抽選が見つかりません");
  if (!(await hasPermission(c, null, "event:write", lots[0]!.eventId))) {
    apiError("FORBIDDEN", "受取を記録する権限がありません");
  }
  await db
    .update(lotteryWinner)
    .set({ claimedAt: new Date() })
    .where(and(eq(lotteryWinner.id, winnerId), eq(lotteryWinner.lotteryId, id)));
  return c.json({ success: true });
});

// 来場者の応募 (オプトイン)。userId(eventUser.id) が対象イベントの来場者であることを確認する。
lotteryRoutes.post("/:id/enter", zBody(z.object({ userId: z.string() })), async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const { userId } = c.req.valid("json");
  const lots = await db.select().from(lottery).where(eq(lottery.id, id));
  const lot = lots[0];
  if (!lot) apiError("NOT_FOUND", "抽選が見つかりません");
  if (lot!.status !== "open") apiError("BAD_REQUEST", "この抽選は応募を締め切りました");

  const evs = await db.select().from(event).where(eq(event.id, lot!.eventId));
  if (!evs[0]?.lotteryEnabled) apiError("BAD_REQUEST", "抽選は現在利用できません");

  const us = await db
    .select()
    .from(eventUser)
    .where(and(eq(eventUser.id, userId), eq(eventUser.eventId, lot!.eventId)));
  if (us.length === 0) apiError("FORBIDDEN", "このイベントの来場者ではありません");

  // 二重応募は unique 制約で弾かれるため、存在チェックしてから挿入 (冪等)。
  const existing = await db
    .select()
    .from(lotteryEntry)
    .where(and(eq(lotteryEntry.lotteryId, id), eq(lotteryEntry.eventUserId, userId)));
  if (existing.length === 0) {
    await db.insert(lotteryEntry).values({ id: ulid(), lotteryId: id, eventUserId: userId });
  }
  return c.json({ entered: true });
});

// 来場者の当選結果。
lotteryRoutes.get("/:id/result", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const userId = c.req.query("userId");
  if (!userId) apiError("BAD_REQUEST", "userId が必要です");
  const lots = await db.select().from(lottery).where(eq(lottery.id, id));
  const lot = lots[0];
  if (!lot) apiError("NOT_FOUND", "抽選が見つかりません");

  const entered = await db
    .select()
    .from(lotteryEntry)
    .where(and(eq(lotteryEntry.lotteryId, id), eq(lotteryEntry.eventUserId, userId!)));
  const wins = await db
    .select()
    .from(lotteryWinner)
    .where(and(eq(lotteryWinner.lotteryId, id), eq(lotteryWinner.eventUserId, userId!)));
  const prizes = wins.length
    ? await db.select().from(lotteryPrize).where(inArray(lotteryPrize.id, wins.map((w: any) => w.prizeId)))
    : [];
  const prizeName = new Map(prizes.map((p: any) => [p.id, p.name]));

  return c.json({
    status: lot!.status,
    entered: entered.length > 0,
    wins: wins.map((w: any) => ({ prizeName: prizeName.get(w.prizeId) || "", claimedAt: w.claimedAt })),
  });
});

export default lotteryRoutes;

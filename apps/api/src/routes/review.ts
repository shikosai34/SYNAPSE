import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { circle, circleVisit, eventUser, order, review, wristband, type DB } from "@fesflow/db";
import { zBody } from "../z-validator";
import { apiError } from "../http-error";
import { hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";

const reviewRoutes = new Hono<AppEnv>();

async function resolveVisitor(db: DB, code: string) {
  // 2026-09-27: review code は来場者IDでも検索できるため、バンド状態に加えてアカウント停止も両経路で確認する。
  const bands = await db.select({ id: eventUser.id, eventId: eventUser.eventId })
    .from(wristband)
    .innerJoin(eventUser, eq(wristband.userId, eventUser.id))
    .where(and(
      eq(wristband.id, code),
      or(eq(wristband.status, "active"), eq(wristband.status, "smartphone")),
      eq(eventUser.status, "available"),
    ));
  if (bands[0]) return bands[0];
  const users = await db.select({ id: eventUser.id, eventId: eventUser.eventId })
    .from(eventUser).where(and(eq(eventUser.id, code), eq(eventUser.status, "available")));
  return users[0] ?? null;
}

// 2026-09-27: 来場者には自分の利用先と投稿状態だけを返す。レビュー本文一覧は管理APIに限定する。
reviewRoutes.get("/visitor/:code", async (c) => {
  const db = c.get("db");
  const visitor = await resolveVisitor(db, c.req.param("code"));
  if (!visitor) return c.json([]);
  const userId = visitor.id;

  const visits = await db.select({ circleId: circleVisit.circleId })
    .from(circleVisit).where(eq(circleVisit.eventUserId, userId));
  // 2026-09-27: circle_visit は現状の本番コードで書き込まれていないため、受取/決済完了の注文も利用履歴とする。
  const completedOrders = await db.select({ circleId: order.circleId }).from(order).where(and(
    eq(order.userId, userId), ne(order.status, "cancelled"), or(eq(order.status, "completed"), eq(order.completed, true)),
  ));
  const circleIds = [...new Set([...visits.map((visit) => visit.circleId), ...completedOrders.map((item) => item.circleId)])];
  if (circleIds.length === 0) return c.json([]);

  const visitedCircles = await db.select({ id: circle.id, name: circle.name })
    // 2026-09-27: 利用履歴の不整合があっても別イベントのサークルを投稿候補に出さない。
    .from(circle).where(and(inArray(circle.id, circleIds), eq(circle.eventId, visitor.eventId), isNull(circle.deletedAt)));
  const ownReviews = await db.select({ circleId: review.circleId, rating: review.rating, comment: review.comment })
    .from(review).where(eq(review.eventUserId, userId));
  const reviewByCircle = new Map(ownReviews.map((item) => [item.circleId, { rating: item.rating, comment: item.comment }]));
  const visited = new Set(circleIds);
  return c.json(visitedCircles.filter((item) => visited.has(item.id)).map((item) => ({
    circleId: item.id,
    circleName: item.name,
    review: reviewByCircle.get(item.id) ?? null,
  })));
});

reviewRoutes.post("/visitor/:code", zBody(z.object({
  circleId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
})), async (c) => {
  const db = c.get("db");
  const visitor = await resolveVisitor(db, c.req.param("code"));
  if (!visitor) apiError("NOT_FOUND", "来場者が見つかりません");
  const userId = visitor.id;
  const { circleId, rating, comment } = c.req.valid("json");
  const circleRow = await db.select({ id: circle.id, eventId: circle.eventId })
    .from(circle).where(and(eq(circle.id, circleId), isNull(circle.deletedAt)));
  if (!circleRow[0]) apiError("NOT_FOUND", "サークルが見つかりません");
  if (visitor.eventId !== circleRow[0].eventId) apiError("FORBIDDEN", "このサークルへのレビュー投稿権限がありません");

  // 2026-09-27: 体験ログまたは受取/決済完了注文をサーバで照合し、クライアントの自己申告で投稿資格を与えない。
  const visits = await db.select({ id: circleVisit.id }).from(circleVisit).where(and(
    eq(circleVisit.eventUserId, userId), eq(circleVisit.circleId, circleId),
  ));
  const completedOrders = await db.select({ id: order.id }).from(order).where(and(
    eq(order.userId, userId), eq(order.circleId, circleId), ne(order.status, "cancelled"), or(eq(order.status, "completed"), eq(order.completed, true)),
  ));
  if (visits.length === 0 && completedOrders.length === 0) apiError("FORBIDDEN", "利用履歴のあるサークルにのみレビューできます");

  // 2026-09-27: 同じ来場者の再投稿は既存の1件を更新し、DBの一意制約と整合させる。
  await db.insert(review).values({ eventUserId: userId, circleId, rating, comment: comment || null })
    .onConflictDoUpdate({ target: [review.eventUserId, review.circleId], set: { rating, comment: comment || null } });
  return c.json({ success: true });
});

reviewRoutes.get("/circle/:circleId", async (c) => {
  const db = c.get("db");
  const circleId = c.req.param("circleId");
  if (!(await hasPermission(c, circleId, "sales:read"))) apiError("FORBIDDEN", "レビューを閲覧する権限がありません");
  const rows = await db.select({ rating: review.rating, comment: review.comment, createdAt: review.createdAt, displayId: eventUser.displayId })
    .from(review).innerJoin(eventUser, eq(review.eventUserId, eventUser.id))
    .where(eq(review.circleId, circleId)).orderBy(review.createdAt);
  return c.json(rows);
});

reviewRoutes.get("/event/:eventId", async (c) => {
  const db = c.get("db");
  const eventId = c.req.param("eventId");
  if (!(await hasPermission(c, null, "sales:read", eventId))) apiError("FORBIDDEN", "レビューを閲覧する権限がありません");
  const rows = await db.select({ circleId: review.circleId, circleName: circle.name, rating: review.rating, comment: review.comment, createdAt: review.createdAt, displayId: eventUser.displayId })
    .from(review).innerJoin(eventUser, eq(review.eventUserId, eventUser.id)).innerJoin(circle, eq(review.circleId, circle.id))
    .where(eq(circle.eventId, eventId)).orderBy(review.createdAt);
  return c.json(rows);
});

export default reviewRoutes;

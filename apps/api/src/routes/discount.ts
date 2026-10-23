// 2026-10-17: 店頭会計で使う割引はクーポン配布と分離し、注文操作権限の範囲で管理する。
import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulidx";
import { bundleDiscount, bundleDiscountMenu, circle, discount, event, menu } from "@fesflow/db";
import { hasPermission } from "../utils/auth";
import { BUNDLE_KINDS, isValidBundleValue } from "@fesflow/config/bundle-discount";
import { attachMenuIds, loadActiveBundleRules } from "../utils/bundle-discount";
import { apiError } from "../http-error";
import { zBody } from "../z-validator";
import type { AppEnv } from "../types";
import { isNull } from "drizzle-orm";

const discountRoutes = new Hono<AppEnv>();
const createDiscountSchema = z.object({
  title: z.string().trim().min(1).max(100),
  kind: z.enum(["percentage", "amount"]),
  value: z.number().int().positive(),
}).refine((input) => input.kind !== "percentage" || input.value <= 100, {
  path: ["value"],
  message: "割引率は1〜100％で指定してください",
});

discountRoutes.get("/circle/:circleId", async (c) => {
  const circleId = c.req.param("circleId");
  if (!(await hasPermission(c, circleId, "discount:read"))) {
    apiError("FORBIDDEN", "割引を閲覧する権限がありません");
  }
  const db = c.get("db");
  const rows = await db.select().from(discount)
    .where(eq(discount.circleId, circleId))
    .orderBy(desc(discount.createdAt));
  return c.json(rows);
});

discountRoutes.get("/circle/:circleId/register-options", async (c) => {
  const circleId = c.req.param("circleId");
  if (!(await hasPermission(c, circleId, "order:write"))) {
    apiError("FORBIDDEN", "レジを操作する権限がありません");
  }
  const db = c.get("db");
  const rows = await db.select({
    id: discount.id,
    title: discount.title,
    kind: discount.kind,
    value: discount.value,
  }).from(discount)
    .where(and(eq(discount.circleId, circleId), eq(discount.status, "active")))
    .orderBy(desc(discount.createdAt));
  return c.json(rows.filter((item) => item.kind === "percentage" || item.kind === "amount"));
});

discountRoutes.post("/circle/:circleId", zBody(createDiscountSchema), async (c) => {
  const circleId = c.req.param("circleId");
  if (!(await hasPermission(c, circleId, "discount:write"))) {
    apiError("FORBIDDEN", "割引を作成する権限がありません");
  }
  const input = c.req.valid("json");
  const db = c.get("db");
  const id = ulid();
  await db.insert(discount).values({
    id,
    circleId,
    title: input.title,
    kind: input.kind,
    value: input.value,
    status: "active",
  });
  const rows = await db.select().from(discount).where(eq(discount.id, id)).limit(1);
  return c.json(rows[0], 201);
});

discountRoutes.post("/:id/disable", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(discount).where(eq(discount.id, c.req.param("id"))).limit(1);
  const existing = rows[0];
  if (!existing) apiError("NOT_FOUND", "割引が見つかりません");
  if (!(await hasPermission(c, existing.circleId, "discount:write"))) {
    apiError("FORBIDDEN", "割引を変更する権限がありません");
  }
  await db.update(discount).set({ status: "disabled" }).where(eq(discount.id, existing.id));
  return c.json({ success: true });
});

// 2026-10-23: 「N個で○円」のセット割引。条件を満たした注文に自動適用されるため、
// レジ操作 (order:write) ではなく割引管理 (discount:*) の権限で設定する。
const createBundleSchema = z.object({
  title: z.string().trim().min(1).max(100),
  kind: z.enum(BUNDLE_KINDS),
  // 上限は誤入力 (例: 個数欄に金額) を弾くための実用的な値。
  bundleSize: z.number().int().min(2).max(50),
  value: z.number().int().min(0).max(1_000_000),
  menuIds: z.array(z.string().min(1)).min(1).max(50)
    .refine((ids) => new Set(ids).size === ids.length, "メニューが重複しています"),
}).refine((input) => isValidBundleValue(input.kind, input.value), {
  path: ["value"],
  message: "割引の種類に合った値を指定してください (セット価格は0円以上、円引きは1円以上、割引率は1〜100％、1個分無料は0)",
});

discountRoutes.get("/circle/:circleId/bundles", async (c) => {
  const circleId = c.req.param("circleId");
  if (!(await hasPermission(c, circleId, "discount:read"))) {
    apiError("FORBIDDEN", "セット割引を閲覧する権限がありません");
  }
  const db = c.get("db");
  const rows = await db.select().from(bundleDiscount)
    .where(eq(bundleDiscount.circleId, circleId))
    .orderBy(desc(bundleDiscount.createdAt));
  return c.json(await attachMenuIds(db, rows));
});

// 認証不要: 来場者のモバイル注文画面が合計金額を事前表示するために使う。
// 価格・対象メニューなど来場者に見えるメニュー情報だけを返し、内部の作成日時などは含めない。
discountRoutes.get("/circle/:circleId/bundles/active", async (c) => {
  const circleId = c.req.param("circleId");
  const db = c.get("db");
  const circleRows = await db.select({ id: circle.id }).from(circle)
    .innerJoin(event, eq(event.id, circle.eventId))
    .where(and(eq(circle.id, circleId), isNull(circle.deletedAt), isNull(event.deletedAt)))
    .limit(1);
  if (!circleRows[0]) apiError("NOT_FOUND", "サークルが見つかりません");
  const rules = await loadActiveBundleRules(db, circleId);
  return c.json(rules.map(({ id, title, kind, bundleSize, value, menuIds }) => ({ id, title, kind, bundleSize, value, menuIds })));
});

discountRoutes.post("/circle/:circleId/bundles", zBody(createBundleSchema), async (c) => {
  const circleId = c.req.param("circleId");
  if (!(await hasPermission(c, circleId, "discount:write"))) {
    apiError("FORBIDDEN", "セット割引を作成する権限がありません");
  }
  const input = c.req.valid("json");
  const db = c.get("db");
  // 他サークルのメニューを対象に混ぜて、そのサークルの売上へ影響させないようサークル所属を検証する。
  const menus = await db.select({ id: menu.id }).from(menu)
    .where(and(eq(menu.circleId, circleId), eq(menu.isArchived, false), inArray(menu.id, input.menuIds)));
  if (menus.length !== input.menuIds.length) {
    apiError("BAD_REQUEST", "このサークルで販売中のメニューを選んでください");
  }
  const id = ulid();
  // D1 batch で割引本体と対象メニューを一緒に保存し、対象なしのセット割引が残らないようにする。
  await db.batch([
    db.insert(bundleDiscount).values({
      id, circleId, title: input.title, kind: input.kind, bundleSize: input.bundleSize, value: input.value, status: "active",
    }),
    db.insert(bundleDiscountMenu).values(input.menuIds.map((menuId) => ({ bundleId: id, menuId }))),
  ]);
  const rows = await db.select().from(bundleDiscount).where(eq(bundleDiscount.id, id)).limit(1);
  return c.json((await attachMenuIds(db, rows))[0], 201);
});

discountRoutes.post("/bundles/:id/disable", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(bundleDiscount).where(eq(bundleDiscount.id, c.req.param("id"))).limit(1);
  const existing = rows[0];
  if (!existing) apiError("NOT_FOUND", "セット割引が見つかりません");
  if (!(await hasPermission(c, existing.circleId, "discount:write"))) {
    apiError("FORBIDDEN", "セット割引を変更する権限がありません");
  }
  await db.update(bundleDiscount).set({ status: "disabled" }).where(eq(bundleDiscount.id, existing.id));
  return c.json({ success: true });
});

export default discountRoutes;

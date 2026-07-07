import { Hono } from "hono";
import { z } from "zod";
import { db, staff } from "@fesflow/db";
import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hasPermission } from "../utils/auth";
import { apiError } from "../http-error";
import { zBody } from "../z-validator";

const staffRoutes = new Hono();

// スタッフ一覧取得
staffRoutes.get("/", async (c) => {
  const circleId = c.req.query("circleId");

  if (!circleId) {
    apiError("BAD_REQUEST", "circleIdが必要です");
  }

  // 2026-07-05: 認可チェックが皆無だったため追加（他サークルのスタッフ情報漏洩を防止）
  if (!(await hasPermission(c, circleId, "staff:read"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  const staffList = await db
    .select()
    .from(staff)
    .where(eq(staff.circleId, circleId));

  return c.json(staffList);
});

// スタッフ取得
staffRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const staffList = await db.select().from(staff).where(eq(staff.id, id));

  if (staffList.length === 0) {
    apiError("NOT_FOUND", "スタッフが見つかりません");
  }

  // 2026-07-05: 認可チェックが皆無だったため追加。対象スタッフのcircleIdで判定
  if (!(await hasPermission(c, staffList[0]!.circleId, "staff:read"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  return c.json(staffList[0]);
});

// スタッフ作成
staffRoutes.post(
  "/",
  zBody(
    z.object({
      circleId: z.string(),
      name: z.string().min(1, "スタッフ名は必須です"),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");

    // 2026-07-05: 認可チェックが皆無だったため追加
    if (!(await hasPermission(c, input.circleId, "staff:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const id = nanoid();

    await db.insert(staff).values({
      id,
      circleId: input.circleId,
      name: input.name,
    });

    return c.json({ id }, 201);
  }
);

// スタッフ更新
staffRoutes.put(
  "/:id",
  zBody(
    z.object({
      name: z.string().min(1).optional(),
    })
  ),
  async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");

    // 2026-07-05: 認可チェックが皆無だったため追加。対象のcircleIdを先に取得して判定
    const existingStaff = await db.select().from(staff).where(eq(staff.id, id));
    if (existingStaff.length === 0) {
      apiError("NOT_FOUND", "スタッフが見つかりません");
    }

    if (!(await hasPermission(c, existingStaff[0]!.circleId, "staff:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    if (input.name) {
      await db.update(staff).set({ name: input.name }).where(eq(staff.id, id));
    }

    return c.json({ success: true });
  }
);

// スタッフ削除
staffRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // 2026-07-05: 認可チェックが皆無だったため追加。対象のcircleIdを先に取得して判定
  const existingStaff = await db.select().from(staff).where(eq(staff.id, id));
  if (existingStaff.length === 0) {
    apiError("NOT_FOUND", "スタッフが見つかりません");
  }

  if (!(await hasPermission(c, existingStaff[0]!.circleId, "staff:delete"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  await db.delete(staff).where(eq(staff.id, id));
  return c.json({ success: true });
});

// 現在のシフト（出勤中で退勤していないスタッフ）
staffRoutes.get("/shift/current", async (c) => {
  const circleId = c.req.query("circleId");

  if (!circleId) {
    apiError("BAD_REQUEST", "circleIdが必要です");
  }

  // 2026-07-05: 認可チェックが皆無だったため追加
  if (!(await hasPermission(c, circleId, "staff:read"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  const staffList = await db
    .select()
    .from(staff)
    .where(and(eq(staff.circleId, circleId), isNull(staff.shiftEnd)));

  // shiftStartがnullでないスタッフのみ
  const currentShiftStaff = staffList.filter((s) => s.shiftStart !== null);

  return c.json(currentShiftStaff);
});

// 出勤
staffRoutes.post("/:id/clock-in", async (c) => {
  const id = c.req.param("id");

  // 2026-07-05: 認可チェックが皆無だったため追加。対象のcircleIdを先に取得して判定
  const existingStaff = await db.select().from(staff).where(eq(staff.id, id));
  if (existingStaff.length === 0) {
    apiError("NOT_FOUND", "スタッフが見つかりません");
  }

  if (!(await hasPermission(c, existingStaff[0]!.circleId, "staff:write"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  await db
    .update(staff)
    .set({ shiftStart: new Date(), shiftEnd: null })
    .where(eq(staff.id, id));

  return c.json({ success: true });
});

// 退勤
staffRoutes.post("/:id/clock-out", async (c) => {
  const id = c.req.param("id");

  // 2026-07-05: 認可チェックが皆無だったため追加。対象のcircleIdを先に取得して判定
  const existingStaff = await db.select().from(staff).where(eq(staff.id, id));
  if (existingStaff.length === 0) {
    apiError("NOT_FOUND", "スタッフが見つかりません");
  }

  if (!(await hasPermission(c, existingStaff[0]!.circleId, "staff:write"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  await db.update(staff).set({ shiftEnd: new Date() }).where(eq(staff.id, id));

  return c.json({ success: true });
});

export default staffRoutes;

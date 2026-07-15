import { Hono } from "hono";
import { z } from "zod";
import { staff } from "@fesflow/db";
import { eq } from "drizzle-orm";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import { apiError } from "../http-error";
import { zBody } from "../z-validator";
import type { AppEnv } from "../types";

const staffRoutes = new Hono<AppEnv>();

// スタッフ一覧取得
staffRoutes.get("/", async (c) => {
  const db = c.get("db");
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
  const db = c.get("db");
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
    const db = c.get("db");
    const input = c.req.valid("json");

    // 2026-07-05: 認可チェックが皆無だったため追加
    if (!(await hasPermission(c, input.circleId, "staff:write"))) {
      apiError("FORBIDDEN", "権限がありません");
    }

    const id = ulid();

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
    const db = c.get("db");
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
  const db = c.get("db");
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

// 2026-07-14: シフト機能 (GET /shift/current, POST /:id/clock-in, /:id/clock-out) を撤去。
// スタッフの出退勤・稼働時間追跡は使われていなかったため、スタッフ名簿の CRUD のみ残す。

export default staffRoutes;

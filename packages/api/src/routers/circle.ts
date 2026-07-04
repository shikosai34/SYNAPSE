import { z } from "zod";
import { router, publicProcedure } from "../index";
import { db, circle } from "@fesflow/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";

export const circleRouter = router({
  // サークル情報取得
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const circles = await db
        .select()
        .from(circle)
        .where(eq(circle.id, input.id));

      if (circles.length === 0) {
        throw new Error("サークルが見つかりません");
      }

      return circles[0];
    }),

  // サークル一覧取得
  list: publicProcedure
    .input(z.object({ eventId: z.string() }))
    .query(async ({ input }) => {
      return await db
        .select()
        .from(circle)
        .where(eq(circle.eventId, input.eventId));
    }),

  // サークル作成
  create: publicProcedure
    .input(
      z.object({
        eventId: z.string(),
        name: z.string(),
        password: z.string(),
        description: z.string().optional(),
        iconImagePath: z.string().optional(),
        backgroundImagePath: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const id = nanoid();
      // 2026-07-04: Cloudflare Workers の CPU 時間制限（最大50ms）超過による 500 エラーを避けるため、ソルトラウンドを 4 に引き下げ。
      const hashedPassword = await bcrypt.hash(input.password, 4);

      await db.insert(circle).values({
        id,
        eventId: input.eventId,
        name: input.name,
        password: hashedPassword,
        description: input.description,
        iconImagePath: input.iconImagePath,
        backgroundImagePath: input.backgroundImagePath,
      });

      return { id };
    }),

  // サークル情報更新
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        iconImagePath: z.string().optional(),
        backgroundImagePath: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input;
      await db.update(circle).set(updateData).where(eq(circle.id, id));

      return { success: true };
    }),

  // サークル削除
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(circle).where(eq(circle.id, input.id));
      return { success: true };
    }),
});

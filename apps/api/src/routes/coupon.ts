// coupon.ts: サークル限定クーポン (issue #50)。
// サークルが知り合い限定で使える割引を自分たちで作れるようにする機能。
// URL(slug)+合言葉の2要素で配布範囲を絞り、使用上限回数(maxRedemptions)で
// 合言葉が漏れた場合の被害を頭数分に抑える。実際の割引適用/消費は pre_order.ts の
// POST / (事前オーダー作成) 側で行い、ここはサークル側の管理 CRUD と、
// 来場者が合言葉を入力した直後のプレビュー検証 (/verify, 消費はしない) のみを扱う。
import { Hono } from "hono";
import { z } from "zod";
import { coupon, couponMenu, couponTopping, circle, menu, topping } from "@fesflow/db";
import { eq, desc, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ulid } from "ulidx";
import { hasPermission } from "../utils/auth";
import {
  checkCouponEligibility,
  getCouponMenuIds,
  getCouponMenuIdsBulk,
  getCouponToppingIds,
  getCouponToppingIdsBulk,
} from "../utils/coupon";
import { zBody } from "../z-validator";
import { AppError, apiError } from "../http-error";
import type { AppEnv } from "../types";

const couponRoutes = new Hono<AppEnv>();

// サークルのクーポン一覧 (管理画面用。合言葉も含めて返す = 作成者本人が確認できる必要があるため)
couponRoutes.get("/circle/:circleId", async (c) => {
  const db = c.get("db");
  const circleId = c.req.param("circleId");

  if (!(await hasPermission(c, circleId, "coupon:read"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  const rows = await db
    .select()
    .from(coupon)
    .where(eq(coupon.circleId, circleId))
    .orderBy(desc(coupon.createdAt));

  const ids = rows.map((r) => r.id);
  const [menuIdsByCoupon, toppingIdsByCoupon] = await Promise.all([
    getCouponMenuIdsBulk(db, ids),
    getCouponToppingIdsBulk(db, ids),
  ]);
  return c.json(
    rows.map((r) => ({
      ...r,
      menuIds: menuIdsByCoupon.get(r.id) ?? [],
      toppingIds: toppingIdsByCoupon.get(r.id) ?? [],
    }))
  );
});

// クーポン作成。kind (2026-09-16 フィードバック対応) で対象/割引の計算方式を切り替える。
// menu_discount: 対象メニューの小計から discountAmount 円引く。
// free_topping: 対象トッピングを freeUnits 個 (未指定=無制限) まで無料にする。
const baseCouponFields = {
  title: z.string().min(1).max(100),
  passphrase: z.string().min(1).max(50),
  // 未指定 = 使用回数無制限 (2026-09-16 フィードバック対応)。
  maxRedemptions: z.number().int().min(1).max(100000).optional(),
  // ISO 文字列 (任意)
  expiresAt: z.string().datetime().optional(),
};
const createCouponSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("menu_discount"),
    ...baseCouponFields,
    discountAmount: z.number().int().min(1),
    menuIds: z.array(z.string()).min(1, "対象メニューを1つ以上選んでください"),
  }),
  z.object({
    kind: z.literal("free_topping"),
    ...baseCouponFields,
    // 未指定 = 対象トッピングを個数上限なく全部無料にする ("自由度を無限にする" フィードバック対応)。
    freeUnits: z.number().int().min(1).optional(),
    toppingIds: z.array(z.string()).min(1, "対象トッピングを1つ以上選んでください"),
  }),
]);

couponRoutes.post(
  "/circle/:circleId",
  zBody(createCouponSchema),
  async (c) => {
    const db = c.get("db");
    try {
      const circleId = c.req.param("circleId");

      if (!(await hasPermission(c, circleId, "coupon:write"))) {
        apiError("FORBIDDEN", "権限がありません");
      }

      const circles = await db.select().from(circle).where(eq(circle.id, circleId));
      if (circles.length === 0) {
        apiError("NOT_FOUND", `サークル ${circleId} が存在しません`);
      }

      const body = c.req.valid("json");
      const id = ulid();

      if (body.kind === "menu_discount") {
        // クロスサークルIDOR対策 (pre_order.ts と同じ方針)。他サークルのメニューが混入していないか検証する。
        const menus = await db.select().from(menu).where(inArray(menu.id, body.menuIds));
        if (menus.length !== body.menuIds.length || menus.some((m) => m.circleId !== circleId)) {
          apiError("BAD_REQUEST", "指定されたメニューの一部が見つからないか、このサークルのものではありません");
        }
        await db.insert(coupon).values({
          id,
          circleId,
          title: body.title,
          slug: nanoid(16), // 配布URLに使うランダム文字列。合言葉と違ってサークル側が覚える必要はない。
          passphrase: body.passphrase,
          kind: "menu_discount",
          discountAmount: body.discountAmount,
          maxRedemptions: body.maxRedemptions,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
          status: "active",
        });
        for (const menuId of body.menuIds) {
          await db.insert(couponMenu).values({ id: ulid(), couponId: id, menuId });
        }
        const rows = await db.select().from(coupon).where(eq(coupon.id, id));
        return c.json({ ...rows[0], menuIds: body.menuIds, toppingIds: [] }, 201);
      } else {
        const toppings = await db.select().from(topping).where(inArray(topping.id, body.toppingIds));
        if (toppings.length !== body.toppingIds.length || toppings.some((t) => t.circleId !== circleId)) {
          apiError("BAD_REQUEST", "指定されたトッピングの一部が見つからないか、このサークルのものではありません");
        }
        await db.insert(coupon).values({
          id,
          circleId,
          title: body.title,
          slug: nanoid(16),
          passphrase: body.passphrase,
          kind: "free_topping",
          freeUnits: body.freeUnits,
          maxRedemptions: body.maxRedemptions,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
          status: "active",
        });
        for (const toppingId of body.toppingIds) {
          await db.insert(couponTopping).values({ id: ulid(), couponId: id, toppingId });
        }
        const rows = await db.select().from(coupon).where(eq(coupon.id, id));
        return c.json({ ...rows[0], menuIds: [], toppingIds: body.toppingIds }, 201);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error("Coupon creation error:", error);
      apiError("INTERNAL", "クーポンの作成に失敗しました");
    }
  }
);

// クーポン無効化 (削除ではなく status=disabled。既に配布済みのURL/合言葉を即座に使えなくする)
couponRoutes.post("/:id/disable", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");

  const rows = await db.select().from(coupon).where(eq(coupon.id, id));
  if (rows.length === 0) {
    apiError("NOT_FOUND", "クーポンが見つかりません");
  }
  const cp = rows[0]!;

  if (!(await hasPermission(c, cp.circleId, "coupon:write"))) {
    apiError("FORBIDDEN", "権限がありません");
  }

  await db.update(coupon).set({ status: "disabled" }).where(eq(coupon.id, id));
  return c.json({ success: true });
});

// 来場者が合言葉を入力した直後のプレビュー検証 (認証不要、消費はしない)。
// pre_order.ts の POST / が実際の消費 (使用回数+1 / 履歴記録) を担う。ここで OK が出ても
// 事前オーダー作成時点で再検証するため、二重に安全側になる。
couponRoutes.post(
  "/verify",
  zBody(
    z.object({
      slug: z.string().min(1),
      passphrase: z.string().min(1),
      eventUserId: z.string().min(1),
    })
  ),
  async (c) => {
    const db = c.get("db");
    const { slug, passphrase, eventUserId } = c.req.valid("json");
    const cp = await checkCouponEligibility(db, { slug, passphrase, eventUserId });
    const [menuIds, toppingIds] = await Promise.all([
      cp.kind === "menu_discount" ? getCouponMenuIds(db, cp.id) : Promise.resolve([]),
      cp.kind === "free_topping" ? getCouponToppingIds(db, cp.id) : Promise.resolve([]),
    ]);
    return c.json({
      couponId: cp.id,
      circleId: cp.circleId,
      title: cp.title,
      kind: cp.kind,
      discountAmount: cp.discountAmount,
      freeUnits: cp.freeUnits,
      menuIds,
      toppingIds,
    });
  }
);

export default couponRoutes;

import { z } from "zod";

// 2026-10-03: 注文の境界を共有し、画面の手書き型と Worker の入力検証のずれを防ぐ。
// 件数の上限は同期処理と D1 のバインド数を制御するため。DB 側の分割処理も併用する。
export const ORDER_STATUSES = ["pending", "preparing", "ready", "completed", "cancelled"] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const createOrderSchema = z.object({
  circleId: z.string().min(1),
  userId: z.string().min(1),
  cashierId: z.string().optional(),
  peopleCount: z.number().int().positive().default(1),
  paymentMethod: z.string().max(30).optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    menuId: z.string().min(1),
    quantity: z.number().int().positive(),
    toppingIds: z.array(z.string().min(1)).max(20)
      .refine((ids) => new Set(ids).size === ids.length, "トッピングは重複して指定できません")
      .optional(),
  })).min(1).max(50),
});

export const createOrderResultSchema = z.object({
  id: z.string().min(1),
  orderNumber: z.string().min(1),
});

export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type CreateOrderResult = z.infer<typeof createOrderResultSchema>;

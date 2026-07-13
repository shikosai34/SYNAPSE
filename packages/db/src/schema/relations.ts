// relations.ts: 全ドメインを横断する drizzle relations() 定義の集約先。
//
// なぜ集約するか: drizzle の relations() は「テーブルごとに1回」しか定義できず、
// 同じテーブルに対して複数回呼ぶと後勝ちで上書きされてしまう。event/circle/menu/
// eventUser 等は複数ドメイン (core/menu/order/visitor/lottery) から参照される
// ハブテーブルであるため、各ドメインファイルに分散して relations() を書くと
// 上書き事故が起きる。そこで全テーブルが出揃うこのファイルに一本化する。
import { relations } from "drizzle-orm";
import { event, circle, staff, membership, inviteToken } from "./core";
import { menu, topping, menuTopping } from "./menu";
import {
  order,
  orderItem,
  orderItemTopping,
  preOrder,
  preOrderItem,
  preOrderItemTopping,
} from "./order";
import {
  eventUser,
  wristband,
  circleVisit,
  numberedTicket,
  review,
  userStamp,
} from "./visitor";
import { lottery, lotteryPrize, lotteryEntry, lotteryWinner } from "./lottery";

// --- core ---
export const eventRelations = relations(event, ({ many }) => ({
  circles: many(circle),
}));

export const circleRelations = relations(circle, ({ one, many }) => ({
  event: one(event, {
    fields: [circle.eventId],
    references: [event.id],
  }),
  menus: many(menu),
  toppings: many(topping),
  orders: many(order),
  staff: many(staff),
  preOrders: many(preOrder),
  circleVisits: many(circleVisit),
  numberedTickets: many(numberedTicket),
  reviews: many(review),
  userStamps: many(userStamp),
}));

export const staffRelations = relations(staff, ({ one }) => ({
  circle: one(circle, {
    fields: [staff.circleId],
    references: [circle.id],
  }),
}));

export const membershipRelations = relations(membership, ({ one }) => ({
  circle: one(circle, {
    fields: [membership.circleId],
    references: [circle.id],
  }),
  event: one(event, {
    fields: [membership.eventId],
    references: [event.id],
  }),
}));

export const inviteTokenRelations = relations(inviteToken, ({ one }) => ({
  circle: one(circle, {
    fields: [inviteToken.circleId],
    references: [circle.id],
  }),
  event: one(event, {
    fields: [inviteToken.eventId],
    references: [event.id],
  }),
}));

// --- menu ---
export const menuRelations = relations(menu, ({ one, many }) => ({
  circle: one(circle, {
    fields: [menu.circleId],
    references: [circle.id],
  }),
  menuToppings: many(menuTopping),
  orderItems: many(orderItem),
  preOrderItems: many(preOrderItem),
}));

export const toppingRelations = relations(topping, ({ one, many }) => ({
  circle: one(circle, {
    fields: [topping.circleId],
    references: [circle.id],
  }),
  menuToppings: many(menuTopping),
  orderItemToppings: many(orderItemTopping),
  preOrderItemToppings: many(preOrderItemTopping),
}));

export const menuToppingRelations = relations(menuTopping, ({ one }) => ({
  menu: one(menu, {
    fields: [menuTopping.menuId],
    references: [menu.id],
  }),
  topping: one(topping, {
    fields: [menuTopping.toppingId],
    references: [topping.id],
  }),
}));

// --- order ---
export const orderRelations = relations(order, ({ one, many }) => ({
  circle: one(circle, {
    fields: [order.circleId],
    references: [circle.id],
  }),
  orderItems: many(orderItem),
}));

export const orderItemRelations = relations(orderItem, ({ one, many }) => ({
  order: one(order, {
    fields: [orderItem.orderId],
    references: [order.id],
  }),
  menu: one(menu, {
    fields: [orderItem.menuId],
    references: [menu.id],
  }),
  orderItemToppings: many(orderItemTopping),
}));

export const orderItemToppingRelations = relations(
  orderItemTopping,
  ({ one }) => ({
    orderItem: one(orderItem, {
      fields: [orderItemTopping.orderItemId],
      references: [orderItem.id],
    }),
    topping: one(topping, {
      fields: [orderItemTopping.toppingId],
      references: [topping.id],
    }),
  })
);

export const preOrderRelations = relations(preOrder, ({ one, many }) => ({
  user: one(eventUser, {
    fields: [preOrder.userId],
    references: [eventUser.id],
  }),
  circle: one(circle, {
    fields: [preOrder.circleId],
    references: [circle.id],
  }),
  items: many(preOrderItem),
}));

export const preOrderItemRelations = relations(preOrderItem, ({ one, many }) => ({
  preOrder: one(preOrder, {
    fields: [preOrderItem.preOrderId],
    references: [preOrder.id],
  }),
  menu: one(menu, {
    fields: [preOrderItem.menuId],
    references: [menu.id],
  }),
  preOrderItemToppings: many(preOrderItemTopping),
}));

export const preOrderItemToppingRelations = relations(
  preOrderItemTopping,
  ({ one }) => ({
    preOrderItem: one(preOrderItem, {
      fields: [preOrderItemTopping.preOrderItemId],
      references: [preOrderItem.id],
    }),
    topping: one(topping, {
      fields: [preOrderItemTopping.toppingId],
      references: [topping.id],
    }),
  })
);

// --- visitor ---
export const eventUserRelations = relations(eventUser, ({ one, many }) => ({
  event: one(event, {
    fields: [eventUser.eventId],
    references: [event.id],
  }),
  wristbands: many(wristband),
  preOrders: many(preOrder),
}));

export const wristbandRelations = relations(wristband, ({ one }) => ({
  user: one(eventUser, {
    fields: [wristband.userId],
    references: [eventUser.id],
  }),
}));

export const userStampRelations = relations(userStamp, ({ one }) => ({
  circle: one(circle, {
    fields: [userStamp.circleId],
    references: [circle.id],
  }),
}));

// --- lottery ---
export const lotteryRelations = relations(lottery, ({ one, many }) => ({
  event: one(event, {
    fields: [lottery.eventId],
    references: [event.id],
  }),
  prizes: many(lotteryPrize),
  entries: many(lotteryEntry),
  winners: many(lotteryWinner),
}));

export const lotteryPrizeRelations = relations(lotteryPrize, ({ one, many }) => ({
  lottery: one(lottery, {
    fields: [lotteryPrize.lotteryId],
    references: [lottery.id],
  }),
  winners: many(lotteryWinner),
}));

export const lotteryEntryRelations = relations(lotteryEntry, ({ one }) => ({
  lottery: one(lottery, {
    fields: [lotteryEntry.lotteryId],
    references: [lottery.id],
  }),
  user: one(eventUser, {
    fields: [lotteryEntry.eventUserId],
    references: [eventUser.id],
  }),
}));

export const lotteryWinnerRelations = relations(lotteryWinner, ({ one }) => ({
  lottery: one(lottery, {
    fields: [lotteryWinner.lotteryId],
    references: [lottery.id],
  }),
  prize: one(lotteryPrize, {
    fields: [lotteryWinner.prizeId],
    references: [lotteryPrize.id],
  }),
  user: one(eventUser, {
    fields: [lotteryWinner.eventUserId],
    references: [eventUser.id],
  }),
}));

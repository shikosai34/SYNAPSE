import { describe, expect, it } from "vitest";
import {
	event,
	circle,
	eventUser,
	menu,
	order,
	orderItem,
	orderItemTopping,
	topping,
	wristband,
} from "@fesflow/db";
import { request, testDb, uid } from "./helpers";

/**
 * 来場者の注文履歴 GET /api/orders/user/:code のテスト。
 * - eventUser.id / リストバンドID の双方で本人注文を取得できること
 * - トッピングのスナップショットが付くこと
 * - cashierId / paymentMethod 等の内部情報が漏れないこと
 */
async function seed() {
	const db = testDb();
	const eventId = uid("ev");
	const circleId = uid("ci");
	const menuId = uid("me");
	const userId = uid("usr");

	await db.insert(event).values({ id: eventId, eventName: "テスト学園祭" });
	await db.insert(circle).values({ id: circleId, eventId, name: "テスト模擬店" });
	await db.insert(menu).values({
		id: menuId,
		circleId,
		name: "テストやきそば",
		price: 500,
		imagePath: "dummy.png",
		soldOut: false,
	});
	await db.insert(eventUser).values({ id: userId, eventId, displayId: 1 });

	return { db, eventId, circleId, menuId, userId };
}

async function insertOrder(
	db: ReturnType<typeof testDb>,
	opts: {
		circleId: string;
		userId: string;
		menuId: string;
		withTopping?: boolean;
	}
) {
	const orderId = uid("ord");
	const orderItemId = uid("oi");
	await db.insert(order).values({
		id: orderId,
		userId: opts.userId,
		circleId: opts.circleId,
		orderNumber: uid("num"),
		peopleCount: 1,
		totalPrice: opts.withTopping ? 600 : 500,
		status: "completed",
		completed: true,
		cashierId: "secret-cashier",
		paymentMethod: "cash",
	});
	await db.insert(orderItem).values({
		id: orderItemId,
		orderId,
		menuId: opts.menuId,
		menuName: "テストやきそば",
		menuPrice: 500,
		quantity: 1,
	});
	if (opts.withTopping) {
		// orderItemTopping.toppingId は topping.id への FK のため実体を先に作る
		const toppingId = uid("top");
		await db.insert(topping).values({
			id: toppingId,
			circleId: opts.circleId,
			name: "大盛り",
			price: 100,
			soldOut: false,
		});
		await db.insert(orderItemTopping).values({
			id: uid("oit"),
			orderItemId,
			toppingId,
			toppingName: "大盛り",
			toppingPrice: 100,
		});
	}
	return { orderId };
}

describe("来場者の注文履歴", () => {
	it("eventUser.id で本人のレジ通過注文を取得でき、内部情報は漏れない", async () => {
		const { db, circleId, menuId, userId } = await seed();
		const { orderId } = await insertOrder(db, {
			circleId,
			userId,
			menuId,
			withTopping: true,
		});

		const res = await request(`/api/orders/user/${userId}`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as any[];
		expect(data).toHaveLength(1);
		expect(data[0].id).toBe(orderId);
		expect(data[0].circleName).toBe("テスト模擬店");
		expect(data[0].items).toHaveLength(1);
		expect(data[0].items[0].toppings).toHaveLength(1);
		expect(data[0].items[0].toppings[0].name).toBe("大盛り");

		// 内部情報 (レジ担当・支払い方法) は本人ビューに含めない
		expect(data[0].cashierId).toBeUndefined();
		expect(data[0].paymentMethod).toBeUndefined();
	});

	it("リストバンドID (active) からも本人の注文を取得できる", async () => {
		const { db, circleId, menuId, userId } = await seed();
		const wbId = uid("wb");
		await db.insert(wristband).values({
			id: wbId,
			userId,
			status: "active",
		});
		const { orderId } = await insertOrder(db, { circleId, userId, menuId });

		const res = await request(`/api/orders/user/${wbId}`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as any[];
		expect(data).toHaveLength(1);
		expect(data[0].id).toBe(orderId);
	});

	it("未知のコードは空配列を返す", async () => {
		const res = await request(`/api/orders/user/${uid("nobody")}`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as any[];
		expect(data).toHaveLength(0);
	});
});

import { describe, expect, it } from "vitest";
import { circle, event, eventUser, menu } from "@fesflow/db";
import { postJson, testDb, uid } from "./helpers";

async function seedMenu(input: { inventoryEnabled: boolean; stockQuantity: number }) {
	const db = testDb();
	const eventId = uid("ev");
	const circleId = uid("ci");
	const menuId = uid("me");
	const userId = uid("usr");
	await db.insert(event).values({ id: eventId, eventName: "在庫テスト祭" });
	await db.insert(circle).values({ id: circleId, eventId, name: "テスト模擬店" });
	await db.insert(eventUser).values({ id: userId, eventId, displayId: 1 });
	await db.insert(menu).values({
		id: menuId,
		circleId,
		name: "在庫テスト商品",
		price: 300,
		imagePath: "",
		soldOut: false,
		inventoryEnabled: input.inventoryEnabled,
		stockQuantity: input.stockQuantity,
	});
	return { db, circleId, menuId, userId };
}

describe("POS注文の商品別在庫", () => {
	it("在庫管理OFFの商品は在庫数があっても注文で減算しない", async () => {
		const { db, circleId, menuId, userId } = await seedMenu({ inventoryEnabled: false, stockQuantity: 5 });
		const response = await postJson("/api/orders", {
			circleId,
			userId,
			items: [{ menuId, quantity: 2 }],
		});
		expect(response.status).toBe(201);
		const rows = await db.select().from(menu);
		expect(rows.find((row) => row.id === menuId)!.stockQuantity).toBe(5);
	});

	it("在庫管理ONで残数0の商品は売切フラグ未設定でも注文を拒否する", async () => {
		const { db, circleId, menuId, userId } = await seedMenu({ inventoryEnabled: true, stockQuantity: 0 });
		const response = await postJson("/api/orders", {
			circleId,
			userId,
			items: [{ menuId, quantity: 1 }],
		});
		expect(response.status).toBe(400);
		const rows = await db.select().from(menu);
		expect(rows.find((row) => row.id === menuId)!.stockQuantity).toBe(0);
	});
});

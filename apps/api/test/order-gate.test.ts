/**
 * 注文の wristband ゲート (2026-07-06 の「発行しないと使えない」方針) の回帰テスト。
 * 未発行の userId から eventUser を自動作成する抜け穴 (自己発行) が復活していないことを守る。
 * D1 はテスト間で共有されるため、シードは uid() の一意 ID で行う (helpers.ts 参照)。
 */
import { describe, expect, it } from "vitest";
import { event, circle, eventUser } from "@fesflow/db";
import { postJson, testDb, uid } from "./helpers";

async function seedCircle() {
	const db = testDb();
	const eventId = uid("ev");
	const circleId = uid("ci");
	await db.insert(event).values({ id: eventId, eventName: uid("テスト学園祭") });
	await db.insert(circle).values({
		id: circleId,
		eventId,
		name: "テスト模擬店",
		password: "dummy-hash",
	});
	return { eventId, circleId };
}

describe("注文の wristband ゲート", () => {
	it("未発行の userId での注文は 403 (自己発行の抜け穴なし)", async () => {
		const { circleId } = await seedCircle();
		const res = await postJson("/api/orders", {
			circleId,
			userId: uid("not-issued"),
			items: [{ menuId: "m1", quantity: 1 }],
		});
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: string };
		expect(data.error).toContain("リストバンド");
	});

	it("発行済み userId なら wristband ゲートは通過する", async () => {
		const { eventId, circleId } = await seedCircle();
		const db = testDb();
		const userId = uid("issued");
		await db.insert(eventUser).values({
			id: userId,
			eventId,
			displayId: 1,
		});
		const res = await postJson("/api/orders", {
			circleId,
			userId,
			items: [],
		});
		// メニュー未登録のため注文自体の成否はここでは問わない。
		// ゲート (403/リストバンド) を通過していることだけを確認する。
		expect(res.status).not.toBe(403);
	});

	it("存在しないサークルへの注文は 404", async () => {
		const res = await postJson("/api/orders", {
			circleId: uid("no-such-circle"),
			userId: uid("u"),
			items: [],
		});
		expect(res.status).toBe(404);
	});
});

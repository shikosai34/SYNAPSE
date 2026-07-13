import { describe, expect, it } from "vitest";
import { event, circle, eventUser, menu, membership, wristband } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

// テスト対象と同等のID抽出ロジック (app/src/lib/utils.ts に実装されているもの)
function extractIdFromCode(code: string): string {
	const trimmed = code.trim();
	// 1. /w/usr_xxxx などの URL から ID を抽出する
	const wMatch = trimmed.match(/\/w\/([a-zA-Z0-9_\-]+)/);
	if (wMatch && wMatch[1]) {
		return wMatch[1];
	}
	// 2. ?wb=usr_xxxx などの URL またはクエリから ID を抽出する
	const wbMatch = trimmed.match(/[?&]wb=([a-zA-Z0-9_\-]+)/);
	if (wbMatch && wbMatch[1]) {
		return wbMatch[1];
	}
	return trimmed;
}

async function signUpAndGetCookie(): Promise<{ cookie: string; email: string }> {
	const email = `${uid("preorder")}@example.com`;
	const res = await postJson("/api/auth/sign-up/email", {
		email,
		password: "correct-horse-battery-staple",
		name: "テストユーザー",
	});
	expect(res.status).toBeLessThan(400);
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	const cookie = raw.map((c) => c.split(";")[0]).join("; ");
	return { cookie, email };
}

async function seedTestData() {
	const db = testDb();
	const eventId = uid("ev");
	const circleId = uid("ci");
	const menuId = uid("me");
	const userId = uid("usr");

	// 1. イベント作成
	await db.insert(event).values({
		id: eventId,
		eventName: "テスト学園祭",
	});

	// 2. サークル作成
	await db.insert(circle).values({
		id: circleId,
		eventId,
		name: "テスト模擬店",
	});

	// 3. メニュー作成
	await db.insert(menu).values({
		id: menuId,
		circleId,
		name: "テストやきそば",
		price: 500,
		imagePath: "dummy.png",
		soldOut: false,
	});

	// 4. ユーザー（来場者）作成
	await db.insert(eventUser).values({
		id: userId,
		eventId,
		displayId: 1,
	});

	return { eventId, circleId, menuId, userId };
}

describe("事前オーダー機能", () => {
	it("事前オーダーの作成、取得、確定の一連のライフサイクルが正しく機能する", async () => {
		const db = testDb();
		const { circleId, menuId, userId } = await seedTestData();
		const { cookie, email } = await signUpAndGetCookie();

		// スタッフのメンバーシップを追加 (claim 権限 order:write を持たせるため)
		// circle_manager ロールなら order:write 権限がある
		const memId = uid("mem");
		await db.insert(membership).values({
			id: memId,
			userEmail: email,
			userName: "テストスタッフ",
			circleId,
			role: "circle_manager",
			isActive: true,
		});

		// 1. 事前オーダーの作成 (POST /api/pre-orders)
		const createRes = await postJson("/api/pre-orders", {
			userId,
			circleId,
			items: [
				{ menuId, quantity: 2 }
			]
		});
		expect(createRes.status).toBe(201);
		const createData = (await createRes.json()) as { id: string; totalPrice: number };
		expect(createData.id).toBeDefined();
		expect(createData.totalPrice).toBe(1000);

		// 2. 事前オーダーの取得 (GET /api/pre-orders/user/:code)
		const getRes = await request(`/api/pre-orders/user/${userId}?circleId=${circleId}`);
		expect(getRes.status).toBe(200);
		const getData = (await getRes.json()) as any[];
		expect(getData).toHaveLength(1);
		expect(getData[0].id).toBe(createData.id);

		// 3. 事前オーダーの確定 (POST /api/pre-orders/:id/claim)
		const claimRes = await request(`/api/pre-orders/${createData.id}/claim`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookie,
				"X-Active-Membership-Id": memId,
			},
			body: JSON.stringify({
				cashierId: "test-cashier",
			}),
		});
		expect(claimRes.status).toBe(200);
		const claimData = (await claimRes.json()) as { success: boolean; orderId: string; orderNumber: string };
		expect(claimData.success).toBe(true);

		// 4. 確定後に pending 状態でなくなっていることを確認
		const getAfterClaimRes = await request(`/api/pre-orders/user/${userId}?circleId=${circleId}`);
		expect(getAfterClaimRes.status).toBe(200);
		const getAfterClaimData = (await getAfterClaimRes.json()) as any[];
		expect(getAfterClaimData).toHaveLength(0);
	});

	it("ID抽出処理 (extractIdFromCode) が新旧URL形式と生のIDを正しく処理できる", () => {
		// 生のID
		expect(extractIdFromCode("usr_1234")).toBe("usr_1234");
		
		// 新しいURL形式 (/w/ID)
		expect(extractIdFromCode("https://fesflow.shikosai.net/w/usr_5678")).toBe("usr_5678");
		expect(extractIdFromCode("http://localhost:3001/w/01ARZ3NDEKTS")).toBe("01ARZ3NDEKTS");
		
		// 古いURL形式 (?wb=ID)
		expect(extractIdFromCode("https://fesflow.shikosai.net/circle/checkin?wb=usr_9012")).toBe("usr_9012");
		expect(extractIdFromCode("http://localhost:3001/circle/checkin?wb=01ARZ3NDEKTS")).toBe("01ARZ3NDEKTS");
		expect(extractIdFromCode("https://fesflow.shikosai.net/circle/checkin?other=123&wb=usr_3456&foo=bar")).toBe("usr_3456");
	});

	it("紛失した (lost) リストバンドIDを指定した場合、事前オーダーは取得できない", async () => {
		const db = testDb();
		const { circleId, menuId, userId } = await seedTestData();

		// activeなリストバンドと、lostなリストバンドを作成
		const activeWbId = uid("wb-active");
		const lostWbId = uid("wb-lost");

		await db.insert(wristband).values({
			id: activeWbId,
			userId,
			status: "active",
		});
		await db.insert(wristband).values({
			id: lostWbId,
			userId,
			status: "lost",
		});

		// 事前オーダー作成
		await postJson("/api/pre-orders", {
			userId,
			circleId,
			items: [{ menuId, quantity: 1 }]
		});

		// 1. active なリストバンドIDでの取得 -> 取得できるはず
		const resActive = await request(`/api/pre-orders/user/${activeWbId}?circleId=${circleId}`);
		expect(resActive.status).toBe(200);
		const dataActive = (await resActive.json()) as any[];
		expect(dataActive).toHaveLength(1);

		// 2. lost なリストバンドIDでの取得 -> 取得できないはず (空配列が返る)
		const resLost = await request(`/api/pre-orders/user/${lostWbId}?circleId=${circleId}`);
		expect(resLost.status).toBe(200);
		const dataLost = (await resLost.json()) as any[];
		expect(dataLost).toHaveLength(0);
	});
});

/**
 * メニュー在庫の絶対値更新 (PATCH /api/menus/:id/stock) の回帰テスト。
 *
 * 背景 (2026-07-17): apps/app の menuApi.updateStock がボディに { stock } を送っており、
 * サーバ側 zBody スキーマ ({ stockQuantity }) と食い違って常に 400 VALIDATION になっていた。
 * トッピング側 (PUT /api/toppings/:id/stock) は最初から stockQuantity を送っていたため
 * 動作しており、「トッピングだけ在庫変更できる」という非対称な症状になっていた。
 *
 * クライアントとサーバのボディ契約が再びずれた場合にここで落とす。
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circle, event, membership, menu } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

function extractCookieHeader(res: Response): string {
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

/**
 * stock:write を持つ circle_manager でログインし、在庫管理対象のメニューを 1 件用意する。
 * 書き込み系は X-Active-Membership-Id でアクティブスペースの明示が必須 (auth-boundary.test.ts 参照)。
 */
async function seedManagerWithMenu() {
	const email = `${uid("stockmgr")}@example.com`;
	const signUp = await postJson("/api/auth/sign-up/email", {
		email,
		password: "correct-horse-battery-staple",
		name: "サークル代表",
	});
	expect(signUp.status).toBeLessThan(400);
	const cookie = extractCookieHeader(signUp);

	const db = testDb();
	const eventId = uid("ev");
	const circleId = uid("ci");
	const membershipId = uid("mem");
	const menuId = uid("me");

	await db.insert(event).values({ id: eventId, eventName: uid("テスト学園祭") });
	await db.insert(circle).values({ id: circleId, eventId, name: uid("テスト模擬店") });
	await db.insert(membership).values({
		id: membershipId,
		userEmail: email.toLowerCase(),
		userName: "サークル代表",
		circleId,
		role: "circle_manager",
		isActive: true,
	});
	// 売り切れ状態から補充するケースを検証するため soldOut: true / 在庫 0 で作る。
	await db.insert(menu).values({
		id: menuId,
		circleId,
		name: uid("焼きそば"),
		price: 500,
		imagePath: "",
		soldOut: true,
		stockQuantity: 0,
	});

	const headers = {
		"Content-Type": "application/json",
		Cookie: cookie,
		"X-Active-Membership-Id": membershipId,
	};
	return { db, menuId, headers };
}

describe("メニュー在庫の絶対値更新", () => {
	it("{ stockQuantity } を送ると在庫が更新され、補充時は売切が自動解除される", async () => {
		const { db, menuId, headers } = await seedManagerWithMenu();

		const res = await request(`/api/menus/${menuId}/stock`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ stockQuantity: 12 }),
		});
		expect(res.status).toBe(200);

		const rows = await db.select().from(menu).where(eq(menu.id, menuId));
		expect(rows[0]!.stockQuantity).toBe(12);
		expect(rows[0]!.soldOut).toBe(false);
	});

	// 旧クライアントのボディ形。契約ずれの再発をここで検知する。
	it("{ stock } (旧クライアントのキー) は 400 VALIDATION で拒否される", async () => {
		const { db, menuId, headers } = await seedManagerWithMenu();

		const res = await request(`/api/menus/${menuId}/stock`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ stock: 12 }),
		});
		expect(res.status).toBe(400);
		const data = (await res.json()) as { code: string; fields?: Record<string, string> };
		expect(data.code).toBe("VALIDATION");
		expect(data.fields).toHaveProperty("stockQuantity");

		// 在庫が書き換わっていないことも確認する (症状そのもの)。
		const rows = await db.select().from(menu).where(eq(menu.id, menuId));
		expect(rows[0]!.stockQuantity).toBe(0);
	});

	it("在庫 0 への更新では soldOut に触れない (0 = 無制限/未管理の既存挙動を尊重)", async () => {
		const { db, menuId, headers } = await seedManagerWithMenu();

		const res = await request(`/api/menus/${menuId}/stock`, {
			method: "PATCH",
			headers,
			body: JSON.stringify({ stockQuantity: 0 }),
		});
		expect(res.status).toBe(200);

		const rows = await db.select().from(menu).where(eq(menu.id, menuId));
		expect(rows[0]!.stockQuantity).toBe(0);
		expect(rows[0]!.soldOut).toBe(true);
	});
});

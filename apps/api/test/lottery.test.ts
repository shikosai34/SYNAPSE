/**
 * 抽選 (イベント単位) の回帰テスト。
 * event_manager が抽選を作成→景品追加→応募者を用意→抽選実行→当選者確定 までを検証する。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { membership, lottery, lotteryEntry, lotteryWinner, eventUser } from "@fesflow/db";
import { request, testDb, uid } from "./helpers";

function cookieOf(res: Response): string {
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}
async function signUp(prefix: string) {
	const email = `${uid(prefix)}@example.com`;
	const res = await request("/api/auth/sign-up/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: "correct-horse-battery-staple", name: prefix }),
	});
	expect(res.status).toBeLessThan(400);
	return { cookie: cookieOf(res), email };
}

describe("抽選", () => {
	it("作成→景品→応募→抽選実行で当選者が確定する", async () => {
		const owner = await signUp("lottery");
		const db = testDb();

		const evRes = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie },
			body: JSON.stringify({ eventName: uid("抽選祭") }),
		});
		const { id: eventId } = (await evRes.json()) as { id: string };
		const em = await db
			.select()
			.from(membership)
			.where(and(eq(membership.eventId, eventId), eq(membership.role, "event_manager")));
		const auth = { Cookie: owner.cookie, "X-Active-Membership-Id": em[0]!.id, "Content-Type": "application/json" };

		// 抽選を有効化
		await request(`/api/festivals/${eventId}/lottery-enabled`, {
			method: "PUT",
			headers: auth,
			body: JSON.stringify({ enabled: true }),
		});

		// 抽選作成 (全員1口の等確率)
		const create = await request("/api/lottery", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ eventId, name: "テスト抽選", entryConfig: { base: 1, perStamp: 0, perReview: 0 } }),
		});
		expect(create.status).toBeLessThan(300);
		const { id: lotteryId } = (await create.json()) as { id: string };

		// 景品 (当選1)
		const prize = await request(`/api/lottery/${lotteryId}/prizes`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "図書カード", quantity: 1 }),
		});
		expect(prize.status).toBe(201);

		// 応募者を2名用意 (eventUser + lotteryEntry を直挿し)
		for (let i = 1; i <= 2; i++) {
			const uId = uid("eu");
			await db.insert(eventUser).values({ id: uId, eventId, displayId: i, nickname: `来場者${i}` });
			await db.insert(lotteryEntry).values({ id: uid("le"), lotteryId, eventUserId: uId });
		}

		// 抽選実行
		const draw = await request(`/api/lottery/${lotteryId}/draw`, { method: "POST", headers: auth });
		expect(draw.status).toBe(200);
		expect(((await draw.json()) as { drawn: number }).drawn).toBe(1);

		// 当選者が1名 + status=drawn
		const winners = await db.select().from(lotteryWinner).where(eq(lotteryWinner.lotteryId, lotteryId));
		expect(winners).toHaveLength(1);
		const lot = await db.select().from(lottery).where(eq(lottery.id, lotteryId));
		expect(lot[0]!.status).toBe("drawn");
	});

	it("権限のないユーザーの抽選取得は 403", async () => {
		const owner = await signUp("lowner");
		const evRes = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie },
			body: JSON.stringify({ eventName: uid("非公開抽選") }),
		});
		const { id: eventId } = (await evRes.json()) as { id: string };
		const outsider = await signUp("loutsider");
		const res = await request(`/api/lottery?eventId=${eventId}`, { headers: { Cookie: outsider.cookie } });
		expect(res.status).toBe(403);
	});
});

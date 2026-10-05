/**
 * 高度な権限管理 (event.advancedPermissions) の回帰テスト (2026-10-05)。
 * OFF (既定) のイベントではサークル所属の circle_staff が circle_manager 相当で評価され、
 * ON では従来どおり権限差 (staff に sales:read なし) が効くことを守る。
 * 判定の入り口が hasPermission と checkMemberWritePermission の2か所あるため両方を検証する。
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { event, circle, membership } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

function extractCookieHeader(res: Response): string {
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

async function seedStaff(advancedPermissions?: boolean, role: "circle_staff" | "circle_manager" = "circle_staff") {
	const email = `${uid("adv")}@example.com`;
	const res = await postJson("/api/auth/sign-up/email", {
		email,
		password: "correct-horse-battery-staple",
		name: "スタッフ",
	});
	expect(res.status).toBeLessThan(400);
	const cookie = extractCookieHeader(res);

	const db = testDb();
	const eventId = uid("ev");
	const circleId = uid("ci");
	const membershipId = uid("mb");
	await db.insert(event).values({
		id: eventId,
		eventName: uid("テスト学園祭"),
		...(advancedPermissions === undefined ? {} : { advancedPermissions }),
	});
	await db.insert(circle).values({ id: circleId, eventId, name: "テスト模擬店" });
	await db.insert(membership).values({
		id: membershipId,
		userEmail: email.toLowerCase(),
		userName: "スタッフ",
		circleId,
		eventId,
		role,
		isActive: true,
	});
	return { cookie, eventId, circleId, membershipId };
}

const headers = (s: { cookie: string; membershipId: string }) => ({
	Cookie: s.cookie,
	"X-Active-Membership-Id": s.membershipId,
});

describe("高度な権限管理", () => {
	it("既定 (OFF) では circle_staff も sales:read を要する API に入れる", async () => {
		const s = await seedStaff();
		const res = await request(`/api/circles/${s.circleId}/analytics`, { headers: headers(s) });
		expect(res.status).toBe(200);
	});

	it("ON では circle_staff は従来どおり sales:read がなく 403", async () => {
		const s = await seedStaff(true);
		const res = await request(`/api/circles/${s.circleId}/analytics`, { headers: headers(s) });
		expect(res.status).toBe(403);
	});

	it("OFF → ON → OFF と切り替えても membership.role は書き換わらず、評価だけが変わる", async () => {
		const s = await seedStaff(false);
		const db = testDb();
		await db.update(event).set({ advancedPermissions: true }).where(eq(event.id, s.eventId));
		expect((await request(`/api/circles/${s.circleId}/analytics`, { headers: headers(s) })).status).toBe(403);
		await db.update(event).set({ advancedPermissions: false }).where(eq(event.id, s.eventId));
		expect((await request(`/api/circles/${s.circleId}/analytics`, { headers: headers(s) })).status).toBe(200);
		const rows = await db.select().from(membership).where(eq(membership.id, s.membershipId));
		expect(rows[0]!.role).toBe("circle_staff");
	});

	it("メンバー管理 (招待の発行) はオーナーのみ。OFF でも一般スタッフは 403", async () => {
		const staffOff = await seedStaff(false);
		const owner = await seedStaff(false, "circle_manager");
		const invite = (s: typeof owner) =>
			postJson(
				"/api/memberships/invite",
				{ circleId: s.circleId, role: "circle_staff" },
				headers(s),
			);
		expect((await invite(staffOff)).status).toBe(403);
		expect((await invite(owner)).status).toBeLessThan(400);
	});

	it("サークル基本情報の変更とオーナー譲渡はオーナーのみ (OFF でも一般スタッフは 403)", async () => {
		const staff = await seedStaff(false);
		const owner = await seedStaff(false, "circle_manager");
		const put = (s: typeof owner) =>
			request(`/api/circles/${s.circleId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json", ...headers(s) },
				body: JSON.stringify({ name: "新しい名前" }),
			});
		expect((await put(staff)).status).toBe(403);
		expect((await put(owner)).status).toBe(200);

		const transfer = await postJson(
			`/api/circles/${staff.circleId}/transfer-owner`,
			{ membershipId: staff.membershipId },
			headers(staff),
		);
		expect(transfer.status).toBe(403);
	});

	it("運用設定 (settings) は OFF なら一般スタッフも変更できる", async () => {
		const staff = await seedStaff(false);
		const res = await request(`/api/circles/${staff.circleId}/settings`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", ...headers(staff) },
			body: JSON.stringify({ settings: { orderFlowMode: "pending" } }),
		});
		expect(res.status).toBe(200);
	});

	it("別サークルの circle_staff は OFF でも他サークルには入れない", async () => {
		const a = await seedStaff(false);
		const b = await seedStaff(false);
		const res = await request(`/api/circles/${b.circleId}/analytics`, { headers: headers(a) });
		expect(res.status).toBe(403);
	});

	it("切り替え API は event_manager だけが実行できる", async () => {
		const s = await seedStaff(false);
		const res = await request(`/api/festivals/${s.eventId}/advanced-permissions`, {
			method: "PUT",
			headers: { "Content-Type": "application/json", ...headers(s) },
			body: JSON.stringify({ enabled: true }),
		});
		expect(res.status).toBe(403);
	});
});

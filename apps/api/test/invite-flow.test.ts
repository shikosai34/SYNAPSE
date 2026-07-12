/**
 * Phase B (招待駆動オンボーディング) の回帰テスト。
 *
 * - circle_host 招待: イベント主催者 (event_manager) が「サークル作成用」の招待を発行し、
 *   別ユーザーがその招待でサークルを作成すると circle_manager になる。招待は消費される。
 * - 招待無し・非主催者のサークル作成は 403 (誰でも任意イベントに作れない)。
 * - 招待コード(手入力) / token(リンク) どちらでも lookup できる。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { inviteToken, membership } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

function extractCookieHeader(res: Response): string {
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

async function signUp(prefix: string): Promise<{ cookie: string; email: string }> {
	const email = `${uid(prefix)}@example.com`;
	const res = await postJson("/api/auth/sign-up/email", {
		email,
		password: "correct-horse-battery-staple",
		name: prefix,
	});
	expect(res.status).toBeLessThan(400);
	return { cookie: extractCookieHeader(res), email };
}

async function createEvent(cookie: string, name: string): Promise<string> {
	const res = await request("/api/festivals", {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: cookie },
		body: JSON.stringify({ eventName: name }),
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { id: string }).id;
}

describe("招待駆動のサークル作成", () => {
	it("circle_host 招待でサークルを作成でき、招待が消費される", async () => {
		// 主催者がイベント作成 → maxCircles を増やして 2 サークル許容にする
		const host = await signUp("host");
		const eventId = await createEvent(host.cookie, uid("招待祭"));
		const db = testDb();
		const { event } = await import("@fesflow/db");
		await db.update(event).set({ maxCircles: 5 }).where(eq(event.id, eventId));

		// 主催者が circle_host 招待 (eventId + role=circle_manager, circleId 無し) を発行
		const invRes = await request("/api/memberships/invite", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: host.cookie },
			body: JSON.stringify({
				eventId,
				role: "circle_manager",
				expiresInHours: 24,
				maxUses: 3,
				createdBy: host.email,
			}),
		});
		expect(invRes.status).toBe(201);
		const { token, code } = (await invRes.json()) as { token: string; code: string };
		expect(code).toMatch(/^[A-Z0-9]{8}$/);

		// 別ユーザーが code で lookup → circle_host と分かる
		const rep = await signUp("rep");
		const lookup = await request(`/api/memberships/invite/lookup?code=${code}`, {
			headers: { Cookie: rep.cookie },
		});
		expect(lookup.status).toBe(200);
		const info = (await lookup.json()) as { kind: string; eventId: string };
		expect(info.kind).toBe("circle_host");
		expect(info.eventId).toBe(eventId);

		// 招待 token を渡してサークル作成 → circle_manager になる
		const circleRes = await request("/api/circles", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: rep.cookie },
			body: JSON.stringify({ eventId, name: uid("招待サークル"), inviteToken: token }),
		});
		expect(circleRes.status).toBe(201);
		const { id: circleId } = (await circleRes.json()) as { id: string };

		const mgr = await db
			.select()
			.from(membership)
			.where(and(eq(membership.circleId, circleId), eq(membership.role, "circle_manager")));
		expect(mgr).toHaveLength(1);
		expect(mgr[0]!.userEmail.toLowerCase()).toBe(rep.email.toLowerCase());

		// 招待が 1 消費された
		const tok = await db.select().from(inviteToken).where(eq(inviteToken.token, token));
		expect(tok[0]!.usedCount).toBe(1);
	});

	it("招待無し・非主催者のサークル作成は 403", async () => {
		const host = await signUp("host2");
		const eventId = await createEvent(host.cookie, uid("拒否祭"));

		const outsider = await signUp("outsider");
		const res = await request("/api/circles", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: outsider.cookie },
			body: JSON.stringify({ eventId, name: uid("勝手サークル") }),
		});
		expect(res.status).toBe(403);
	});
});

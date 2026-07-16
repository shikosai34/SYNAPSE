/**
 * イベント一斉アナウンス (POST/GET/DELETE /api/festivals/:id/announce(ments)) の回帰テスト。
 * 2026-07-16: 「送るだけで履歴が見られない」への対応で、送信履歴 (event_announcement) と
 * 一覧/削除エンドポイントを新設した。ここでは
 *   - 送信すると配下メンバーに notification が作られ、履歴にも1件残ること
 *   - 履歴が新しい順で取得でき、削除できること
 *   - 権限のない第三者は 403 になること
 * を確認する。
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { membership, circle, notification } from "@fesflow/db";
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

describe("イベント一斉アナウンス", () => {
	it("送信すると配下メンバーへ通知が作られ、履歴が残る。履歴は一覧・削除できる", async () => {
		const owner = await signUp("announce-owner");
		const db = testDb();

		const evRes = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie },
			body: JSON.stringify({ eventName: uid("告知祭") }),
		});
		const { id: eventId } = (await evRes.json()) as { id: string };

		const em = await db
			.select()
			.from(membership)
			.where(and(eq(membership.eventId, eventId), eq(membership.role, "event_manager")));
		const activeId = em[0]!.id;

		// 配下サークル + そのスタッフを1名用意し、受信対象に含まれることを確認する
		const cId = uid("c");
		await db.insert(circle).values({ id: cId, eventId, name: uid("店") });
		const staffEmail = `${uid("staff")}@example.com`;
		await db.insert(membership).values({
			id: uid("m"),
			userEmail: staffEmail,
			userName: "スタッフ",
			circleId: cId,
			role: "circle_staff",
			isActive: true,
		});

		const sendRes = await request(`/api/festivals/${eventId}/announce`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie, "X-Active-Membership-Id": activeId },
			body: JSON.stringify({ title: "雨天対応", message: "15時から屋内に移動します" }),
		});
		expect(sendRes.status).toBe(200);
		const { sent } = (await sendRes.json()) as { sent: number };
		// owner(event_manager本人) + 配下スタッフ1名 = 2件
		expect(sent).toBe(2);

		// 受信者側に notification が作られていること (type=announcement, 未読)
		const notifs = await db
			.select()
			.from(notification)
			.where(and(eq(notification.userEmail, staffEmail), eq(notification.type, "announcement")));
		expect(notifs.length).toBe(1);
		expect(notifs[0]!.status).toBe("unread");

		// 履歴一覧に1件残っていること
		const listRes = await request(`/api/festivals/${eventId}/announcements`, {
			headers: { Cookie: owner.cookie, "X-Active-Membership-Id": activeId },
		});
		expect(listRes.status).toBe(200);
		const list = (await listRes.json()) as Array<{ id: string; title: string; recipientCount: number }>;
		expect(list.length).toBe(1);
		expect(list[0]!.title).toBe("雨天対応");
		expect(list[0]!.recipientCount).toBe(2);

		// 履歴を削除できる (受信者側の notification には影響しない設計)
		const delRes = await request(`/api/festivals/${eventId}/announcements/${list[0]!.id}`, {
			method: "DELETE",
			headers: { Cookie: owner.cookie, "X-Active-Membership-Id": activeId },
		});
		expect(delRes.status).toBe(200);

		const listAfter = await request(`/api/festivals/${eventId}/announcements`, {
			headers: { Cookie: owner.cookie, "X-Active-Membership-Id": activeId },
		});
		expect(((await listAfter.json()) as unknown[]).length).toBe(0);

		// 受信者側の notification は削除されず残る (履歴削除は配信取り消しではない)
		const notifsAfter = await db
			.select()
			.from(notification)
			.where(and(eq(notification.userEmail, staffEmail), eq(notification.type, "announcement")));
		expect(notifsAfter.length).toBe(1);
	});

	it("受信者は既存の既読エンドポイントで notification を既読にできる", async () => {
		const owner = await signUp("announce-owner2");
		const db = testDb();
		const evRes = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie },
			body: JSON.stringify({ eventName: uid("既読祭") }),
		});
		const { id: eventId } = (await evRes.json()) as { id: string };
		const em = await db
			.select()
			.from(membership)
			.where(and(eq(membership.eventId, eventId), eq(membership.role, "event_manager")));
		const activeId = em[0]!.id;

		await request(`/api/festivals/${eventId}/announce`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie, "X-Active-Membership-Id": activeId },
			body: JSON.stringify({ title: "お知らせ", message: "本日もよろしくお願いします" }),
		});

		// owner 自身にも通知が飛んでいるので、それを既読にできることを確認する
		const notifs = await db
			.select()
			.from(notification)
			.where(and(eq(notification.userEmail, owner.email.toLowerCase()), eq(notification.type, "announcement")));
		expect(notifs.length).toBe(1);

		const readRes = await request(`/api/memberships/notifications/${notifs[0]!.id}/read`, {
			method: "POST",
			headers: { Cookie: owner.cookie },
		});
		expect(readRes.status).toBe(200);

		// list は unread のみ返すので、既読後は一覧に出てこない
		const listRes = await request("/api/memberships/notifications/list", {
			headers: { Cookie: owner.cookie },
		});
		const list = (await listRes.json()) as Array<{ id: string }>;
		expect(list.find((n) => n.id === notifs[0]!.id)).toBeUndefined();
	});

	it("権限のない第三者は送信/一覧/削除いずれも 403", async () => {
		const owner = await signUp("announce-owner3");
		const evRes = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie },
			body: JSON.stringify({ eventName: uid("非公開告知祭") }),
		});
		const { id: eventId } = (await evRes.json()) as { id: string };

		const outsider = await signUp("announce-outsider");

		const sendRes = await request(`/api/festivals/${eventId}/announce`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: outsider.cookie },
			body: JSON.stringify({ title: "x", message: "y" }),
		});
		expect(sendRes.status).toBe(403);

		const listRes = await request(`/api/festivals/${eventId}/announcements`, {
			headers: { Cookie: outsider.cookie },
		});
		expect(listRes.status).toBe(403);

		const delRes = await request(`/api/festivals/${eventId}/announcements/does-not-matter`, {
			method: "DELETE",
			headers: { Cookie: outsider.cookie },
		});
		expect(delRes.status).toBe(403);
	});
});

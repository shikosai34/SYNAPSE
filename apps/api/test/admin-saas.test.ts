/**
 * Phase C (SaaS 運営コンソール) の回帰テスト。
 * - 非 super_admin は /api/admin/* が 403。
 * - super_admin はイベント一覧/概要を取得でき、契約(課金)を手動更新できる。
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, event, membership, systemSetting } from "@fesflow/db";
import { env } from "cloudflare:test";
import { readCleanupRetentionDays } from "../src/services/cleanup";
import { request, testDb, uid } from "./helpers";

function extractCookieHeader(res: Response): string {
	const raw =
		(res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
		(res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
	return raw.map((c) => c.split(";")[0]).join("; ");
}

async function signUp(prefix: string): Promise<{ cookie: string; email: string }> {
	const email = `${uid(prefix)}@example.com`;
	const res = await request("/api/auth/sign-up/email", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password: "correct-horse-battery-staple", name: prefix }),
	});
	expect(res.status).toBeLessThan(400);
	return { cookie: extractCookieHeader(res), email };
}

async function makeSuperAdmin(email: string) {
	const db = testDb();
	await db.insert(membership).values({
		id: uid("m"),
		userEmail: email.toLowerCase(),
		userName: "SA",
		role: "super_admin",
		isActive: true,
	});
}

describe("SaaS 運営コンソール (admin)", () => {
	it("非 super_admin は /api/admin/events が 403", async () => {
		const u = await signUp("nonadmin");
		const res = await request("/api/admin/events", { headers: { Cookie: u.cookie } });
		expect(res.status).toBe(403);
	});

	it("super_admin はイベント一覧と概要を取得し、契約を更新できる", async () => {
		// 一般ユーザーが無料枠でイベント作成
		const owner = await signUp("owner");
		const evRes = await request("/api/festivals", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: owner.cookie },
			body: JSON.stringify({ eventName: uid("運営対象祭") }),
		});
		const { id: eventId } = (await evRes.json()) as { id: string };

		// super_admin を用意
		const admin = await signUp("admin");
		await makeSuperAdmin(admin.email);

		// 一覧に対象イベントが含まれる
		const list = await request("/api/admin/events", { headers: { Cookie: admin.cookie } });
		expect(list.status).toBe(200);
		const events = (await list.json()) as Array<{ id: string; plan: string; maxCircles: number }>;
		expect(events.some((e) => e.id === eventId)).toBe(true);

		// 概要
		const ov = await request("/api/admin/overview", { headers: { Cookie: admin.cookie } });
		expect(ov.status).toBe(200);

		// 契約更新: plan=standard, maxCircles=20, suspended
		const patch = await request(`/api/admin/events/${eventId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: admin.cookie },
			body: JSON.stringify({ plan: "standard", maxCircles: 20, billingStatus: "suspended" }),
		});
		expect(patch.status).toBe(200);

		const db = testDb();
		const rows = await db.select().from(event).where(eq(event.id, eventId));
		expect(rows[0]!.plan).toBe("standard");
		expect(rows[0]!.maxCircles).toBe(20);
		expect(rows[0]!.billingStatus).toBe("suspended");
		expect(rows[0]!.suspendedAt).not.toBeNull();
	});

	it("システム管理者はイベント保持日数を既定365日で確認し、30〜3650日の範囲で保存できる", async () => {
		const key = "cleanup_retention";
		const db = testDb();
		await db.delete(systemSetting).where(eq(systemSetting.key, key));
		const admin = await signUp("retention-admin");
		await makeSuperAdmin(admin.email);
		const headers = { Cookie: admin.cookie };
		try {
			const initial = await request("/api/admin/settings", { headers });
			expect(initial.status).toBe(200);
			expect(await initial.json()).toMatchObject({
				cleanup: { retentionDays: 365, dryRun: true },
			});

			const update = (retentionDays: number) => request("/api/admin/settings", {
				method: "PUT",
				headers: { ...headers, "Content-Type": "application/json" },
				body: JSON.stringify({ cleanup: { retentionDays } }),
			});
			expect((await update(30)).status).toBe(200);
			const saved = await request("/api/admin/settings", { headers });
			expect(await saved.json()).toMatchObject({ cleanup: { retentionDays: 30, dryRun: true } });
			expect(await readCleanupRetentionDays(env.DB)).toBe(30);
			expect((await update(29)).status).toBe(400);
			expect((await update(3651)).status).toBe(400);
			const logs = await db.select().from(auditLog).where(eq(auditLog.actorEmail, admin.email.toLowerCase()));
			expect(logs.some((entry) => entry.action === "system_setting_update" && entry.summary?.includes("保持期間"))).toBe(true);
		} finally {
			await db.delete(systemSetting).where(eq(systemSetting.key, key));
		}
	});
});

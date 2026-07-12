/**
 * Phase D/E (sudo 昇格 + なりすまし + 内容分離 + 監査) の回帰テスト。
 *
 * - super_admin は素の状態ではテナント内容 (menu:write) にアクセスできない (403)。
 * - 昇格 (sudo) はパスキー再認証直後 (=セッションが新しい) の super_admin のみ。
 * - なりすましは要 sudo。開始後はそのサークルの内容操作が通る。
 * - なりすまし中の変更操作と開始は監査ログに記録される。
 * - なりすまし停止で内容分離が復活する。
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { membership, auditLog } from "@fesflow/db";
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
function j(cookie: string, extra: Record<string, string> = {}) {
	return { "Content-Type": "application/json", Cookie: cookie, ...extra };
}

describe("sudo + なりすまし + 内容分離", () => {
	it("super_admin は昇格→なりすまし経由でのみテナント内容を操作でき、監査される", async () => {
		// オーナーがイベント+サークルを用意
		const owner = await signUp("owner");
		const evRes = await request("/api/festivals", {
			method: "POST",
			headers: j(owner.cookie),
			body: JSON.stringify({ eventName: uid("なりすまし祭") }),
		});
		const { id: eventId } = (await evRes.json()) as { id: string };
		const cRes = await request("/api/circles", {
			method: "POST",
			headers: j(owner.cookie),
			body: JSON.stringify({ eventId, name: uid("対象サークル") }),
		});
		const { id: circleId } = (await cRes.json()) as { id: string };

		// super_admin を用意 (membership を直接挿入)
		const admin = await signUp("admin");
		const db = testDb();
		const saMembershipId = uid("m");
		await db.insert(membership).values({
			id: saMembershipId,
			userEmail: admin.email.toLowerCase(),
			userName: "SA",
			role: "super_admin",
			isActive: true,
		});

		const menuBody = () => JSON.stringify({ circleId, name: uid("メニュー"), price: 300 });

		// (1) 内容分離: super_admin が super_admin スペースで menu:write → 403
		const isolated = await request("/api/menus", {
			method: "POST",
			headers: j(admin.cookie, { "X-Active-Membership-Id": saMembershipId }),
			body: menuBody(),
		});
		expect(isolated.status).toBe(403);

		// (2) 昇格前のなりすましは 403 SUDO_REQUIRED
		const noSudo = await request("/api/admin/impersonate", {
			method: "POST",
			headers: j(admin.cookie),
			body: JSON.stringify({ role: "circle_manager", circleId }),
		});
		expect(noSudo.status).toBe(403);
		expect(((await noSudo.json()) as { code: string }).code).toBe("SUDO_REQUIRED");

		// (3) 昇格 (サインアップ直後=セッションが新しいので許可される)
		const elevate = await request("/api/admin/sudo/elevate", {
			method: "POST",
			headers: j(admin.cookie),
		});
		expect(elevate.status).toBe(200);
		expect(((await elevate.json()) as { elevated: boolean }).elevated).toBe(true);

		// (4) なりすまし開始 (circle_manager as circle)
		const imp = await request("/api/admin/impersonate", {
			method: "POST",
			headers: j(admin.cookie),
			body: JSON.stringify({ role: "circle_manager", circleId }),
		});
		expect(imp.status).toBe(200);

		// (5) なりすまし中は当該サークルの menu:write が通る (ヘッダ不要)
		const asImp = await request("/api/menus", {
			method: "POST",
			headers: j(admin.cookie),
			body: menuBody(),
		});
		expect(asImp.status).toBe(201);

		// (6) 監査ログに impersonate_start と impersonated_write
		const audits = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.actorEmail, admin.email.toLowerCase()));
		const actions = audits.map((a) => a.action);
		expect(actions).toContain("elevate");
		expect(actions).toContain("impersonate_start");
		expect(actions).toContain("impersonated_write");

		// (7) 停止で内容分離が復活
		const stop = await request("/api/admin/impersonate/stop", {
			method: "POST",
			headers: j(admin.cookie),
		});
		expect(stop.status).toBe(200);
		const afterStop = await request("/api/menus", {
			method: "POST",
			headers: j(admin.cookie, { "X-Active-Membership-Id": saMembershipId }),
			body: menuBody(),
		});
		expect(afterStop.status).toBe(403);
	});
});

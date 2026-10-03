/** 2026-10-03: ログの機密非露出・認証失敗の並列計数・Cron削除の安全境界を実Workerで確認する。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authAttempt, event, circle, eventUser, order, lottery } from "@fesflow/db";
import { eq } from "drizzle-orm";
import { AppError, registerErrorHandlers } from "../src/http-error";
import { requestObservability, successSampleRate } from "../src/middleware/observability";
import { cleanupMustDryRun, cleanupStatements, RETENTION_MS, runCleanup } from "../src/services/cleanup";
import { identityAttemptKey, recordFailure, retryAfterSeconds, clearAttempts } from "../src/utils/rate-limit";
import type { AppEnv } from "../src/types";
import { testDb, uid } from "./helpers";

const headers = { "User-Agent": "OpenAI File Downloader, XaiImageApiFetch/1.0" };
afterEach(() => vi.restoreAllMocks());

describe("request observability", () => {
  const makeApp = () => {
    const app = new Hono<AppEnv>();
    registerErrorHandlers(app);
    app.use("/*", requestObservability);
    return app;
  };
  it("success and errors share server IDs without logging identifiers, body or SQL", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp();
    app.post("/people/:id", (c) => c.json({ ok: true }));
    app.get("/errors/:id", () => { throw new AppError("INTERNAL", "SELECT secret password FROM users", { fields: { secret: "private" } }); });
    app.get("/exceptions", () => { throw new HTTPException(500, { message: "binding secret" }); });
    for (const [path, method] of [["/people/private-qr?token=private", "POST"], ["/errors/private-email", "GET"], ["/exceptions", "GET"], ["/unknown/private-qr", "GET"]]) {
      const res = await app.request(path!, { method, headers: { ...headers, "X-Request-ID": "untrusted-id" }, ...(method === "POST" ? { body: "private-body" } : {}) }, { ...env, REQUEST_LOG_SAMPLE_RATE: "1" });
      expect(res.headers.get("X-Request-ID")).toBeTruthy();
      expect(res.headers.get("X-Request-ID")).not.toBe("untrusted-id");
      if (res.status >= 400) {
        const body = await res.json() as { requestId: string; message: string; fields?: unknown };
        expect(body.requestId).toBe(res.headers.get("X-Request-ID"));
        if (res.status >= 500) {
          expect(body.message).toBe("サーバーエラーが発生しました");
          expect(body.fields).toBeUndefined();
        }
      }
    }
    const records = log.mock.calls.map(([entry]) => JSON.parse(String(entry)));
    expect(records).toHaveLength(4);
    expect(records[0].route).toBe("/people/:id");
    expect(records[1].route).toBe("/errors/:id");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|password|SELECT|binding|untrusted/);
    expect(error).not.toHaveBeenCalled();
  });
  it("samples successes but always records errors", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = makeApp();
    app.get("/ok", (c) => c.text("ok"));
    await app.request("/ok", { headers }, { ...env, REQUEST_LOG_SAMPLE_RATE: "0" });
    await app.request("/missing", { headers }, { ...env, REQUEST_LOG_SAMPLE_RATE: "0" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(successSampleRate(undefined)).toBe(0.01);
    expect(successSampleRate("NaN")).toBe(0.01);
    expect(successSampleRate("2")).toBe(0.01);
  });
});

describe("atomic auth failure recording", () => {
	it("stores only HMAC login identifiers and progressively delays each identifier independently", async () => {
		const db = testDb();
		const key = await identityAttemptKey("test-secret", "email", "alice@example.com");
		const otherKey = await identityAttemptKey("test-secret", "email", "bob@example.com");
		const now = 1_800_000_000_000;
		const cfg = { windowMs: 10_000, baseDelayMs: 1000, maxDelayMs: 4000 };
		expect(key).not.toContain("alice@example.com");
		expect(key).not.toBe(otherKey);
		await recordFailure(db, [{ key, scope: "email" }], cfg, now);
		expect(await retryAfterSeconds(db, [key], now)).toBe(1);
		expect(await retryAfterSeconds(db, [otherKey], now)).toBe(0);
		await recordFailure(db, [{ key, scope: "email" }], cfg, now + 1001);
		expect(await retryAfterSeconds(db, [key], now + 1001)).toBe(2);
		await recordFailure(db, [{ key, scope: "email" }], cfg, now + 3002);
		expect(await retryAfterSeconds(db, [key], now + 3002)).toBe(4);
		const [backingOff] = await db.select().from(authAttempt).where(eq(authAttempt.key, key));
		expect(backingOff?.failedCount).toBe(3);
		await recordFailure(db, [{ key, scope: "email" }], cfg, now + 10_001);
		const [reset] = await db.select().from(authAttempt).where(eq(authAttempt.key, key));
		expect(reset?.failedCount).toBe(1);
		expect(reset?.firstFailedAt.getTime()).toBe(now + 10_001);
		await clearAttempts(db, [key]);
	});

	it("records concurrent failures atomically and caps progressive delay without a long lockout", async () => {
		const db = testDb();
		const key = uid("runtime-auth-concurrent");
		const now = 1_800_000_000_000;
		const cfg = { windowMs: 10_000, baseDelayMs: 1000, maxDelayMs: 4000 };
		await Promise.all(Array.from({ length: 20 }, () => recordFailure(db, [{ key, scope: "passkey" }], cfg, now)));
		const [attempt] = await db.select().from(authAttempt).where(eq(authAttempt.key, key));
		expect(attempt?.failedCount).toBe(20);
		expect(await retryAfterSeconds(db, [key], now)).toBe(4);
		await recordFailure(db, [{ key, scope: "passkey" }], cfg, now + 10_001);
		const [reset] = await db.select().from(authAttempt).where(eq(authAttempt.key, key));
		expect(reset?.failedCount).toBe(1);
		expect(reset?.firstFailedAt.getTime()).toBe(now + 10_001);
		await clearAttempts(db, [key]);
	});
});

describe("event deletion approval gate", () => {
	it("keeps the scheduled cleanup in dry-run until policy approval enables deletion", () => {
		expect(cleanupMustDryRun({})).toBe(true);
		expect(cleanupMustDryRun({ CLEANUP_DRY_RUN: "false" })).toBe(true);
		expect(cleanupMustDryRun({ CLEANUP_ENABLED: "true" })).toBe(false);
		expect(cleanupMustDryRun({ CLEANUP_ENABLED: "true", CLEANUP_DRY_RUN: "true" })).toBe(true);
	});
});

describe("lifecycle-safe retention", () => {
  const seeded: string[] = [];
  const now = 1_800_000_000_000;
  const cutoff = now - RETENTION_MS;
  async function seed(status: string, end = cutoff - 1) {
    const db = testDb();
    const eventId = uid("cleanup-event");
    const circleId = uid("cleanup-circle");
    const userId = uid("cleanup-user");
    const orderId = uid("cleanup-order");
    await db.insert(event).values({ id: eventId, eventName: "Retention fixture", lifecycleStatus: status, endDate: new Date(end) });
    seeded.push(eventId);
    await db.insert(circle).values({ id: circleId, eventId, name: "Fixture" });
    await db.insert(eventUser).values({ id: userId, eventId, displayId: 1 });
    await db.insert(order).values({ id: orderId, circleId, orderNumber: orderId, peopleCount: 1, totalPrice: 300 });
    return { eventId, circleId, userId, orderId };
  }
  const userExists = async (id: string) => (await testDb().select().from(eventUser).where(eq(eventUser.id, id))).length > 0;
  afterEach(async () => {
    for (const id of seeded.splice(0)) await testDb().delete(event).where(eq(event.id, id));
  });
  it("protects live/upcoming/null dates/exact retention boundary with dry-run and retry", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const live = await seed("live");
    const upcoming = await seed("upcoming");
    const ended = await seed("ended");
    const archived = await seed("archived");
    const boundary = await seed("ended", cutoff);
    const noDate = await seed("ended");
    await testDb().update(event).set({ endDate: null }).where(eq(event.id, noDate.eventId));
    const preview = await runCleanup(env.DB, { now, dryRun: true });
    expect(preview.changes.event_user).toBeGreaterThanOrEqual(2);
    expect(await userExists(ended.userId)).toBe(true);
    await runCleanup(env.DB, { now });
    for (const value of [live, upcoming, boundary, noDate]) expect(await userExists(value.userId)).toBe(true);
    for (const value of [ended, archived]) expect(await userExists(value.userId)).toBe(false);
    const repeat = await runCleanup(env.DB, { now });
    expect(repeat.changes.event_user).toBe(0);
  });
  it("rechecks lifecycle at deletion even when selected earlier", async () => {
    const fixture = await seed("ended");
    const statements = cleanupStatements(env.DB, fixture.eventId, cutoff);
    await testDb().update(event).set({ lifecycleStatus: "live" }).where(eq(event.id, fixture.eventId));
    await env.DB.batch(statements);
    expect(await userExists(fixture.userId)).toBe(true);
  });
  it("rolls back all tables for an event when a late deletion fails", async () => {
    const fixture = await seed("ended");
    await testDb().insert(lottery).values({ id: uid("cleanup-lottery"), eventId: fixture.eventId, name: "Fixture" });
    const triggerName = uid("cleanup_failure").replaceAll("-", "_");
    await env.DB.exec(`CREATE TRIGGER ${triggerName} BEFORE DELETE ON lottery WHEN OLD.event_id = '${fixture.eventId}' BEGIN SELECT RAISE(ABORT, 'injected retention failure'); END;`);
    try {
      await expect(env.DB.batch(cleanupStatements(env.DB, fixture.eventId, cutoff))).rejects.toThrow();
      expect(await userExists(fixture.userId)).toBe(true);
      expect((await testDb().select().from(order).where(eq(order.id, fixture.orderId)))).toHaveLength(1);
    } finally {
      await env.DB.exec(`DROP TRIGGER ${triggerName}`);
    }
  });
});

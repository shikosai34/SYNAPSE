import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contractPayment, event, membership, stripeWebhookEvent } from "@fesflow/db";
import { postJson, request, testDb, uid } from "./helpers";

// 2026-11-04: Checkout RESTと署名付きWebhookの状態遷移を、Stripe APIへ接続せず検証する。
function extractCookieHeader(res: Response): string {
  const raw = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  return raw.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function createOwnedEvent(): Promise<{ cookie: string; eventId: string; membershipId: string }> {
  const email = `${uid("billing")}@example.com`;
  const signedUp = await postJson("/api/auth/sign-up/email", { email, password: "correct-horse-battery-staple", name: "課金テスト" });
  const cookie = extractCookieHeader(signedUp);
  const created = await postJson("/api/festivals", { eventName: uid("決済イベント") }, { Cookie: cookie });
  const { id: eventId } = await created.json() as { id: string };
  // 2026-11-04: 権限判定は X-Active-Membership-Id で明示された所属だけを使うため、作成時に発行された所属IDを引いて返す。
  const [owned] = await testDb().select().from(membership).where(and(eq(membership.eventId, eventId), eq(membership.userEmail, email)));
  return { cookie, eventId, membershipId: owned!.id };
}

async function stripeSignature(payload: string, timestamp = Math.floor(Date.now() / 1000)): Promise<string> {
  const secret = "whsec_test_mock";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("Stripe billing", () => {
  it("creates Checkout with server configured prices and origin-based return URLs", async () => {
    const { cookie, eventId, membershipId } = await createOwnedEvent();
    let requestBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body);
      return Response.json({ id: "cs_test", url: "https://checkout.stripe.com/c/pay", customer: "cus_test" });
    }));

    const response = await postJson("/api/billing/checkout", { eventId, maxCircles: 5 }, { Cookie: cookie, "X-Active-Membership-Id": membershipId });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/c/pay" });
    const form = new URLSearchParams(requestBody);
    expect(form.get("line_items[0][price]")).toBe("price_event_mock");
    expect(form.get("line_items[1][price]")).toBe("price_circles_5_mock");
    expect(form.get("metadata[maxCircles]")).toBe("5");
    expect(form.get("success_url")).toBe("http://localhost/event/dashboard?tab=contract&payment=success");
    const [saved] = await testDb().select().from(event).where(eq(event.id, eventId));
    expect(saved?.stripeCustomerId).toBe("cus_test");
  });

  it("rejects unsigned webhook requests", async () => {
    const response = await postJson("/api/billing/webhook", { id: "evt_invalid", type: "checkout.session.completed" });
    expect(response.status).toBe(400);
  });

  it("verifies signature, activates the event, records payment and ignores replay", async () => {
    const { eventId } = await createOwnedEvent();
    const stripeEvent = {
      id: uid("evt_checkout"),
      type: "checkout.session.completed",
      data: { object: {
        id: "cs_test_paid", payment_status: "paid", amount_total: 12500, currency: "jpy", customer: "cus_paid",
        metadata: { eventId, maxCircles: "5" },
      } },
    };
    const payload = JSON.stringify(stripeEvent);
    const signature = await stripeSignature(payload);
    const sendWebhook = () => request("/api/billing/webhook", {
      method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body: payload,
    });

    const first = await sendWebhook();
    expect(first.status).toBe(200);
    const replay = await sendWebhook();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });

    const db = testDb();
    const [updated] = await db.select().from(event).where(eq(event.id, eventId));
    expect(updated).toMatchObject({ plan: "standard", billingStatus: "active", maxCircles: 5, billingAmount: 12500, stripeCustomerId: "cus_paid" });
    expect(updated?.activatedAt).toBeInstanceOf(Date);
    expect(await db.select().from(contractPayment).where(and(eq(contractPayment.eventId, eventId), eq(contractPayment.method, "Stripe")))).toHaveLength(1);
    expect(await db.select().from(stripeWebhookEvent).where(eq(stripeWebhookEvent.id, stripeEvent.id))).toHaveLength(1);
  });

  it("rejects stale webhook timestamps", async () => {
    const payload = JSON.stringify({ id: "evt_stale", type: "checkout.session.completed" });
    const signature = await stripeSignature(payload, Math.floor(Date.now() / 1000) - 600);
    const response = await request("/api/billing/webhook", {
      method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": signature }, body: payload,
    });
    expect(response.status).toBe(400);
  });

  it("waits for asynchronous payment success before activation", async () => {
    const { eventId } = await createOwnedEvent();
    const send = async (id: string, type: string, paymentStatus: string) => {
      const payload = JSON.stringify({ id, type, data: { object: {
        id: "cs_async", payment_status: paymentStatus, amount_total: 5000, currency: "jpy",
        metadata: { eventId, maxCircles: "1" },
      } } });
      return request("/api/billing/webhook", {
        method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": await stripeSignature(payload) }, body: payload,
      });
    };

    const pending = await send("evt_async_pending", "checkout.session.completed", "unpaid");
    expect(pending.status).toBe(200);
    const [before] = await testDb().select().from(event).where(eq(event.id, eventId));
    expect(before?.plan).toBe("free");

    const paid = await send("evt_async_paid", "checkout.session.async_payment_succeeded", "paid");
    expect(paid.status).toBe(200);
    const [after] = await testDb().select().from(event).where(eq(event.id, eventId));
    expect(after?.plan).toBe("standard");
  });
});

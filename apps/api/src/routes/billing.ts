import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { contractPayment, event, stripeWebhookEvent } from "@fesflow/db";
import { apiError } from "../http-error";
import { getSession, hasPermission } from "../utils/auth";
import type { AppEnv } from "../types";

// 2026-11-04: SDKを持ち込まずWorkersのfetch/WebCryptoだけでCheckoutと署名検証を行い、Stripe価格設定を課金額の正本にする。
const billingRoutes = new Hono<AppEnv>();
const STRIPE_API = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SECONDS = 300;

function getCircleTierPrices(env: AppEnv["Bindings"]): Map<number, string> {
  const entries: Array<[number, string | undefined]> = [
    [2, env.STRIPE_PRICE_CIRCLES_2],
    [5, env.STRIPE_PRICE_CIRCLES_5],
    [10, env.STRIPE_PRICE_CIRCLES_10],
  ];
  return new Map(entries.filter((entry): entry is [number, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

billingRoutes.get("/tiers/:eventId", async (c) => {
  const eventId = c.req.param("eventId");
  if (!(await hasPermission(c, null, "event:write", eventId))) apiError("FORBIDDEN", "契約を変更する権限がありません");
  return c.json({ maxCircles: [...(c.env.STRIPE_PRICE_EVENT ? [1] : []), ...getCircleTierPrices(c.env).keys()] });
});

billingRoutes.post("/checkout", async (c) => {
  const db = c.get("db");
  const session = await getSession(c);
  if (!session?.user) apiError("UNAUTHORIZED", "認証が必要です");

  const body = await c.req.json<{ eventId?: unknown; maxCircles?: unknown }>().catch(() => ({ eventId: undefined, maxCircles: undefined }));
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const maxCircles = typeof body.maxCircles === "number" ? body.maxCircles : 1;
  if (!eventId || !Number.isInteger(maxCircles)) apiError("VALIDATION", "イベントとサークル枠を指定してください");
  if (!(await hasPermission(c, null, "event:write", eventId))) apiError("FORBIDDEN", "支払いを開始する権限がありません");

  const rows = await db.select().from(event).where(and(eq(event.id, eventId), isNull(event.deletedAt))).limit(1);
  const target = rows[0];
  if (!target) apiError("NOT_FOUND", "イベントが見つかりません");

  const priceId = c.env.STRIPE_PRICE_EVENT;
  const secret = c.env.STRIPE_SECRET_KEY;
  if (!priceId || !secret) apiError("INTERNAL", "オンライン決済は現在利用できません", { status: 503 });
  const tierPrice = getCircleTierPrices(c.env).get(maxCircles);
  if (maxCircles !== 1 && !tierPrice) apiError("VALIDATION", "選択したサークル枠は設定されていません");

  // 2026-11-04: 戻り先は既存の CORS_ORIGIN を正本にし、未検証の Host/Origin を決済 URL に混ぜない。
  const configuredOrigin = c.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).find(Boolean);
  let appOrigin: string;
  try {
    const parsed = new URL(configuredOrigin ?? "");
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("invalid origin");
    appOrigin = parsed.origin;
  } catch {
    apiError("INTERNAL", "決済の戻り先 URL が設定されていません", { status: 503 });
  }

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${appOrigin}/event/dashboard?tab=contract&payment=success`);
  form.set("cancel_url", `${appOrigin}/event/dashboard?tab=contract&payment=cancelled`);
  form.set("client_reference_id", eventId);
  form.set("customer_email", target.ownerEmail ?? session.user.email);
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  if (tierPrice) {
    form.set("line_items[1][price]", tierPrice);
    form.set("line_items[1][quantity]", "1");
  }
  form.set("metadata[eventId]", eventId);
  form.set("metadata[maxCircles]", String(maxCircles));
  form.set("payment_intent_data[metadata][eventId]", eventId);

  const response = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const checkout = await response.json().catch(() => ({})) as { id?: string; url?: string; customer?: string };
  if (!response.ok || !checkout.id || !checkout.url) {
    console.error("stripe_checkout_create_failed", { status: response.status });
    apiError("INTERNAL", "決済セッションを作成できませんでした", { status: 503 });
  }
  if (checkout.customer) {
    await db.update(event).set({ stripeCustomerId: checkout.customer }).where(eq(event.id, eventId));
  }
  return c.json({ url: checkout.url });
});

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function verifyStripeSignature(payload: string, header: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((part) => part.split("=", 2) as [string, string]);
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

type StripeCheckoutSession = {
  id?: string;
  payment_status?: string;
  amount_total?: number;
  currency?: string;
  customer?: string | null;
  metadata?: { eventId?: string; maxCircles?: string };
};

billingRoutes.post("/webhook", async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "webhook is not configured" }, 503);
  const payload = await c.req.text();
  if (!(await verifyStripeSignature(payload, c.req.header("stripe-signature"), secret))) {
    return c.json({ error: "invalid signature" }, 400);
  }

  let stripeEvent: { id?: string; type?: string; data?: { object?: StripeCheckoutSession } };
  try {
    stripeEvent = JSON.parse(payload);
  } catch {
    return c.json({ error: "invalid payload" }, 400);
  }
  if (!stripeEvent.id || !stripeEvent.type) return c.json({ error: "invalid event" }, 400);
  if (stripeEvent.type !== "checkout.session.completed" && stripeEvent.type !== "checkout.session.async_payment_succeeded") {
    await c.get("db").insert(stripeWebhookEvent).values({ id: stripeEvent.id, eventType: stripeEvent.type }).onConflictDoNothing();
    return c.json({ received: true });
  }

  const checkout = stripeEvent.data?.object;
  const eventId = checkout?.metadata?.eventId;
  const maxCircles = Number(checkout?.metadata?.maxCircles);
  if (!checkout?.id || !eventId || !Number.isInteger(maxCircles) || maxCircles < 1) {
    return c.json({ error: "invalid completed checkout" }, 400);
  }
  // 2026-11-04: 遅延決済は checkout.session.completed が未払いで届く。失敗応答にして再送させず、成功通知で有効化する。
  if (checkout.payment_status !== "paid") {
    await c.get("db").insert(stripeWebhookEvent).values({ id: stripeEvent.id, eventType: stripeEvent.type }).onConflictDoNothing();
    return c.json({ received: true, pending: true });
  }
  if (checkout.currency !== "jpy" || !Number.isInteger(checkout.amount_total) || checkout.amount_total! < 0) {
    return c.json({ error: "unsupported payment currency or amount" }, 400);
  }

  const db = c.get("db");
  const existingEvent = await db.select({ id: event.id }).from(event).where(eq(event.id, eventId)).limit(1);
  if (existingEvent.length === 0) return c.json({ error: "event not found" }, 404);
  const processed = await db.select({ id: stripeWebhookEvent.id }).from(stripeWebhookEvent).where(eq(stripeWebhookEvent.id, stripeEvent.id)).limit(1);
  if (processed.length > 0) return c.json({ received: true, duplicate: true });

  // 2026-11-04: event ID を入金行のIDにも使い、同時再送でも台帳への二重計上を防ぐ。
  await db.insert(contractPayment).values({
    id: stripeEvent.id,
    eventId,
    amount: checkout.amount_total!,
    method: "Stripe",
    paidAt: new Date(),
    note: `Checkout ${checkout.id}`,
  }).onConflictDoNothing();
  await db.update(event).set({
    plan: "standard",
    billingStatus: "active",
    maxCircles,
    billingAmount: checkout.amount_total!,
    activatedAt: new Date(),
    suspendedAt: null,
    stripeCustomerId: typeof checkout.customer === "string" ? checkout.customer : undefined,
  }).where(eq(event.id, eventId));
  await db.insert(stripeWebhookEvent).values({ id: stripeEvent.id, eventType: stripeEvent.type }).onConflictDoNothing();
  return c.json({ received: true });
});

export { verifyStripeSignature };
export default billingRoutes;

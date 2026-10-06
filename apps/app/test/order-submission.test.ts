import { describe, expect, it } from "bun:test";
import { createOrderSchema, createOrderResultSchema, type CreateOrderInput } from "@fesflow/config/order-contract";
import { createOrderSubmission, orderFingerprint } from "../src/features/orders/submission";

const input: CreateOrderInput = { circleId: "circle-a", userId: "visitor-a", items: [{ menuId: "menu-a", quantity: 1, toppingIds: ["b", "a"] }] };
const result = { id: "order-a", orderNumber: "A-1" };

describe("order submission boundary", () => {
  it("reuses the key after a lost response and gives the next successful checkout a new key", async () => {
    const keys: string[] = [];
    let nextKey = 0;
    const submission = createOrderSubmission(async (_input, key) => {
      keys.push(key);
      if (keys.length === 1) throw new Error("response lost after commit");
      return result;
    }, () => `key-${++nextKey}`);
    submission.observeDraft(orderFingerprint(input));
    await expect(submission.submit(input)).rejects.toThrow("response lost");
    expect(await submission.submit(input)).toEqual(result);
    expect(await submission.submit(input)).toEqual(result);
    expect(keys).toEqual(["key-1", "key-1", "key-2"]);
  });

  it("changes the key for a different customer, payment, or cart, including editing back to the old draft", async () => {
    const keys: string[] = [];
    let nextKey = 0;
    const submission = createOrderSubmission(async (_input, key) => { keys.push(key); throw new Error("offline"); }, () => `key-${++nextKey}`);
    submission.observeDraft(orderFingerprint(input));
    await submission.submit(input).catch(() => {});
    const changed = { ...input, userId: "visitor-b", paymentMethod: "現金" };
    submission.observeDraft(orderFingerprint(changed));
    submission.observeDraft(orderFingerprint(input));
    await submission.submit(input).catch(() => {});
    await submission.submit(changed).catch(() => {});
    expect(keys).toEqual(["key-1", "key-2", "key-3"]);
  });

  it("deduplicates synchronous clicks before React can disable the submit button", async () => {
    let release!: (value: typeof result) => void;
    let sent = 0;
    const submission = createOrderSubmission(() => { sent++; return new Promise((resolve) => { release = resolve; }); });
    const first = submission.submit(input);
    const second = submission.submit(input);
    await Promise.resolve();
    expect(sent).toBe(1);
    release(result);
    expect(await first).toEqual(result);
    expect(await second).toEqual(result);
  });

  it("normalizes topping selection order without treating quantity changes as retries", () => {
    expect(orderFingerprint(input)).toBe(orderFingerprint({ ...input, peopleCount: 1, items: [{ menuId: "menu-a", quantity: 1, toppingIds: ["a", "b"] }] }));
    expect(orderFingerprint(input)).not.toBe(orderFingerprint({ ...input, items: [{ menuId: "menu-a", quantity: 2, toppingIds: ["a", "b"] }] }));
  });

  it("enforces the same integer, payload-size and response contracts as the Worker", () => {
    expect(createOrderSchema.parse(input).peopleCount).toBe(1);
    expect(createOrderSchema.safeParse({ ...input, items: [] }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...input, items: Array.from({ length: 51 }, () => input.items[0]) }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...input, peopleCount: 1.5 }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...input, items: [{ menuId: "m", quantity: 0.5 }] }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...input, items: [{ menuId: "m", quantity: 1, toppingIds: ["a", "a"] }] }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...input, items: [{ menuId: "m", quantity: 1, toppingIds: Array.from({ length: 21 }, (_, i) => `${i}`) }] }).success).toBe(false);
    expect(createOrderResultSchema.safeParse({ id: "order-a" }).success).toBe(false);
    expect(createOrderResultSchema.parse(result)).toEqual(result);
  });
});

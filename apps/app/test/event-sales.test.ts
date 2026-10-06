import { describe, expect, it } from "bun:test";
import { loadCircleSalesOrders } from "../src/features/event-dashboard/sales";

const circles = Array.from({ length: 12 }, (_, i) => ({ id: `circle-${i}`, name: `Circle ${i}` }));

describe("event sales loading", () => {
  it("bounds request concurrency and preserves circle order", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await loadCircleSalesOrders(circles, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      return [];
    });
    expect(maxActive).toBe(4);
    expect(result.map((item) => item.circleId)).toEqual(circles.map((circle) => circle.id));
  });

  it("reports a failed circle rather than displaying a misleading zero-sales total", async () => {
    let calls = 0;
    await expect(loadCircleSalesOrders(circles, async () => {
      calls++;
      throw new Error("sales temporarily unavailable");
    })).rejects.toThrow("sales temporarily unavailable");
    expect(calls).toBeLessThanOrEqual(4);
    expect(await loadCircleSalesOrders([], async () => { throw new Error("should not fetch"); })).toEqual([]);
  });
});

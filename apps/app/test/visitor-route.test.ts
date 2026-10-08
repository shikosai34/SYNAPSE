import { describe, expect, test } from "bun:test";
import { findVisitorRouteItem } from "../src/lib/visitor-route";

describe("name-based visitor routes", () => {
  const events = [
    { id: "event-1", eventName: "FESFLOW DEMO FESTIVAL" },
    { id: "event-2", eventName: "Summer Festival" },
  ];

  test("matches names and URL-safe hyphenated segments", () => {
    expect(findVisitorRouteItem(events, "FESFLOW DEMO FESTIVAL", (item) => item.id, (item) => item.eventName)?.id).toBe("event-1");
    expect(findVisitorRouteItem(events, "fesflow-demo-festival", (item) => item.id, (item) => item.eventName)?.id).toBe("event-1");
    expect(findVisitorRouteItem(events, "event-2", (item) => item.id, (item) => item.eventName)?.id).toBe("event-2");
  });

  test("returns null for missing or ambiguous route names", () => {
    expect(findVisitorRouteItem(events, "missing", (item) => item.id, (item) => item.eventName)).toBeNull();
    expect(findVisitorRouteItem([
      { id: "event-1", eventName: "Summer Festival" },
      { id: "event-2", eventName: "summer-festival" },
    ], "summer festival", (item) => item.id, (item) => item.eventName)).toBeNull();
  });
});

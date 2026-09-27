import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearAuthContext, readAuthContext, writeAuthContext } from "../src/lib/auth-context";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

const sharedLocalStorage = memoryStorage();
const firstTab = { localStorage: sharedLocalStorage, sessionStorage: memoryStorage() };
const secondTab = { localStorage: sharedLocalStorage, sessionStorage: memoryStorage() };
let previousWindow: PropertyDescriptor | undefined;

function selectTab(tab: typeof firstTab) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: tab });
}

beforeEach(() => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
});

afterEach(() => {
  sharedLocalStorage.clear();
  firstTab.sessionStorage.clear();
  secondTab.sessionStorage.clear();
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete (globalThis as { window?: unknown }).window;
});

describe("tab-scoped active space context", () => {
  it("keeps membership context independent across tabs", () => {
    selectTab(firstTab);
    writeAuthContext({ circleId: "circle-a", eventId: "event-a", membershipId: "member-a" });

    selectTab(secondTab);
    writeAuthContext({ circleId: "circle-b", eventId: "event-b", membershipId: "member-b" });

    selectTab(firstTab);
    expect(readAuthContext()).toEqual({ circleId: "circle-a", eventId: "event-a", membershipId: "member-a" });
    selectTab(secondTab);
    expect(readAuthContext()).toEqual({ circleId: "circle-b", eventId: "event-b", membershipId: "member-b" });
  });

  it("migrates an existing shared context into the current tab", () => {
    sharedLocalStorage.setItem("circleAuth", JSON.stringify({ circleId: "legacy", membershipId: "legacy-member" }));
    selectTab(firstTab);

    expect(readAuthContext()).toEqual({ circleId: "legacy", membershipId: "legacy-member" });
    expect(firstTab.sessionStorage.getItem("circleAuth")).toBe(sharedLocalStorage.getItem("circleAuth"));
  });

  it("rejects corrupt context and does not revive it after clearing the tab", () => {
    firstTab.sessionStorage.setItem("circleAuth", "{");
    sharedLocalStorage.setItem("circleAuth", JSON.stringify({ circleId: "old", membershipId: "old-member" }));
    selectTab(firstTab);
    expect(readAuthContext()).toBeNull();

    clearAuthContext();
    expect(readAuthContext()).toBeNull();
    expect(sharedLocalStorage.getItem("circleAuth")).toBeNull();
  });

  it("clears stale circle fields when switching to event context", () => {
    selectTab(firstTab);
    writeAuthContext({ circleId: "circle-a", circleName: "A", eventId: "event-a", membershipId: "member-a" });
    writeAuthContext({ circleId: null, circleName: null, eventId: "event-b", membershipId: "member-b" });

    expect(readAuthContext()).toEqual({ circleId: null, circleName: null, eventId: "event-b", membershipId: "member-b" });
    expect(firstTab.sessionStorage.getItem("circleId")).toBeNull();
    expect(firstTab.sessionStorage.getItem("circleName")).toBeNull();
  });
});

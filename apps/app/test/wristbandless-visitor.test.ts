// 2026-11-04: 未発行注文の匿名IDは再利用し、既存の入場者や別イベントのセッションを置き換えない。
import { afterEach, describe, expect, it } from "bun:test";
import { ensureWristbandlessVisitor, getVisitor, saveVisitor } from "../src/hooks/useVisitor";
import { parseCircleSettings } from "../src/lib/api";

const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
});
function browser() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
}

describe("未発行注文の来場者ID", () => {
  it("入場完了を付与せずIDを保存し、画面再訪時にも同じIDを使う", () => {
    browser();
    const session = ensureWristbandlessVisitor("event-a");
    expect(session.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session).toMatchObject({ eventId: "event-a", wristbandId: null, onboarded: false, displayId: null });
    expect(getVisitor()).toEqual(session);
    expect(ensureWristbandlessVisitor("event-a")).toEqual(session);
  });
  it("既存の来場者セッションは別イベントでも上書きしない", () => {
    browser();
    const session = { userId: "issued", eventId: "event-a", wristbandId: "band", onboarded: true, displayId: 1, nickname: "来場者" };
    saveVisitor(session);
    expect(ensureWristbandlessVisitor("event-b")).toEqual(session);
    expect(getVisitor()).toEqual(session);
  });
  it("未設定・不正設定は不許可とし、未登録バンドの例外許可から独立する", () => {
    for (const raw of [undefined, "{}", "broken", '{"allowWristbandlessOrder":"true"}', '{"allowUnregisteredWristbandOrder":true}']) {
      expect(parseCircleSettings(raw).allowWristbandlessOrder).toBe(false);
    }
    const enabled = parseCircleSettings('{"allowWristbandlessOrder":true}');
    expect(enabled.allowWristbandlessOrder).toBe(true);
    expect(enabled.allowUnregisteredWristbandOrder).toBe(false);
  });
});

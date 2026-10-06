import { describe, expect, it } from "bun:test";
import { generateWristbandIds } from "../src/lib/wristband-id-generator";

describe("generateWristbandIds", () => {
  it("creates unique IDs with the requested prefix and suffix length", () => {
    const ids = generateWristbandIds("34", 10_000, 10);

    expect(ids).toHaveLength(10_000);
    expect(new Set(ids).size).toBe(10_000);
    expect(ids.every((id) => /^34-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/.test(id))).toBe(true);
  });

  it("trims the prefix and rejects characters unsupported in wristband URLs", () => {
    expect(generateWristbandIds("  event_34  ", 1, 4)[0]).toMatch(/^event_34-/);
    expect(() => generateWristbandIds("event 34", 1, 4)).toThrow("半角英数字");
  });

  it("validates count and suffix length", () => {
    expect(() => generateWristbandIds("34", 0, 10)).toThrow("1〜50,000");
    expect(() => generateWristbandIds("34", 1, 3)).toThrow("4〜32");
  });
});

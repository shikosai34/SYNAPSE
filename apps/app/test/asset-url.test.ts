import { describe, expect, it } from "bun:test";
import { resolveAssetUrl } from "../src/lib/asset-url";

describe("resolveAssetUrl", () => {
  it("resolves upload paths using the active API host", () => {
    expect(resolveAssetUrl("/api/uploads/logo.webp", "http://localhost:8787"))
      .toBe("http://localhost:8787/api/uploads/logo.webp");
  });

  it("migrates historical absolute upload URLs to the active API host", () => {
    expect(resolveAssetUrl("https://fesflow.shikosai.net/api/uploads/logo.webp", "http://localhost:8787"))
      .toBe("http://localhost:8787/api/uploads/logo.webp");
  });

  it("keeps externally managed URLs unchanged", () => {
    expect(resolveAssetUrl("https://images.example.test/logo.webp", "http://localhost:8787"))
      .toBe("https://images.example.test/logo.webp");
  });
});

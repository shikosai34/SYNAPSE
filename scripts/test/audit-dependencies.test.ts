import { describe, expect, test } from "bun:test";
import { applyExceptions, lockedPackages, npmFindings, type Exception, type Finding } from "../audit-dependencies";

// 2026-10-03: 監査漏れにつながる scoped package、重複版、修正版境界、例外の横漏れを検証する。
describe("dependency audit", () => {
  test("parses Bun JSONC lockfiles, preserving distinct versions and optional dependencies", () => {
    expect(lockedPackages('{"packages":{"a":["@scope/pkg@1.0.0","",{}],"b":["@scope/pkg@1.0.0","",{}],"c":["@scope/pkg@1.0.1","",{}],"optional":["optional@2.0.0-beta.1","",{}],},}'))
      .toEqual([{ name: "@scope/pkg", version: "1.0.0" }, { name: "@scope/pkg", version: "1.0.1" }, { name: "optional", version: "2.0.0-beta.1" }]);
  });
  test("fails closed on unsupported dependency sources", () => {
    expect(() => lockedPackages('{"packages":{"a":["a@git+https://example.org/a.git", ""]}}')).toThrow("Unsupported package version");
  });
  test("does not flag fixed versions of an affected package", () => {
    const findings = npmFindings([{ name: "pkg", version: "1.0.0" }, { name: "pkg", version: "1.0.1" }], {
      pkg: [{ url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", title: "test", severity: "high", vulnerable_versions: "<1.0.1" }],
    });
    expect(findings.map((finding) => finding.version)).toEqual(["1.0.0"]);
  });
  const finding: Finding = { name: "pkg", version: "1.0.0", id: "GHSA-aaaa-bbbb-cccc", title: "test", severity: "high", sources: ["npm"], url: "https://example.org" };
  const exception: Exception = { id: finding.id, package: "pkg", versions: ["1.0.0"], expires: "2026-11-02", reason: "Reviewed dev-only path", issue: "#93" };
  test("exceptions only match an exact advisory, package and version", () => {
    const result = applyExceptions([finding, { ...finding, version: "1.0.1" }, { ...finding, name: "different" }, { ...finding, id: "GHSA-xxxx-yyyy-zzzz" }], [exception], new Date("2026-10-03"));
    expect(result.excepted).toEqual([finding]);
    expect(result.actionable).toHaveLength(3);
  });
  test("expired exceptions fail the gate even when their advisory disappears", () => {
    expect(() => applyExceptions([], [exception], new Date("2026-11-03"))).toThrow("Expired security exception");
  });
});

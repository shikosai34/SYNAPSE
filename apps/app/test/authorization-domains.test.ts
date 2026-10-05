import { describe, expect, test } from "bun:test";
import {
  ROLE_PERMISSIONS,
  ROLES,
  effectiveCircleRole,
  hasRolePermission,
  permissionsForRole,
} from "../../../packages/config/src/authorization";
import { isUnauthorizedSessionError } from "../src/lib/session-error";

describe("shared authorization domains", () => {
  test("keeps the canonical role permission sets unchanged", () => {
    // These arrays match the pre-extraction packages/db/src/schema/core.ts contract.
    expect(ROLE_PERMISSIONS).toEqual({
      super_admin: [
        "system:read", "system:write", "event:read", "event:write", "event:delete",
        "circle:read", "circle:write", "circle:delete", "menu:read", "menu:write", "menu:delete",
        "order:read", "order:write", "order:delete", "staff:read", "staff:write", "staff:delete",
        "stock:read", "stock:write", "sales:read", "member:read", "member:write", "member:delete",
        "coupon:read", "coupon:write",
      ],
      event_manager: [
        "event:read", "event:write", "circle:read", "circle:write", "circle:delete",
        "menu:read", "menu:write", "menu:delete", "order:read", "order:write", "order:delete",
        "staff:read", "staff:write", "staff:delete", "stock:read", "stock:write", "sales:read",
        "member:read", "member:write", "member:delete", "coupon:read", "coupon:write",
      ],
      circle_manager: [
        "circle:read", "circle:write", "menu:read", "menu:write", "menu:delete",
        "order:read", "order:write", "staff:read", "staff:write", "staff:delete",
        "stock:read", "stock:write", "sales:read", "member:read", "member:write",
        "coupon:read", "coupon:write",
      ],
      circle_staff: [
        "circle:read", "menu:read", "order:read", "order:write", "stock:read", "stock:write", "staff:read",
      ],
    });
  });

  test("keeps circle staff limited to the canonical order and stock actions", () => {
    expect(hasRolePermission(ROLES.CIRCLE_STAFF, "order:write")).toBe(true);
    expect(hasRolePermission(ROLES.CIRCLE_STAFF, "stock:write")).toBe(true);
    expect(hasRolePermission(ROLES.CIRCLE_STAFF, "menu:write")).toBe(false);
    expect(hasRolePermission(ROLES.CIRCLE_STAFF, "member:write")).toBe(false);
    expect(hasRolePermission(ROLES.CIRCLE_STAFF, "member:delete")).toBe(false);
  });

  test("keeps event and system boundaries while preserving backend super-admin permissions", () => {
    expect(hasRolePermission(ROLES.EVENT_MANAGER, "event:delete")).toBe(false);
    expect(hasRolePermission(ROLES.EVENT_MANAGER, "system:write")).toBe(false);
    expect(hasRolePermission(ROLES.SUPER_ADMIN, "event:delete")).toBe(true);
    expect(permissionsForRole(ROLES.SUPER_ADMIN)).toEqual(["system:read", "system:write"]);
    expect(hasRolePermission(ROLES.SUPER_ADMIN, "event:delete")).toBe(true);
  });

  test("fails closed for missing, legacy, unknown, and inherited property names", () => {
    for (const role of [
      null,
      undefined,
      "",
      "event_staff",
      "system_staff",
      "system_manager",
      "unknown_role",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      expect(permissionsForRole(role)).toEqual([]);
      expect(hasRolePermission(role, "system:read")).toBe(false);
    }
  });

  test("distinguishes a confirmed expired session from temporary auth-service failures", () => {
    expect(isUnauthorizedSessionError({ status: 401 })).toBe(true);
    expect(isUnauthorizedSessionError({ status: 403 })).toBe(false);
    expect(isUnauthorizedSessionError({ status: 503 })).toBe(false);
    expect(isUnauthorizedSessionError({})).toBe(false);
    expect(isUnauthorizedSessionError({ status: "401" } as unknown as { status?: number })).toBe(false);
    expect(isUnauthorizedSessionError(null)).toBe(false);
  });
});

describe("effectiveCircleRole", () => {
  test("OFF のとき circle_staff だけを circle_manager 相当にする", () => {
    expect(effectiveCircleRole("circle_staff", false)).toBe("circle_manager");
    expect(effectiveCircleRole("circle_staff", undefined)).toBe("circle_manager");
    expect(effectiveCircleRole("circle_manager", false)).toBe("circle_manager");
    expect(effectiveCircleRole("event_manager", false)).toBe("event_manager");
  });

  test("ON のときは実ロールのまま区別する", () => {
    expect(effectiveCircleRole("circle_staff", true)).toBe("circle_staff");
  });
});

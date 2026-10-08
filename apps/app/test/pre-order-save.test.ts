import { describe, expect, it } from "bun:test";
import { ApiError } from "../src/lib/api-error";
import { isRetryablePreOrderSaveError, shouldRetryPreOrderSave } from "../src/features/orders/pre-order-save";

describe("pre-order draft save retry", () => {
  it("retries network, timeout, rate-limit, and server failures up to the limit", () => {
    const retryable = [
      new ApiError("network", { status: 0, code: "NETWORK" }),
      new ApiError("timeout", { status: 408, code: "INTERNAL" }),
      new ApiError("rate limit", { status: 429, code: "RATE_LIMITED" }),
      new ApiError("server", { status: 503, code: "INTERNAL" }),
    ];

    for (const error of retryable) {
      expect(isRetryablePreOrderSaveError(error)).toBe(true);
      expect(shouldRetryPreOrderSave(0, error)).toBe(true);
      expect(shouldRetryPreOrderSave(1, error)).toBe(true);
      expect(shouldRetryPreOrderSave(2, error)).toBe(false);
    }
  });

  it("does not retry invalid requests, stale drafts, or ordinary errors", () => {
    const nonRetryable = [
      new ApiError("invalid", { status: 400, code: "BAD_REQUEST" }),
      new ApiError("stale", { status: 409, code: "CONFLICT" }),
      new ApiError("forbidden", { status: 403, code: "FORBIDDEN" }),
      new Error("missing draft identity"),
    ];

    for (const error of nonRetryable) {
      expect(isRetryablePreOrderSaveError(error)).toBe(false);
      expect(shouldRetryPreOrderSave(0, error)).toBe(false);
    }
  });
});

import { describe, expect, it } from "bun:test";
import { digitalQrIssueUrl } from "../src/lib/digital-qr-url";

describe("visitor digital QR issue URL", () => {
  it("points to the event-scoped MyPage issue action", () => {
    expect(digitalQrIssueUrl("https://fesflow.shikosai.net", "event-123")).toBe(
      "https://fesflow.shikosai.net/visitor/mypage?eventId=event-123&action=issue",
    );
  });

  it("encodes event IDs while preserving the action route", () => {
    expect(digitalQrIssueUrl("https://fesflow.shikosai.net", "event/with space")).toBe(
      "https://fesflow.shikosai.net/visitor/mypage?eventId=event%2Fwith+space&action=issue",
    );
  });
});

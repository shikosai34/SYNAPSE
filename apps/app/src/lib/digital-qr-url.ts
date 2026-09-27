/** Self-issuance QR destination shared by its printed URL and encoded QR payload. */
export function digitalQrIssueUrl(origin: string, eventId: string): string {
  const url = new URL("/visitor/mypage", origin);
  url.searchParams.set("eventId", eventId);
  url.searchParams.set("action", "issue");
  return url.toString();
}

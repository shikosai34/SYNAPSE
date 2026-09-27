import { getApiBaseUrl } from "@/lib/api";

// 2026-09-27 Issue #57: upload assets belong to the API origin; normalize legacy absolute
// records and new relative paths here so preview, public pages, and dashboards share one rule.
export function resolveAssetUrl(path: string | null | undefined, apiBaseOverride?: string): string {
  if (!path) return "";

  const apiBase = (apiBaseOverride ?? getApiBaseUrl()).replace(/\/$/, "");
  const uploadPath = path.startsWith("uploads/") ? `/api/${path}` : path;
  try {
    const parsed = new URL(uploadPath, apiBase);
    if (parsed.pathname.startsWith("/api/uploads/")) {
      const apiOrigin = new URL(apiBase).origin;
      return `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Preserve externally managed legacy URLs if they are not valid upload paths.
  }
  return uploadPath;
}

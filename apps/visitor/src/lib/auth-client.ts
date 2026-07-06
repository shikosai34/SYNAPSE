import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";

function getApiBaseUrl(): string {
  let url = import.meta.env.VITE_API_URL || "https://localhost:8787";
  if (typeof window !== "undefined" && (url.includes("localhost") || url.includes("127.0.0.1"))) {
    const host = window.location.hostname;
    if (
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^10\.\d+\.\d+\.\d+$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)
    ) {
      url = url.replace("localhost", host).replace("127.0.0.1", host).replace("http://", "https://");
    }
  }
  return url;
}

// better-auth のハンドラは API Worker (apps/api) の /api/auth/* に居る。
export const authClient = createAuthClient({

	baseURL: getApiBaseUrl(),


	plugins: [passkeyClient()],

});

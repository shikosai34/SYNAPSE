import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// register (模擬店向け) SPA。Next.js から Vite + React Router へ移行 (2026-07-04)。
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(rootDir, "src"),
		},
	},
	server: {
		port: 3000,
	},
	envDir: path.resolve(rootDir, "../.."),
});

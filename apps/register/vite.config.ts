import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// frontend (来場者・模擬店・イベント管理統合) SPA。
// 2026-07-08 単一ドメイン化: visitor と register を単一の Vite アプリに統合しました。
export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		chunkSizeWarningLimit: 2000,
	},
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

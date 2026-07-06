import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// visitor (来場者向け) SPA。register とは独立したアプリとして分離 (2026-07-04)。
// 来場者はリストバンド/イベント管理から配布された ID で入場し、
// サークル/イベント管理の UI とは完全に切り離す。
export default defineConfig({
	plugins: [react(), tailwindcss(), basicSsl()],
	resolve: {
		alias: {
			"@": path.resolve(rootDir, "src"),
		},
	},
	server: {
		port: 3001,
	},
	envDir: path.resolve(rootDir, "../.."),
});

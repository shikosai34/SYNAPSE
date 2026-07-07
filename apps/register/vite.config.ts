import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// register (模擬店向け) SPA。Next.js から Vite + React Router へ移行 (2026-07-04)。
//
// 2026-07-07 単一ドメイン化: register は 1ドメインの /circle・/event・/sys の3プレフィックスで
// 配信される (来場者=/)。1つの Vite ビルドが持てる base は1つなので、**asset は固定プレフィックス
// /console/** に置き、ルート側は絶対パス (basename 無し) で /circle/... 等をそのまま解決する。
//   - build 時のみ base=/console/、出力は dist/console/ に隔離。
//   - build 後に dist/console/index.html を dist/index.html へコピー (package.json の build スクリプト)。
//     → Cloudflare Static Assets の SPA フォールバック (dist/index.html) が /circle/* 等に index を返し、
//        その index が参照する asset は /console/assets/... (実体 dist/console/assets/...) で解決される。
//   - dev (serve) は base=/ のまま各アプリを個別ポートで動かす。
export default defineConfig(({ command }) => ({
	plugins: [react(), tailwindcss()],
	base: command === "build" ? "/console/" : "/",
	build: {
		outDir: "dist/console",
		emptyOutDir: true,
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
}));

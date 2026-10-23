const CACHE_PREFIX = "fesflow-static-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const ASSET_MANIFEST = "/pwa-assets-manifest.json";
const APP_SHELL = [
	"/",
	"/index.html",
	"/favicon/site.webmanifest",
	"/favicon/favicon.svg",
	"/favicon/favicon-96x96.png",
	"/favicon/apple-touch-icon.png",
	"/favicon/web-app-manifest-192x192.png",
	"/favicon/web-app-manifest-512x512.png",
];

async function cacheAppShell() {
	const cache = await caches.open(CACHE_NAME);
	await cache.addAll(APP_SHELL);

	// 2026-10-21: 初回インストール直後のオフライン再読込でも、遅延ロード画面を開けるようJS/CSSをまとめて保存する。
	// 2026-10-23: QRスキャナーの zxing WASM (自前配信) もオフラインで読めるよう wasm も保存対象にする。
	// manifest 上 WASM は entry.file として載っている (css 配列ではない)。
	try {
		const response = await fetch(ASSET_MANIFEST, { cache: "no-store" });
		if (!response.ok) return;
		const manifest = await response.json();
		const assets = new Set();
		for (const entry of Object.values(manifest)) {
			for (const file of [entry.file, ...(entry.css ?? [])]) {
				if (typeof file !== "string") continue;
				const url = new URL(file, self.location.origin);
				if (url.origin === self.location.origin && url.pathname.startsWith("/assets/") && /\.(?:m?js|css|wasm)$/.test(url.pathname)) {
					assets.add(url.href);
				}
			}
		}
		const assetUrls = [...assets];
		for (let offset = 0; offset < assetUrls.length; offset += 10) {
			await Promise.allSettled(assetUrls.slice(offset, offset + 10).map(async (asset) => {
				const assetResponse = await fetch(asset, { cache: "reload" });
				if (assetResponse.ok) await cache.put(asset, assetResponse);
			}));
		}
	} catch {
		// shell の導入は続け、オンラインで開いた静的資材を通常のfetch経由で保存する。
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(cacheAppShell());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
			await self.clients.claim();
		}),
	);
});

self.addEventListener("message", (event) => {
	if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (request.method !== "GET" || url.origin !== self.location.origin) return;

	// 2026-10-21: 注文・認証・来場者情報は端末間で古い応答を再利用しない。静的シェルだけを保存する。
	if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;

	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
						const copy = response.clone();
						void caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
					}
					return response;
				})
				.catch(async () => (await caches.match("/index.html")) || (await caches.match("/"))),
		);
		return;
	}

	// Vite の fingerprint 付き成果物とアプリのアイコンだけを保存する。APIやアップロード画像は対象外。
	const isStaticAsset = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/favicon/");
	if (!isStaticAsset) return;
	event.respondWith(
		caches.match(request).then(async (cached) => {
			if (cached) return cached;
			const response = await fetch(request);
			if (response.ok) {
				const cache = await caches.open(CACHE_NAME);
				await cache.put(request, response.clone());
			}
			return response;
		}),
	);
});

self.addEventListener("push", (event) => {
	let payload = {};
	try {
		payload = event.data?.json() ?? {};
	} catch {
		payload = { body: event.data?.text() ?? "新しいお知らせがあります" };
	}
	event.waitUntil(
		self.registration.showNotification(payload.title || "FesFlow", {
			body: payload.body || "新しいお知らせがあります",
			icon: payload.icon || "/favicon/web-app-manifest-192x192.png",
			badge: "/favicon/favicon-96x96.png",
			tag: payload.tag || undefined,
			data: { url: payload.url || "/visitor/events" },
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const target = new URL(event.notification.data?.url || "/visitor/events", self.location.origin);
	if (target.origin !== self.location.origin) return;
	event.waitUntil(
		self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
			for (const client of clients) {
				if ("focus" in client) {
					await client.navigate(`${target.pathname}${target.search}${target.hash}`);
					return client.focus();
				}
			}
			return self.clients.openWindow(target.href);
		}),
	);
});

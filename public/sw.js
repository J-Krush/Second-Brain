// Minimal service worker: makes the app installable (enabling the PWA share
// target). Network passthrough; no offline caching by design (data lives in
// Postgres/R2, and stale caches would fight the single-user fetch-on-load model).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

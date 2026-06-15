// Vessel host service worker — offline cache that STILL ships host updates.
//
// The app-shell HTML is NETWORK-FIRST, so a new deploy is picked up on the next
// open (the fresh index.html references new content-hashed assets, which are then
// fetched). Content-hashed assets and the self-hosted Pyodide runtime (same-origin,
// under /app/pyodide/) are CACHE-FIRST (immutable / version-pinned). Navigation
// falls back to cache when offline. Other origins are never touched, so bundle
// network egress (the manifest allowlist) is unaffected.
const CACHE = "vessel-cache-v2-pyodide-0.29.4-selfhosted";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "vessel:clear-cache") event.waitUntil(caches.delete(CACHE));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const cached = (await cache.match(req)) || (await cache.match("/app/")) || (await cache.match("/"));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return; // leave bundle egress / other origins (incl. exotic-wheel CDN fallback) alone

  // App-shell HTML: network-first so deploys propagate. Everything else (hashed
  // assets + the self-hosted Pyodide runtime under /app/pyodide/): cache-first.
  if (sameOrigin && req.mode === "navigate") {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

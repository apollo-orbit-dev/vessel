// Vessel host service worker — runtime cache for offline use.
//
// Caches the app shell (same-origin) and the pinned Pyodide CDN assets (core +
// wheels) so the host and cached-dependency bundles open offline after one
// online launch. It never touches other origins, so bundle network egress (the
// manifest allowlist) is unaffected. Cache-first; versioned to the Pyodide pin.
const CACHE = "vessel-cache-v1-pyodide-0.29.4";
const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/";

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
  if (event.data === "vessel:clear-cache") {
    event.waitUntil(caches.delete(CACHE));
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isPyodide = url.href.startsWith(PYODIDE_CDN);
  if (!sameOrigin && !isPyodide) return; // leave bundle egress / other origins alone

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) {
          cache.put(req, res.clone()).catch(() => {});
        }
        return res;
      } catch (err) {
        const fallback = await cache.match(req);
        if (fallback) return fallback;
        throw err;
      }
    })(),
  );
});

// Service worker TixFour: cache aset statis + halaman yang pernah dibuka (PWA Offline-First).
const STATIC = "tixfour-static-v2";
const PAGES = "tixfour-pages-v2";

const PRECACHE_URLS = ["/", "/tickets", "/eo/scanner", "/eo/dashboard"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PAGES).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch(() => {});
    })
  );
});

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // data API internal

  // Aset build bersifat immutable -> cache-first
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  // Halaman -> network-first, jatuh ke cache saat luring
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(PAGES);
          return (
            (await cache.match(req, { ignoreVary: true })) ||
            (await cache.match(url.pathname, { ignoreVary: true })) ||
            (await cache.match("/eo/scanner", { ignoreVary: true })) ||
            (await cache.match("/tickets", { ignoreVary: true })) ||
            Response.error()
          );
        })
    );
  }
});

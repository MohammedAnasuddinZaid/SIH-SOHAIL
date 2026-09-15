// ZELUX service worker: offline-first app shell cache.
// SPA routes (/, /train, /workout, /battle, ...) always fall back to the cached
// app shell on failure, so refreshing directly on a route never shows a 404.

const CACHE = "zelux-v3";
const APP_SHELL = "/index.html";
const PRECACHE = ["/", APP_SHELL, "/manifest.webmanifest", "/icons/icon.svg", "/zelux-bg.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).then(() => self.skipWaiting())).catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept CDN/model traffic
  if (/\.(mp4|webm|m3u8)/.test(url.pathname)) return;

  // SPA navigation: network-first, then the cached app shell. This is what keeps
  // /workout, /battle etc. from ever bouncing into a server 404 on refresh.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(APP_SHELL, copy)).catch(() => {});
            return res;
          }
          return caches.match(APP_SHELL) ?? res;
        })
        .catch(() => caches.match(APP_SHELL).then((shell) => shell || new Response("ZELUX is offline.", { status: 503 }))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => {
          if (request.destination === "document") return caches.match(APP_SHELL);
          return new Response("", { status: 408 });
        });
    }),
  );
});
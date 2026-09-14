// RepRush service worker: offline-first app shell cache.
// Runtime fetches are never cached so performance stays fresh and private.

const CACHE = "reprush-v1";
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon.svg"];

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
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(
          () =>
            new Response("RepRush is offline. Open it while connected to load assets.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            }),
        );
    }),
  );
});
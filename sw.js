/* Service worker for Scripture Quiz.
 * Precaches the app shell so the quiz works offline and can be installed
 * as an app on mobile devices.
 *
 * Freshness: same-origin files (HTML, app.js, data.js, ...) are served
 * network-first, so a reload/pull-to-refresh always gets the latest deploy;
 * the cache is only a fallback for when the device is offline. Bump CACHE when
 * any precached file changes so stale caches are cleared on activation.
 */
"use strict";

const CACHE = "scripture-quiz-v5";

// App shell, relative to the service worker's scope.
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Same-origin app files (HTML, app.js, data.js, manifest, icons): network-first
  // so every load and pull-to-refresh gets the latest deploy. Update the cache on
  // each success, and fall back to it only when the network is unavailable.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(
          (r) => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())
        ))
    );
    return;
  }

  // Cross-origin (the Tailwind CDN): serve from cache when present, otherwise
  // fetch and cache in the background (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

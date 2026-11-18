const CACHE = "guest-ops-v2";
const PRECACHE = [
  "./",
  "./index.html",
  "./office.html",
  "./maintenance.html",
  "./admin.html",
  "./staging/manager.html",
  "./ops/settings-upsells.html",
  "./ops/simulator.html",
  "./ops/orders.html",
  "./assets/styles.css",
  "./assets/logo.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/raleway-latin.woff2",
  "./assets/raleway-latin-600.woff2",
  "./assets/raleway-latin-700.woff2",
  "./manifest.webmanifest",
  "./config/product.json",
  "./config/decisions.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(event.request);
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) cache.put(event.request, fresh.clone());
      return fresh;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  }));
});

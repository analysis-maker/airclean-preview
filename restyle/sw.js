/* Stayfold service worker. Network-first, same-origin GET only, scoped to this build's folder.
   It never touches cross-origin requests (Supabase, APIs), so no data responses are cached. */
const CACHE = "stayfold-shell-v1";
const SHELL = ["./", "./manifest.webmanifest", "./favicon.svg", "./icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase and any other API: straight to the network
  if (!url.pathname.startsWith(new URL("./", self.location.href).pathname)) return;
  if (req.headers.has("authorization") || url.pathname.includes("/rest/") || url.pathname.includes("/auth/")) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("./") : Response.error()))),
  );
});

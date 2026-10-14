/* Service worker: makes the app launch and run with no network.
   All paths are relative so this works unchanged whether the app is served from
   a domain root or from a GitHub Pages subdirectory. Bump CACHE on every deploy
   or returning phones will keep serving the old shell. */
const CACHE = "bwl-v2-3";
// index.html loads its scripts and stylesheet with ?v=<this>. A phone still
// running an OLDER worker serves our own assets cache-first, so on the first
// launch after a deploy it would pair the new index.html with the old cached
// app.js. A new query string can never hit an old cache entry. Bump it in
// index.html together with CACHE.
const V = "?v=2.3";

const SHELL = [
  "./",
  "index.html",
  "styles.css" + V,
  "data.js" + V,
  "ui.js" + V,
  "app.js" + V,
  "chart.json",
  "fonts/oxanium-latin.woff2",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one failed entry can't fail the whole install.
      .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Launching the app: try the network so a deploy is picked up, fall back to
  // the cached shell when there's no signal (the gym basement case).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put("index.html", copy));
          return res;
        })
        .catch(() => caches.match("index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Our own assets: cache-first for instant loads, refresh the copy in the
  // background so the next launch gets any update.
  event.respondWith(
    caches.match(req).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
      return hit || fresh;
    }).catch(() => caches.match("index.html"))
  );
});

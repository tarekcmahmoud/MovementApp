/* Service worker: makes the app launch and run with no network.
   All paths are relative so this works unchanged whether the app is served from
   a domain root or from a GitHub Pages subdirectory. Bump CACHE on every deploy
   or returning phones will keep serving the old shell. */
const CACHE = "bwf-ladders-v1";

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "chart.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png"
];

const isFont = url =>
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

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

  // Fonts are third-party and immutable: cache-first, and cache on first sight
  // so Barlow survives going offline.
  if (isFont(url)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => hit))
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

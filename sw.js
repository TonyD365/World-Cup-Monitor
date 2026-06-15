// sw.js — offline app shell for the World Cup Monitor PWA.
// Caches the static files only; live data (cross-origin ESPN/openfootball) is
// never cached, so it always fetches fresh.
const CACHE = 'wc-monitor-v1';
const ASSETS = [
  './', 'index.html', 'css/monitor.css',
  'js/app.js', 'js/config.js', 'js/data.js', 'js/render.js',
  'shared/core.js', 'shared/sources.js', 'shared/mock.js',
  'favicon.svg', 'favicon.ico', 'apple-touch-icon.png',
  'icon-192.png', 'icon-512.png', 'manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle same-origin GETs; let data APIs hit the network untouched.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached || fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached)
    )
  );
});

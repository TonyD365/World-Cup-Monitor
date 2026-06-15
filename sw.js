// sw.js — self-unregistering kill switch.
// The earlier service worker cached the app shell and kept serving STALE code
// after updates. We no longer use a service worker: this version clears all
// caches, unregisters itself, and reloads open clients so the latest code loads.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url)); // reload -> fresh from network
    } catch (_) { /* ignore */ }
  })());
});

// No fetch handler: every request goes straight to the network.

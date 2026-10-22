// Service worker: makes the app work offline.
// Network first (so updates arrive as soon as you are online), cache as fallback.
// Every request asks the server "is there a newer copy?" and skips the browser's own cache,
// so a new version shows up on the phone right after it is on GitHub.
// When you change any app file, bump CACHE_VERSION so phones refresh their copy.
const CACHE_VERSION = 'mt-attendance-v3';
const CORE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'xlsx.mini.min.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'logo.png',
  'logo-emblem.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => Promise.all(CORE.map((u) =>
        fetch(u, { cache: 'reload' }).then((res) => { if (!res.ok) throw new Error(u); return c.put(u, res); })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never cache Google Sheets calls
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' })
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});

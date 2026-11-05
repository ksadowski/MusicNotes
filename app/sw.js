/* Service worker: trzyma aplikację w pamięci, żeby działała bez internetu.
   VERSION podmienia workflow GitHub Pages przy każdym wdrożeniu (skrót commita).
   Lokalnie zostaje '__BUILD__' – wtedy pliki aplikacji idą najpierw z sieci (wygodne przy pracy). */
const VERSION = '__BUILD__';
const DEV = VERSION === '__BUILD__';
const APP_CACHE = 'app-' + VERSION;
const FONT_CACHE = 'fonts-v1';

const APP_FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/storage.js',
  'js/backup.js',
  'js/sync.js',
  'js/gdrive.js',
  'js/config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES.map(u => new Request(u, { cache: 'reload' })))));
  if (DEV) self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('app-') && k !== APP_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// strona prosi o przejście na nową wersję („Odśwież” w aplikacji)
self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // czcionki Google: z pamięci, a jeśli ich nie ma – z sieci i zapamiętaj
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      } catch (err) { return Response.error(); }
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === 'navigate';
  const key = isNav ? 'index.html' : req;

  if (DEV) {
    // najpierw sieć (świeże pliki), bez sieci – pamięć
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key, { ignoreSearch: true })));
    return;
  }

  // wersja wdrożona: najpierw pamięć (działa natychmiast i offline); nowa wersja przychodzi przez aktualizację SW
  e.respondWith(caches.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});

/**
 * ============================================================================
 * SI-BUKU TAMU (E-Tamu PTUN) — SERVICE WORKER PWA (GitHub Pages Ready)
 * ============================================================================
 * - Menggunakan path relatif (./) agar aman di sub-folder GitHub Pages
 * - Permintaan ke Google Apps Script & Google OAuth TIDAK pernah di-cache
 * - Aset statis lokal memakai Stale-While-Revalidate (tampil instan 0ms + update latar belakang)
 * ============================================================================
 */
const CACHE_NAME = 'etamu-ptun-pwa-v2.5';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './css/style.css',
  './img/logo-mahkamah-agung.svg',
  './js/config.js',
  './js/api.js',
  './js/pwa.js',
  './js/struk-engine.js',
  './js/struk-printer.js',
  './js/struk-ui.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url).catch(() => null))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ATURAN WAJIB: Permintaan ke GAS API, OAuth, Fonnte, & YouTube TIDAK boleh diambil dari cache lokal
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('api.fonnte.com') ||
    url.hostname.includes('youtube.com') ||
    url.hostname.includes('ytimg.com')
  ) {
    event.respondWith(fetch(req));
    return;
  }

  // Aset lokal (same-origin): Stale-While-Revalidate agar buka instan & tetap selalu terbaru
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(req).then((cached) => {
          const networkFetch = fetch(req)
            .then((networkRes) => {
              if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
                cache.put(req, networkRes.clone());
              }
              return networkRes;
            })
            .catch(() => cached);
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // Aset pihak ketiga statis (Google Fonts, Tailwind, Chart.js, QRCode): Cache-First
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => cached);
    })
  );
});

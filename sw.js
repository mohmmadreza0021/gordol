// Gordol PWA Service Worker — کش آفلاین برای GitHub Pages
// اصول: هرگز درخواست‌های هوش مصنوعی (گوگل) کش یا دستکاری نمی‌شوند؛
// کلید و داده‌های کاربر هیچ‌وقت از دستگاه خارج نمی‌شوند.

const CACHE_NAME = 'gordol-v20';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/exercises-data.js',
  './js/plans-data.js',
  './js/meals-data.js',
  './js/grocery-data.js',
  './js/strength-plan.js',
  './js/strength-mode.js',
  './js/thumbs.js',
  './js/mealplan-ai.js',
  './js/icons.js',
  './js/gemini.js',
  './js/pose-engine.js',
  './js/app.js',
  './js/sw-register.js',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.svg',
  './assets/icons/icon-512.svg',
  './assets/mediapipe/vision_bundle.mjs',
  './assets/mediapipe/wasm/vision_wasm_internal.js',
  './assets/mediapipe/wasm/vision_wasm_internal.wasm',
  './assets/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  './assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  './assets/mediapipe/pose_landmarker_lite.task'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(CORE_ASSETS.map(u => cache.add(u)));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(names.map((name) => {
        if (name !== CACHE_NAME) return caches.delete(name);
        return null;
      }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // درخواست‌های هوش مصنوعی کاربر هرگز کش نمی‌شوند
  if (url.hostname.includes('googleapis.com')) return;

  // فقط درخواست‌های هم‌دامنه کش می‌شوند
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        // کش تنبل برای ویدیوها و دارایی‌ها
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return undefined;
      });
    })
  );
});

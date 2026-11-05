// Gordol PWA Service Worker — کش آفلاین برای GitHub Pages
// اصول: هرگز درخواست‌های هوش مصنوعی (گوگل) کش یا دستکاری نمی‌شوند؛
// کلید و داده‌های کاربر هیچ‌وقت از دستگاه خارج نمی‌شوند.
//
// استراتژی آپدیت خودکار (بدون نیاز به نصب مجدد اپ):
//  - index.html (ناوبری): NETWORK-FIRST → همیشه تازه‌ترین نسخه وقتی اینترنت هست؛ آفلاین از کش
//  - فایل‌های JS/CSS/دیتا: STALE-WHILE-REVALIDATE → فوری از کش، آپدیت همزمان پس‌زمینه (خود‌ترمیم)
//  - ویدیوها (حجیم): CACHE-FIRST بدون revalidate → جلوگیری از دانلود مجدد
//  - skipWaiting + clients.claim → آپدیت بی‌درنگ فعال می‌شود و sw-register.js صفحه را رفرش می‌کند

const CACHE_NAME = 'gordol-v29';
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
  './js/food-photos.js',
  './js/food-photos.js',
  './js/mealplan-ai.js',
  './js/icons.js',
  './js/gemini.js',
  './js/pose-engine.js',
  './js/app.js',
  './js/sw-register.js',
  './js/push-client.js',
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
  // فعال‌سازی فوری نسخه جدید (بدون صف «در انتظار»)
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
  // کنترل فوری همه تب‌های باز (شامل اپ نصب‌شده)
  self.clients.claim();
});

// پیام اختیاری از sw-register برای اطمینان از فعال‌سازی نسخه در انتظار
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// --- Web Push: نمایش نوتیفیکیشن از سرور Actions (اپ بسته / گوشی قفل) ---
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || '🔔 گردول', {
    body: d.body || 'یادآور گردول',
    icon: 'assets/icons/icon-192.svg',
    badge: 'assets/icons/favicon.svg',
    dir: 'rtl', lang: 'fa',
    tag: d.tag || 'gordol',
    data: { url: './index.html' }
  }));
});

// لمس نوتیف → باز شدن خود اپ
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return clients.openWindow('./index.html');
  }));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // درخواست‌های هوش مصنوعی کاربر هرگز کش نمی‌شوند
  if (url.hostname.includes('googleapis.com')) return;

  // فقط درخواست‌های هم‌دامنه کش می‌شوند
  if (url.origin !== self.location.origin) return;

  // --- ناوبری (باز شدن اپ): NETWORK-FIRST ---
  // کاربر وقتی آنلاین است همیشه تازه‌ترین index.html را می‌گیرد؛ آفلاین از کش
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        // تازه‌سازی نسخه کش‌شده HTML
        if (networkResponse && networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone)).catch(() => {});
        }
        return networkResponse;
      }).catch(() =>
        caches.match('./index.html').then((cached) => cached || caches.match('./'))
      )
    );
    return;
  }

  // --- ویدیوها: CACHE-FIRST (حجیم‌اند، هرگز در پس‌زمینه دوباره دانلود نمی‌شوند) ---
  if (/\.mp4($|\?)/i.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return networkResponse;
      }))
    );
    return;
  }

  // --- بقیه دارایی‌ها: STALE-WHILE-REVALIDATE ---
  // پاسخ فوری از کش + آپدیت خودکار در پس‌زمینه → اپ خودش را ترمیم می‌کند
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return networkResponse;
      }).catch(() => cachedResponse);
      return cachedResponse || networkFetch;
    })
  );
});

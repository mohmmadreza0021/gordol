// ثبت سرویس‌ورکر گردول — فایل خارجی (بدون اسکریپت inline برای CSP سخت‌گیرانه)
// آپدیت خودکار کامل: کاربر هرگز لازم نیست اپ را حذف/مجدد نصب کند.
//
// جریان: sw.js جدید روی سرور → مرورگر آن را تشخیص می‌دهد → skipWaiting + claim
// → رویداد controllerchange → صفحه یک بار خودکار رفرش می‌شود → نسخه جدید بدون دخالت کاربر.
(() => {
  if (!('serviceWorker' in navigator)) return;

  // برای اطمینان از اینکه قبل از اپدیت کنترلر داشته‌ایم (نه اولین نصب)
  let hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // اگر اولین بار SW به دست می‌آید (نصب اول)، رفرش لازم نیست
    if (!hadController) { hadController = true; return; }
    if (refreshing) return;
    // ضد حلقه‌ی رفرش بی‌پایان: حداکثر یک رفرش در ۱۰ ثانیه
    const last = Number(sessionStorage.getItem('gordol_sw_reload_at') || 0);
    if (Date.now() - last < 10000) { refreshing = true; return; }
    refreshing = true;
    try { sessionStorage.setItem('gordol_sw_reload_at', String(Date.now())); } catch (e) {}
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // اگر نسخه‌ای در صف «در انتظار» ماند، فوراً فعالش کن (ضد بن‌بست)
        if (reg.waiting && navigator.serviceWorker.controller) {
          reg.waiting.postMessage('SKIP_WAITING');
        }
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              nw.postMessage('SKIP_WAITING');
            }
          });
        });

        // بررسی دوره‌ای آپدیت: هر ۳۰ دقیقه و با هر بازگشت به اپ (مهم برای GitHub Pages)
        setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(err => {
        console.warn('[Gordol PWA] SW registration notice', err);
      });
  });
})();

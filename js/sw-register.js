// ثبت سرویس‌ورکر گردول — فایل خارجی (بدون اسکریپت inline برای CSP سخت‌گیرانه)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('[Gordol PWA] SW registration notice', err);
    });
  });
}

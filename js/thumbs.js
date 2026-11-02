// ==========================================================================
// موتور تامبنیل ویدیو گردول — استخراج فریم اول هر حرکت و کش محلی
// تصاویر فقط روی دستگاه کاربر ساخته می‌شوند (بدون هیچ درخواست خارجی)
// ==========================================================================

(function () {
  'use strict';

  const THUMB_PREFIX = 'gordol_thumb_';
  const inflight = {};

  function cacheGet(exId) {
    try { return localStorage.getItem(THUMB_PREFIX + exId); } catch (e) { return null; }
  }

  function cacheSet(exId, dataUrl) {
    try { localStorage.setItem(THUMB_PREFIX + exId, dataUrl); } catch (e) {
      // حافظه پر — یک تامبنیل قدیمی حذف و دوباره تلاش
      try {
        const keys = Object.keys(localStorage).filter(k => k.indexOf(THUMB_PREFIX) === 0);
        if (keys.length) localStorage.removeItem(keys[0]);
        localStorage.setItem(THUMB_PREFIX + exId, dataUrl);
      } catch (e2) { /* بی‌خیال کش */ }
    }
  }

  function generate(exId, videoUrl, cb) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    const finish = (dataUrl) => {
      video.src = '';
      cb(dataUrl);
    };

    const timer = setTimeout(() => finish(null), 8000);

    video.addEventListener('loadeddata', () => {
      try {
        video.currentTime = Math.min(0.35, (video.duration || 1) * 0.25);
      } catch (e) { /* برخی مرورگرها seek را بعداً می‌پذیرند */ }
    });

    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        const w = 160;
        const h = Math.round(w * ((video.videoHeight || 90) / (video.videoWidth || 160))) || 90;
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
        clearTimeout(timer);
        cacheSet(exId, dataUrl);
        finish(dataUrl);
      } catch (e) {
        clearTimeout(timer);
        finish(null);
      }
    });

    video.addEventListener('error', () => {
      clearTimeout(timer);
      finish(null);
    });
  }

  window.GordolThumbs = {
    // دریافت تامبنیل: فوراً از کش، وگرنه تولید غیرهمزمان
    get(exId, cb) {
      const cached = cacheGet(exId);
      if (cached) { cb(cached); return; }
      if (inflight[exId]) { inflight[exId].push(cb); return; }
      inflight[exId] = [cb];
      const ex = (window.GORDOL_EXERCISES || []).find(e => e.id === exId);
      if (!ex || !ex.videoUrl) {
        inflight[exId].forEach(f => f(null));
        delete inflight[exId];
        return;
      }
      generate(exId, ex.videoUrl, (dataUrl) => {
        inflight[exId].forEach(f => f(dataUrl));
        delete inflight[exId];
      });
    },
    // خواندن همگام از کش (بدون تولید) — برای poster attribute
    peek(exId) {
      return cacheGet(exId);
    },
    // پر کردن پوستر ویدیوی مودال به صورت غیرهمزمان
    attachPoster(exId, videoEl) {
      if (!videoEl) return;
      const cached = cacheGet(exId);
      if (cached) { videoEl.setAttribute('poster', cached); return; }
      this.get(exId, (dataUrl) => {
        if (dataUrl && videoEl.isConnected) videoEl.setAttribute('poster', dataUrl);
      });
    }
  };
})();

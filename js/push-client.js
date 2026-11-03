// ==========================================================================
// کلاینت Web Push گردول — نوتیفیکیشن با اپ بسته (آیفون iOS 16.4+ و اندروید)
// اصول امنیتی:
//  - شناسه گوشی «بی‌نام» است: فقط امضای رمزنگاری‌شده subscription و ساعت یادآور
//  - هیچ نام، وزن، غذا یا اطلاعات شخصی به بیرون نمی‌رود (فقط پرچم‌های بله/خیر روزانه)
//  - خواندن دیتابیس فقط با کلید مخفی Actions (قوانین امنیتی Firebase) ممکن است
//  - کلید API فایربیس در کلاینت عمومی است اما قوانین، نوشتن هر دستگاه را فقط
//    به رکورد خودش محدود می‌کنند و خواندن را کلاً می‌بندند
// ==========================================================================

(function () {
  'use strict';

  // --- کلید VAPID عمومی (امن است؛ کلید خصوصی فقط در GitHub Secrets) ---
  const VAPID_PUBLIC = 'BMbSEELogtavwvDzvLQaLNNqA3ES-owQ9Gi7ZvHBfdU7yP_NUiVtmHyrIoZyDOV2AOT4-JAdrUt_aHJFVA91jWI';

  // --- تنظیمات Firebase (پس از ساخت پروژه توسط کاربر پر می‌شود؛ خالی = قابلیت غیرفعال) ---
  const FB_API_KEY = '';   // کلید وب پروژه فایربیس (عمومی)
  const FB_DB_URL = '';    // مثل https://gordol-push-default-rtdb.firebaseio.com

  const TZ = 'Asia/Tehran';
  const DEFAULT_SLOTS = {
    water: ['10:00', '13:00', '16:00', '19:00'],
    breakfast: '08:00', snack1: '11:00', lunch: '14:00', snack2: '17:30',
    dinner: '21:00', streak: '20:00', sleep: '23:00'
  };

  const supported = () =>
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function toast(msg, ok) { if (window.GordolApp && window.GordolApp.toast) window.GordolApp.toast(msg, ok); }

  // شناسه بی‌نام = هش SHA-256 خود subscription
  async function subId(endpoint) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }

  // --- احراز هویت بی‌نام فایربیس (بدون SDK؛ فقط REST) — { token, uid } ---
  async function fbToken() {
    if (!FB_API_KEY) return null;
    try {
      const cached = JSON.parse(localStorage.getItem('gordol_push_auth') || 'null');
      if (cached && cached.exp > Date.now() + 60000) return { token: cached.idToken, uid: cached.uid };
      let res;
      if (cached && cached.refreshToken) {
        res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + FB_API_KEY, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: cached.refreshToken })
        });
      } else {
        res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FB_API_KEY, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnSecureToken: true })
        });
      }
      if (!res.ok) return null;
      const d = await res.json();
      const rec = {
        idToken: d.id_token || d.idToken,
        refreshToken: d.refresh_token || d.refreshToken,
        uid: d.user_id || d.localId || '',
        exp: Date.now() + 3000000
      };
      localStorage.setItem('gordol_push_auth', JSON.stringify(rec));
      return { token: rec.idToken, uid: rec.uid };
    } catch (e) { return null; }
  }

  function buildSchedule(profile) {
    const p = profile || {};
    return {
      workout: p.reminderTime || '18:00',
      water: DEFAULT_SLOTS.water,
      breakfast: DEFAULT_SLOTS.breakfast, snack1: DEFAULT_SLOTS.snack1,
      lunch: DEFAULT_SLOTS.lunch, snack2: DEFAULT_SLOTS.snack2,
      dinner: DEFAULT_SLOTS.dinner, streak: DEFAULT_SLOTS.streak, sleep: DEFAULT_SLOTS.sleep
    };
  }

  // حداقلِ وضعیت روزانه (پرچم‌های بی‌نام) تا یادآور بی‌خودی ارسال نشود
  function buildState(App) {
    try {
      const t = App.getDayLog(window.GordolUtil.todayKey());
      return {
        date: window.GordolUtil.todayKey(),
        workoutDone: !!(t.sessions && Object.keys(t.sessions).length) || !!t.dayCompleted,
        waterMl: t.waterMl || 0,
        waterGoal: (App.profile && App.profile.waterMl) || 0,
        meals: (t.meals || []).map(m => m.mealType),
        dayCompleted: !!t.dayCompleted
      };
    } catch (e) { return { date: '', workoutDone: false, waterMl: 0, waterGoal: 0, meals: [], dayCompleted: false }; }
  }

  const Push = {
    VAPID_PUBLIC,

    status() {
      if (!FB_API_KEY || !FB_DB_URL) return { on: false, why: 'سرور push هنوز پیکربندی نشده' };
      if (!supported()) return { on: false, why: 'مرورگر شما Web Push ندارد' };
      if (Notification.permission !== 'granted') return { on: false, why: 'اجازه اعلان داده نشده' };
      if (isIOS() && !isStandalone()) return { on: false, why: 'برای آیفون: گردول را «Add to Home Screen» کنید' };
      return { on: !!localStorage.getItem('gordol_push_sub'), why: '' };
    },

    async enable(App) {
      if (!FB_API_KEY || !FB_DB_URL) return false;
      if (!supported() || Notification.permission !== 'granted') return false;
      if (isIOS() && !isStandalone()) {
        toast('📢 برای نوتیف با اپ بسته در آیفون: دکمه اشتراک → «Add to Home Screen»، بعد اپ نصب‌شده را باز کن.', false);
        return false;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this._urlB64(VAPID_PUBLIC)
          });
        }
        const auth = await fbToken();
        if (!auth) { toast('⚠️ اتصال به سرویس یادآور برقرار نشد — دوباره تلاش می‌کنیم.', false); return false; }
        const id = await subId(sub.endpoint);
        const rec = {
          owner: auth.uid,
          sub: sub.toJSON(),
          sched: buildSchedule(App && App.profile),
          state: buildState(App),
          tz: TZ, v: 1, updatedAt: Date.now()
        };
        const res = await fetch(`${FB_DB_URL}/pushUsers/${id}.json?auth=${encodeURIComponent(auth.token)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec)
        });
        if (!res.ok) throw new Error('push upload ' + res.status);
        localStorage.setItem('gordol_push_sub', id);
        return true;
      } catch (e) {
        try { localStorage.removeItem('gordol_push_sub'); } catch (_) {}
        return false;
      }
    },

    // همگام‌سازی سبک وضعیت روزانه (پرچم‌های بله/خیر) — با محدودیت زمانی
    async syncState(App) {
      if (!FB_API_KEY || !FB_DB_URL || !supported()) return;
      const last = Number(localStorage.getItem('gordol_push_synced') || 0);
      if (Date.now() - last < 120000) return; // حداکثر هر ۲ دقیقه
      try {
        const id = localStorage.getItem('gordol_push_sub');
        if (!id) return;
        const auth = await fbToken();
        if (!auth) return;
        const patch = { state: buildState(App), sched: buildSchedule(App && App.profile), updatedAt: Date.now() };
        const res = await fetch(`${FB_DB_URL}/pushUsers/${id}.json?auth=${encodeURIComponent(auth.token)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
        });
        if (res.ok || res.status === 404) localStorage.setItem('gordol_push_synced', String(Date.now()));
      } catch (e) { /* بی‌صدا — دفعه بعد */ }
    },

    async disable() {
      try {
        const id = localStorage.getItem('gordol_push_sub');
        if (id && FB_DB_URL) {
          const auth = await fbToken();
          if (auth) await fetch(`${FB_DB_URL}/pushUsers/${id}.json?auth=${encodeURIComponent(auth.token)}`, { method: 'DELETE' });
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch (e) {}
      try { localStorage.removeItem('gordol_push_sub'); } catch (_) {}
    },

    _urlB64(b64) {
      const pad = '='.repeat((4 - b64.length % 4) % 4);
      const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }
  };

  window.GordolPush = Push;
})();

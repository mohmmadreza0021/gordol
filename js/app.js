// ==========================================================================
// موتور جامع اپلیکیشن گردول — نسخه ۴ (Gordol Master Engine v4)
// معماری: کاملاً کلاینت‌ساید و بدون سرور — همه داده‌ها فقط در دستگاه کاربر
// امنیت: کلید API فقط به سرور رسمی گوگل می‌رود؛ هیچ درخواست خارجی دیگری نیست؛
//        خروجی هوش مصنوعی همیشه escape می‌شود؛ داده‌ها در localStorage دستگاه خود کاربر
// ویژگی‌ها: گیت اجباری کلید API، آنبوردینگ ۹ مرحله‌ای اورجینال، چشم گردول واقعی
//        (MediaPipe)، مربی AI با حافظه، ثبت غذا با عکس و متن، جایگزینی تمرین/غذا،
//        پلیر جلسه تمرین با تایمر، ردیاب آب/وزن/فستینگ، لیست خرید، نوتیفیکیشن‌ها،
//        پیش‌بینی روز رسیدن به هدف، بکاپ و پاک‌سازی کامل
// ==========================================================================

(function () {
  'use strict';

  // ------------------------- ابزارهای عمومی -------------------------

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function faNum(n) {
    // سخت‌سازی امنیتی: ورودی غیرعددی (مثلاً از پاسخ AI یا بکاپ دستکاری‌شده) escape می‌شود
    const s = String(n === null || n === undefined ? '' : n).trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return s.replace(/[0-9]/g, d => FA_DIGITS[+d]);
    return esc(s);
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function dateKeyOffset(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function faDateLong(date) {
    try {
      return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
    } catch (e) { return date.toLocaleDateString(); }
  }

  function toast(msg, ok) {
    const t = document.createElement('div');
    t.className = 'gordol-toast' + (ok === false ? ' error' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 3200);
  }

  const MEAL_EMOJI = { breakfast: '🍳', snack1: '🍎', lunch: '🍲', snack2: '🥜', dinner: '🥗' };
  const MEAL_GRADIENT = {
    breakfast: 'linear-gradient(135deg, #f59e0b55, #ef444433)',
    snack1: 'linear-gradient(135deg, #10b98155, #06b6d433)',
    lunch: 'linear-gradient(135deg, #9c6bff55, #ff7f5c33)',
    snack2: 'linear-gradient(135deg, #fbbf2455, #f59e0b33)',
    dinner: 'linear-gradient(135deg, #3b82f655, #9c6bff33)'
  };

  // ------------------------- آبجکت اصلی اپ -------------------------

  const App = {
    activeTab: 'today',
    deferredInstallPrompt: null,
    audioCtx: null,
    notifTimer: null,
    fastingTicker: null,

    profile: null,
    logs: {},          // dateKey -> {meals:[], waterMl, exercises:[], dayCompleted, workoutSeconds}
    swaps: { meals: {}, exercises: {} },
    chat: [],
    fasting: null,

    // حالت دوربین‌ها
    poseStream: null, poseAnimId: null,
    poseSession: null, poseFacingMode: 'user', poseExId: null, poseVideoTs: -1,
    foodStream: null,
    selectedFoodBase64: null, scannedFoodResult: null, scannedTargetMeal: 'lunch',
    coachAttachedBase64: null,

    sessionPlayer: null, // پلیر جلسه تمرین

    // ================= بخش ۰: راه‌اندازی =================

    init() {
      GordolAI.loadConfig();
      this.loadState();
      this.initAudioContext();
      this.initPwaInstall();
      this.renderHeader();
      this.renderTabNav();

      if (!GordolAI.hasKey()) {
        this.openMandatoryApiModal();
        return;
      }
      this.afterKeyGate();
    },

    afterKeyGate() {
      this.initNotificationSystem();
      if (!this.profile) {
        this.startOnboarding();
      } else {
        this.switchTab('today');
      }
    },

    getDayLog(key) {
      if (!this.logs[key]) this.logs[key] = { meals: [], waterMl: 0, exercises: [], dayCompleted: false, workoutSeconds: 0 };
      const l = this.logs[key];
      if (!l.meals) l.meals = [];
      if (!l.exercises) l.exercises = [];
      if (l.waterMl === undefined) l.waterMl = 0;
      return l;
    },

    saveLogs() {
      try {
        const keys = Object.keys(this.logs).sort();
        while (keys.length > 120) { delete this.logs[keys.shift()]; }
        localStorage.setItem('gordol_logs_v3', JSON.stringify(this.logs));
      } catch (e) {}
    },

    loadState() {
      // هر کلید جداگانه خوانده می‌شود تا خرابی یک کلید بقیه را از بین نبرد
      const readJSON = (key) => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      };
      const p = readJSON('gordol_profile_v3');
      if (p && typeof p === 'object') this.profile = p;
      const l = readJSON('gordol_logs_v3');
      if (l && typeof l === 'object') this.logs = l;
      const s = readJSON('gordol_swaps_v3');
      if (s && typeof s === 'object') this.swaps = s;
      if (!this.swaps.meals) this.swaps.meals = {};
      if (!this.swaps.exercises) this.swaps.exercises = {};
      const c = readJSON('gordol_chat_v3');
      if (Array.isArray(c)) this.chat = c;
      const f = readJSON('gordol_fasting_v3');
      if (f && typeof f === 'object') this.fasting = f;
    },

    saveProfile() { try { localStorage.setItem('gordol_profile_v3', JSON.stringify(this.profile)); } catch (e) {} },
    saveSwaps() { try { localStorage.setItem('gordol_swaps_v3', JSON.stringify(this.swaps)); } catch (e) {} },
    saveChat() {
      try {
        while (this.chat.length > 20) this.chat.shift();
        localStorage.setItem('gordol_chat_v3', JSON.stringify(this.chat));
      } catch (e) {}
    },

    // ================= بخش ۱: گیت اجباری کلید API =================

    openMandatoryApiModal() {
      const modal = document.getElementById('mandatory-api-modal');
      if (!modal) return;
      modal.querySelector('.modal-card').innerHTML = `
        <div style="text-align:center; margin-bottom:14px;">
          <div style="color:var(--accent-purple);">${GordolIcon('eye', 44)}</div>
          <h3 style="font-size:1.25rem; font-weight:800; color:#fff; margin-top:6px;">به گردول خوش اومدی!</h3>
        </div>

        <div style="background:rgba(156,107,255,0.12); border:1px solid var(--accent-purple); border-radius:16px; padding:14px; margin-bottom:16px;">
          <p style="font-size:0.85rem; color:#fff; line-height:1.7;">
            گردول برای فعال شدن <b>چشم گردول</b>، <b>مربی هوشمند</b>، <b>دوربین تغذیه</b> و محاسبات بالینی به هوش مصنوعی نیاز دارد.
            کافی است یک کلید <b>رایگان</b> از Google AI Studio بسازی و اینجا وارد کنی.
          </p>
        </div>

        <div style="background:var(--bg-elevated); border-radius:14px; padding:12px 14px; margin-bottom:16px; font-size:0.8rem; color:var(--text-muted); line-height:1.8;">
          <b style="color:#fff;">گرفتن کلید رایگان در ۳۰ ثانیه:</b><br/>
          ۱. وارد <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" style="color:var(--accent-purple); text-decoration:underline;">Google AI Studio</a> شو (با اکانت گوگل).<br/>
          ۲. روی «Create API Key» بزن و کلید را کپی کن.<br/>
          ۳. کلید را همین‌جا پیست کن — تمام!
        </div>

        <div class="form-group">
          <label class="form-label">کلید API خودت:</label>
          <input type="password" id="mand-api-key" class="form-input" dir="ltr" placeholder="AIzaSy... یا AQ.Ab8..." autocomplete="off"/>
        </div>

        <div id="mand-api-status" style="font-size:0.82rem; margin-bottom:12px; display:none; line-height:1.6;"></div>

        <button id="btn-mand-verify" class="btn-primary">${GordolIcon('zap', 17)} تست و فعال‌سازی هوش مصنوعی</button>

        <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:14px; padding:10px 12px; margin-top:14px; font-size:0.72rem; color:var(--text-muted); line-height:1.7;">
          ${GordolIcon('shield', 14)} <b>امنیت و حریم خصوصی:</b> کلید تو فقط روی مرورگر خودت ذخیره می‌شود و فقط به سرور رسمی گوگل ارسال می‌شود.
          هیچ سرور واسطی وجود ندارد؛ هیچ‌کس — حتی ما — به اطلاعات، عکس‌ها یا تمرین‌های تو دسترسی ندارد.
        </div>
      `;

      document.getElementById('btn-mand-verify').addEventListener('click', () => this.verifyAndSaveMandatoryApiKey());
      const skipBtn = document.createElement('button');
      skipBtn.className = 'btn-secondary';
      skipBtn.style.marginTop = '10px';
      skipBtn.textContent = 'فعلاً بدون هوش مصنوعی ادامه بده';
      skipBtn.addEventListener('click', () => {
        document.getElementById('mandatory-api-modal').classList.remove('active');
        this.afterKeyGate();
      });
      document.getElementById('btn-mand-verify').after(skipBtn);
      modal.classList.add('active');
    },

    async verifyAndSaveMandatoryApiKey() {
      const key = document.getElementById('mand-api-key').value.trim();
      const status = document.getElementById('mand-api-status');
      const btn = document.getElementById('btn-mand-verify');

      if (!key) { toast('لطفاً کلید API را وارد کنید.', false); return; }
      if (!/^(AIza[0-9A-Za-z\-_]{30,}|AQ\.[A-Za-z0-9_\-]{20,})$/.test(key)) {
        status.style.display = 'block';
        status.style.color = '#ef4444';
        status.textContent = 'فرمت کلید درست به نظر نمی‌رسد. کلید گوگل با «AIza» یا «AQ.» شروع می‌شود.';
        return;
      }

      status.style.display = 'block';
      status.style.color = '#3b82f6';
      status.textContent = 'در حال راستی‌آزمایی کلید...';
      btn.disabled = true;

      try {
        const ok = await GordolAI.validateKey(key);
        if (!ok) throw new Error('پاسخ نامعتبر از سرور');
        GordolAI.config.apiKey = key;
        GordolAI.saveConfig();

        status.style.color = '#10b981';
        status.textContent = '✅ کلید تایید شد! هوش مصنوعی گردول فعال شد.';

        setTimeout(() => {
          document.getElementById('mandatory-api-modal').classList.remove('active');
          this.afterKeyGate();
        }, 700);
      } catch (e) {
        status.style.color = '#ef4444';
        status.textContent = 'خطا: ' + e.message;
        btn.disabled = false;
      }
    },

    // ================= بخش ۲: صدا و PWA =================

    initAudioContext() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.audioCtx = new AC();
      } catch (e) {}
    },

    playBeep(freq, duration) {
      try {
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq || 660, this.audioCtx.currentTime);
        gain.gain.setValueAtTime(0.22, this.audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + (duration || 0.15));
        osc.connect(gain); gain.connect(this.audioCtx.destination);
        osc.start(); osc.stop(this.audioCtx.currentTime + (duration || 0.15));
      } catch (e) {}
    },

    initPwaInstall() {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredInstallPrompt = e;
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.style.display = 'flex';
      });
      const installBtn = document.getElementById('pwa-install-btn');
      if (installBtn) installBtn.addEventListener('click', () => this.triggerInstallPrompt());
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
      if (isIos && !standalone) {
        const banner = document.getElementById('pwa-install-banner');
        if (banner) {
          banner.style.display = 'flex';
          banner.innerHTML = `<span>📲 نصب در آیفون: دکمه Share (⎋) و سپس Add to Home Screen (➕)</span>
            <button id="pwa-ios-dismiss">باشه</button>`;
          const dismissBtn = document.getElementById('pwa-ios-dismiss');
          if (dismissBtn) dismissBtn.addEventListener('click', () => { banner.style.display = 'none'; });
        }
      }
    },

    triggerInstallPrompt() {
      if (this.deferredInstallPrompt) {
        this.deferredInstallPrompt.prompt();
        this.deferredInstallPrompt.userChoice.then((c) => {
          if (c.outcome === 'accepted') document.getElementById('pwa-install-banner').style.display = 'none';
          this.deferredInstallPrompt = null;
        });
      } else {
        toast('از منوی مرورگر گزینه Add to Home Screen را انتخاب کن.');
      }
    },

    // ================= بخش ۳: نوتیفیکیشن‌ها =================

    initNotificationSystem() {
      if (!('Notification' in window)) return;
      try {
        const asked = localStorage.getItem('gordol_notif_asked_v3');
        if (Notification.permission === 'granted') {
          this.startNotificationScheduler();
        } else if (Notification.permission === 'default' && !asked) {
          this.openNotificationPromptModal();
        }
      } catch (e) {}
    },

    openNotificationPromptModal() {
      const modal = document.getElementById('notif-permission-modal');
      if (!modal) return;
      const rt = (this.profile && this.profile.reminderTime) || '18:00';
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${GordolIcon('bell', 18)} یادآورهای هوشمند گردول</h3>
        </div>
        <div style="text-align:center; margin-bottom:16px;">
          <span style="color:var(--accent-gold);">${GordolIcon('bell', 40)}</span>
          <h4 style="font-size:1.05rem; font-weight:800; margin-top:10px; color:#fff;">هیچ تمرین یا آبی رو فراموش نکن!</h4>
          <p style="font-size:0.84rem; color:var(--text-muted); margin-top:6px; line-height:1.7;">
            گردول هر روز ساعت ${esc(faNum(rt))} یادآور تمرین می‌فرستد، در طول روز برای نوشیدن آب یادت می‌گذارد
            و شب‌ها اگر وعده‌هات را ثبت نکرده باشی یادآوری می‌کند.
          </p>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn-secondary" style="width:auto; padding:0 16px;" id="notif-later-btn">بعداً</button>
          <button class="btn-emerald" style="flex:1;" id="notif-enable-btn">${GordolIcon('bell', 16)} فعال‌سازی نوتیفیکیشن‌ها</button>
        </div>
      `;
      document.getElementById('notif-later-btn').addEventListener('click', () => {
        localStorage.setItem('gordol_notif_asked_v3', '1');
        modal.classList.remove('active');
      });
      document.getElementById('notif-enable-btn').addEventListener('click', () => this.requestNotificationPermission());
      modal.classList.add('active');
    },

    async requestNotificationPermission() {
      if (!('Notification' in window)) return;
      const perm = await Notification.requestPermission();
      localStorage.setItem('gordol_notif_asked_v3', '1');
      const modal = document.getElementById('notif-permission-modal');
      if (modal) modal.classList.remove('active');
      if (perm === 'granted') {
        this.sendLocalNotification('🏋️ گردول فعال شد!', 'یادآورهای روزانه تمرین، آب و تغذیه برای تو فعال گردید.');
        this.startNotificationScheduler();
      } else {
        toast('دسترسی اعلان داده نشد؛ بعداً از تنظیمات مرورگر می‌توانی فعال کنی.', false);
      }
    },

    sendLocalNotification(title, body) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        new Notification(title, {
          body, icon: 'assets/icons/icon-192.svg', badge: 'assets/icons/favicon.svg', dir: 'rtl', lang: 'fa'
        });
      } catch (e) {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body, icon: 'assets/icons/icon-192.svg', dir: 'rtl' }));
        }
      }
    },

    notifSentToday(type) {
      try {
        const s = JSON.parse(localStorage.getItem('gordol_notif_state_v3') || '{}');
        return s[type] === todayKey();
      } catch (e) { return false; }
    },

    markNotifSent(type) {
      try {
        const s = JSON.parse(localStorage.getItem('gordol_notif_state_v3') || '{}');
        s[type] = todayKey();
        localStorage.setItem('gordol_notif_state_v3', JSON.stringify(s));
      } catch (e) {}
    },

    startNotificationScheduler() {
      if (this.notifTimer) clearInterval(this.notifTimer);
      const tick = () => {
        const now = new Date();
        const hm = now.toTimeString().slice(0, 5);
        const p = this.profile;
        if (!p) return;

        // یادآور تمرین روزانه در ساعت انتخابی کاربر
        if (hm === p.reminderTime && !this.notifSentToday('workout')) {
          this.markNotifSent('workout');
          this.sendLocalNotification('🏋️ وقت تمرین امروز گردول است!', `روز ${faNum(p.currentDay)} در انتظار توست. ${faNum(p.trainingMinutes)} دقیقه فقط! بیا شروع کنیم 💪`);
        }
        // یادآورهای آب
        if (['10:00', '13:00', '16:00', '19:00'].includes(hm) && !this.notifSentToday('water-' + hm)) {
          this.markNotifSent('water-' + hm);
          const t = this.getDayLog(todayKey());
          const left = Math.max(0, Math.round((p.waterMl - t.waterMl) / 250));
          this.sendLocalNotification('💧 وقت نوشیدن آب است!', left > 0
            ? `${faNum(left)} لیوان دیگر تا هدف آب امروزت مونده. یک لیوان آب بنوش!`
            : 'هدف آب امروز رو زدی! عالی بودی 🎉');
        }
        // یادآور ثبت شام
        if (hm === '21:00' && !this.notifSentToday('dinner')) {
          this.markNotifSent('dinner');
          const t = this.getDayLog(todayKey());
          if (t.meals.filter(m => m.mealType === 'dinner').length === 0) {
            this.sendLocalNotification('🥗 شام رو ثبت کردی؟', 'دوربین تغذیه گردول آماده اسکن بشقاب شام شماست — فقط عکس بگیر!');
          }
        }
        // هشدار استریک در خطر
        if (hm === '20:00' && !this.notifSentToday('streak')) {
          const streak = this.calcStreak();
          if (streak >= 2 && !this.getDayLog(todayKey()).dayCompleted) {
            this.markNotifSent('streak');
            this.sendLocalNotification('🔥 استریک‌ات در خطره!', `${faNum(streak)} روز پشت‌سرهم تمرین کردی؛ امروز رو تموم نکن این زنجیره بشکنه!`);
          }
        }
      };
      tick();
      this.notifTimer = setInterval(tick, 30000);
    },

    sendTestNotification() {
      if (!('Notification' in window)) { toast('مرورگر شما از نوتیفیکیشن پشتیبانی نمی‌کند.', false); return; }
      if (Notification.permission !== 'granted') {
        this.requestNotificationPermission();
      } else {
        this.sendLocalNotification('🔥 وقت تمرین گردول است!', 'روز چالش امروز در انتظار توست. بیا با هم بترکونیم!');
        toast('🔔 نوتیف تستی ارسال شد — نوار اعلان گوشی یا ویندوز را چک کن!');
      }
    },

    // ================= بخش ۴: هدر، نوبار و روتر تب‌ها =================

    renderHeader() {
      const header = document.querySelector('header.app-header');
      if (!header) return;
      const dayNum = (this.profile && this.profile.currentDay) || 1;
      header.innerHTML = `
        <div class="brand-badge">
          <span class="logo-icon">${GordolIcon('dumbbell', 20)}</span>
          <span>گردول</span>
        </div>
        <div class="header-actions">
          <div class="streak-pill" title="روز فعلی برنامه">
            ${GordolIcon('flame', 15)}<span>روز ${faNum(dayNum)}</span>
          </div>
          <button class="btn-icon" id="btn-open-settings" title="تنظیمات">${GordolIcon('settings', 19)}</button>
        </div>
      `;
      document.getElementById('btn-open-settings').addEventListener('click', () => this.openSettingsModal());
    },

    renderTabNav() {
      const nav = document.querySelector('nav.bottom-nav');
      if (!nav) return;
      nav.innerHTML = `
        <div class="nav-item ${this.activeTab === 'today' ? 'active' : ''}" data-tab="today">
          ${GordolIcon('calendar', 21)}<span>امروز</span>
        </div>
        <div class="nav-item ${this.activeTab === 'workout' ? 'active' : ''}" data-tab="workout">
          ${GordolIcon('flame', 21)}<span>تمرین</span>
        </div>
        <div class="nav-center-action" id="nav-eye-btn">
          <button class="nav-center-btn" title="چشم گردول — شمارش هوشمند با دوربین">${GordolIcon('eye', 24)}</button>
          <span class="nav-center-label">چشم گردول</span>
        </div>
        <div class="nav-item ${this.activeTab === 'diet' ? 'active' : ''}" data-tab="diet">
          ${GordolIcon('salad', 21)}<span>تغذیه</span>
        </div>
        <div class="nav-item ${this.activeTab === 'coach' ? 'active' : ''}" data-tab="coach">
          ${GordolIcon('bot', 21)}<span>مربی</span>
        </div>
      `;
      nav.querySelectorAll('.nav-item').forEach(n => {
        n.addEventListener('click', () => this.switchTab(n.dataset.tab));
      });
      document.getElementById('nav-eye-btn').addEventListener('click', () => this.openPoseModal(null));
    },

    switchTab(tab) {
      // قبل از ساخت پروفایل، هر تب غیر از مربی به آنبوردینگ برمی‌گردد (جریان از بین نمی‌رود)
      if (!this.profile && tab !== 'coach') {
        this.activeTab = 'today';
        this.renderTabNav();
        this.renderOnboardingStep();
        return;
      }
      this.activeTab = tab;
      this.renderTabNav();
      const main = document.querySelector('main.main-content');
      if (!main) return;
      main.innerHTML = '';
      main.scrollTop = 0;
      if (tab === 'today') this.renderTodayTab(main);
      else if (tab === 'workout') this.renderWorkoutTab(main);
      else if (tab === 'diet') this.renderDietTab(main);
      else if (tab === 'coach') this.renderCoachTab(main);
    },

    // ================= بخش ۵: آنبوردینگ — سوالات دقیق اورجینال گردول (ماژول ۳۲۸۹) =================
    // گزینه‌ها و ترتیب، عیناً از کد پروداکشن اپ اصلی استخراج شده است.
    // مراحل بازنشسته‌شده در اپ اصلی (water-check، eating-location، reminders، gordolak) حذف شده‌اند.

    onboardingData: {
      stepIndex: 0,
      primaryGoal: 'lose_weight',      // PRIMARY_GOAL_OPTIONS
      motivation: 'energy',            // MOTIVATION_OPTIONS
      obstacle: 'dont_continue',       // OBSTACLE_OPTIONS
      trainingInvite: 'yes',           // TRAINING_INVITE_OPTIONS
      trainingStyle: 'mastery',        // TRAINING_STYLE_OPTIONS
      trainingNow: 'sometimes',        // TRAINING_NOW_OPTIONS
      trainingFocus: 'full',           // TRAINING_FOCUS_OPTIONS
      trainingMinutes: 20,             // TRAINING_TIME_OPTIONS
      weeklyCadence: 4,                // CADENCE_OPTIONS
      gender: 'male',                  // GENDER_OPTIONS
      age: 26,
      activity: 'lightly_active',      // ACTIVITY_OPTIONS
      heightCm: 178,
      weightKg: 80,
      goalWeightKg: 74,
      weightDirection: 'down',         // WEIGHT_DIRECTION_OPTIONS
      nutritionInvite: 'yes',          // YES_NO_OPTIONS
      trackingExperience: 'new',       // CALORIE_EXPERIENCE_OPTIONS
      diet: 'balanced',                // DIET_OPTIONS
      exclusions: [],                  // EXCLUSION_OPTIONS (چندانتخابی)
      mealsPerDay: 3,                  // meal-structure
      habitFocus: 'regular_meals',     // HABIT_FOCUS_OPTIONS
      firstAction: 'open_training'     // FIRST_ACTION_OPTIONS
    },

    // گزینه‌های عین اورجینال (متن فارسی عیناً از کد اصلی)
    ONB: {
      PRIMARY_GOAL: [
        { v: 'get_stronger', t: 'قوی‌تر و آماده‌تر بشم' },
        { v: 'stay_consistent', t: 'منظم تمرین کنم' },
        { v: 'lose_weight', t: 'وزن کم کنم' },
        { v: 'maintain_weight', t: 'وزنم رو حفظ کنم' },
        { v: 'gain_weight', t: 'وزن اضافه کنم' },
        { v: 'eat_better', t: 'سالم‌تر غذا بخورم' }
      ],
      MOTIVATION: [
        { v: 'energy', t: 'انرژی بیشتر' },
        { v: 'confidence', t: 'اعتمادبه‌نفس بیشتر' },
        { v: 'health', t: 'رسیدگی به سلامتی‌ام' },
        { v: 'daily_ease', t: 'راحت‌تر انجام دادن کارهای روزمره' },
        { v: 'food_peace', t: 'حس بهتر نسبت به غذا' }
      ],
      OBSTACLE: [
        { v: 'dont_know', t: 'نمی‌دونم از کجا شروع کنم' },
        { v: 'dont_continue', t: 'شروع می‌کنم ولی ادامه نمی‌دم' },
        { v: 'no_time', t: 'وقت کم میارم' },
        { v: 'logging_hard', t: 'ثبت غذا برام سخته' },
        { v: 'first_time', t: 'هنوز جدی امتحان نکردم' },
        { v: 'none', t: 'مانع خاصی ندارم' }
      ],
      OBSTACLE_RESPONSE: {
        dont_know: 'اینجا دقیقاً جاییه که گردول می‌درخشه — برنامه روزانه، هر حرکت با ویدیو، فقط دنبال کن.',
        dont_continue: 'برای همین استریک و یادآورها ساختیم؛ زنجیره‌ات رو زنده نگه می‌داریم.',
        no_time: 'تمرین‌های ۱۰ تا ۲۰ دقیقه‌ای، بدون تجهیزات؛ هر جای خانه.',
        logging_hard: 'فقط عکس بگیر — هوش مصنوعی کالری و ماکرو رو خودش حساب می‌کنه.',
        first_time: 'عالی که اینجا شروع کردی؛ از صفر و اصولی جلو می‌ریم.',
        none: 'با این آمادگی، سریع‌تر از فکرت نتیجه می‌بینی!'
      },
      TRAINING_INVITE: [
        { v: 'yes', t: 'آره، مسیرم رو انتخاب کنم' },
        { v: 'no', t: 'فعلاً نه' }
      ],
      YES_NO: [
        { v: 'yes', t: 'آره، بریم' },
        { v: 'no', t: 'فعلاً نه' }
      ],
      TRAINING_STYLE: [
        { v: 'mastery', t: 'مسیر تسلط', d: 'شنا، اسکوات، پلانک و دراز و نشست؛ ۳۰ سطح با تأیید دوربین.' },
        { v: 'daily', t: 'مسیر روزانه', d: 'برنامه‌های چندروزه با تمرین‌های کوتاه؛ بدون تأیید دوربین.' }
      ],
      TRAINING_NOW: [
        { v: 'none', t: 'تقریباً هیچی' },
        { v: 'sometimes', t: 'گاهی، بی‌برنامه' },
        { v: 'regular', t: 'هفته‌ای چند بار، منظم' }
      ],
      TRAINING_FOCUS: [
        { v: 'core', t: 'شکم و مرکز بدن' },
        { v: 'lower', t: 'باسن و پا' },
        { v: 'full', t: 'کل بدن' }
      ],
      TRAINING_TIME: [
        { v: '10', t: '۱۰ دقیقه' },
        { v: '15', t: '۱۵ دقیقه' },
        { v: '20', t: '۲۰ دقیقه' }
      ],
      CADENCE: [
        { v: '1', t: '۱ روز' },
        { v: '3', t: '۳ روز' },
        { v: '4', t: '۴ روز' },
        { v: '5', t: '۵ روز' },
        { v: '7', t: 'هر روز' }
      ],
      GENDER: [
        { v: 'female', t: 'زن' },
        { v: 'male', t: 'مرد' },
        { v: 'non_binary', t: 'غیردودویی' },
        { v: 'prefer_not_to_say', t: 'ترجیح می‌دم نگم' }
      ],
      ACTIVITY: [
        { v: 'not_active', t: 'کم‌تحرک', d: 'با بالا رفتن از پله هم نفسم تند می‌شه.' },
        { v: 'lightly_active', t: 'کمی فعال', d: 'گاهی تمرین کوتاه یا پیاده‌روی دارم.' },
        { v: 'moderately_active', t: 'فعالیت متوسط', d: 'هفته‌ای یک تا دو تمرین منظم دارم.' },
        { v: 'highly_active', t: 'خیلی فعال', d: 'ورزش بخش ثابت سبک زندگی منه.' }
      ],
      WEIGHT_DIRECTION: [
        { v: 'down', t: 'کم بشه' },
        { v: 'hold', t: 'ثابت بمونه' },
        { v: 'up', t: 'بیشتر بشه' },
        { v: 'no_scale_goal', t: 'هدف وزنی ندارم' }
      ],
      CALORIE_EXPERIENCE: [
        { v: 'new', t: 'تازه می‌خوام شروع کنم' },
        { v: 'quit', t: 'قبلاً امتحان کردم و رها شد' },
        { v: 'current', t: 'الان هم کالری می‌شمارم' }
      ],
      DIET: [
        { v: 'balanced', t: 'متعادل' },
        { v: 'vegetarian', t: 'گیاه‌خواری' },
        { v: 'vegan', t: 'وگان' },
        { v: 'paleo', t: 'پالئو' },
        { v: 'keto', t: 'کتوژنیک' },
        { v: 'high_protein', t: 'پروتئین بالا' }
      ],
      EXCLUSIONS: [
        { v: 'all_meat', t: 'همه گوشت‌ها' },
        { v: 'animal_products', t: 'محصولات حیوانی' },
        { v: 'citrus', t: 'مرکبات' },
        { v: 'dairy', t: 'لبنیات' },
        { v: 'eggs', t: 'تخم‌مرغ' },
        { v: 'fish', t: 'ماهی' },
        { v: 'gluten', t: 'گلوتن' },
        { v: 'nuts', t: 'مغزها' },
        { v: 'red_meat', t: 'گوشت قرمز' },
        { v: 'seafood', t: 'غذای دریایی' },
        { v: 'seeds', t: 'دانه‌ها' },
        { v: 'shellfish', t: 'صدف' },
        { v: 'soy', t: 'سویا' }
      ],
      HABIT_FOCUS: [
        { v: 'less_sugar', t: 'نوشیدنی‌های شیرین رو کمتر کنم' },
        { v: 'less_fast_food', t: 'کمتر سراغ فست‌فود و تنقلات برم' },
        { v: 'regular_meals', t: 'وعده‌هام منظم‌تر باشه' },
        { v: 'more_produce', t: 'میوه و سبزی بیشتری بخورم' },
        { v: 'just_learn', t: 'فعلاً فقط غذاهام رو بهتر بشناسم' }
      ],
      HABIT_FIRST_STEP: {
        less_sugar: 'امروز یکی از نوشیدنی‌های شیرینت رو با آب عوض کن.',
        less_fast_food: 'برای یکی از وعده‌های امروز، یک گزینهٔ خونگی انتخاب کن.',
        regular_meals: 'یکی از وعده‌هات رو امروز سر ساعت همیشگی بخور.',
        more_produce: 'به یکی از وعده‌های امروزت یک میوه یا سبزی اضافه کن.',
        just_learn: 'اولین وعده‌ات رو ثبت کن و ببین چی توشه.'
      },
      FIRST_ACTION: [
        { v: 'open_training', t: 'مسیر تمرینم رو باز کنم' },
        { v: 'log_meal', t: 'اولین وعده‌ام رو با عکس ثبت کنم' },
        { v: 'view_plan', t: 'برنامهٔ وعده‌هام رو ببینم' },
        { v: 'explore', t: 'فعلاً اپ رو ببینم' }
      ]
    },

    // ترتیب مراحل — منطبق بر جریان واقعی اپ اصلی (بدون مراحل بازنشسته/پرداخت/گوردولک)
    onboardingSteps: [
      'welcome', 'primary-goal', 'motivation', 'obstacle', 'obstacle-response',
      'training-invite', 'training-style', 'training-now', 'training-focus', 'training-time', 'training-cadence',
      'gender', 'age', 'activity', 'height', 'current-weight', 'target-weight', 'weight-direction',
      'plan', 'nutrition-invite', 'tracking-experience', 'diet', 'restrictions', 'meal-structure',
      'habit-focus', 'starting-point', 'preparing'
    ],

    startOnboarding() {
      this.onboardingData.stepIndex = 0;
      this.renderOnboardingStep();
    },

    onbNav(stepEl, back) {
      const d = this.onboardingData;
      d.stepIndex = Math.max(0, Math.min(this.onboardingSteps.length - 1, d.stepIndex + (back ? -1 : 1)));
      // پرش از مراحل شرطی
      const step = this.onboardingSteps[d.stepIndex];
      if (!back && step === 'training-style' && d.trainingInvite === 'no') d.stepIndex += 5; // از تمام مراحل تمرین رد شو
      if (back && (this.onboardingSteps[d.stepIndex] === 'training-invite') && d.trainingInvite === 'no') { /* عادی */ }
      if (!back && step === 'nutrition-invite' && d.weightDirection === 'no_scale_goal' && false) { /* نگه داشتن جریان */ }
      this.renderOnboardingStep();
    },

    onbOptionList(key, field, stepBack) {
      // رندر لیست گزینه‌های تک‌انتخابی اورجینال
      const d = this.onboardingData;
      return this.ONB[key].map(o => `
        <div class="swap-card-item ${String(d[field]) === String(o.v) ? 'selected' : ''}" data-onb-v="${esc(o.v)}">
          <div style="text-align:right;">
            <div style="font-size:0.95rem; font-weight:800;">${esc(o.t)}</div>
            ${o.d ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-top:3px;">${esc(o.d)}</div>` : ''}
          </div>
          <span class="onb-check">✓</span>
        </div>`).join('');
    },

    onbChrome(title, subtitle, bodyHtml, showBack, nextLabel, nextId) {
      return `
        <div class="onb-progress"><div class="onb-progress-bar" style="width:${Math.round(((this.onboardingData.stepIndex + 1) / this.onboardingSteps.length) * 100)}%"></div></div>
        <div class="card onb-card">
          <h2 class="onb-title">${esc(title)}</h2>
          ${subtitle ? `<p class="onb-subtitle">${esc(subtitle)}</p>` : ''}
          ${bodyHtml}
          <div class="onb-nav-row">
            ${showBack ? '<button class="btn-secondary onb-back" style="width:auto; padding:0 18px;">→ قبلی</button>' : '<span></span>'}
            ${nextLabel ? `<button class="btn-primary onb-next" id="${esc(nextId || 'onb-next')}" style="flex:1;">${esc(nextLabel)}</button>` : ''}
          </div>
        </div>`;
    },

    renderOnboardingStep() {
      const main = document.querySelector('main.main-content');
      if (!main) return;
      const d = this.onboardingData;
      const step = this.onboardingSteps[d.stepIndex];
      const O = this.ONB;

      const pickList = (key, field, backTarget) => {
        main.innerHTML = this.onbChrome('', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList(key, field)}</div>`, true, null);
        main.querySelectorAll('[data-onb-v]').forEach(el => {
          el.addEventListener('click', () => {
            d[field] = el.dataset.onbV;
            this.onbNav(main, false);
          });
        });
        main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
        return;
      };

      switch (step) {
        case 'welcome': {
          main.innerHTML = this.onbChrome(
            'به گردول خوش اومدی!',
            'مربی هوش مصنوعی ورزش و تغذیه — قراره با هم به هدفت برسیم. چند سؤال کوتاه ازت می‌پرسم تا برنامه دقیق تو ساخته بشه.',
            `<div style="display:flex; flex-direction:column; gap:10px; margin-bottom:16px;">
              <div class="onb-feature"><span style="color:var(--accent-purple);">${GordolIcon('dumbbell', 20)}</span><span>تمرین روزانه با ویدیو و چشم هوشمند</span></div>
              <div class="onb-feature"><span style="color:#f59e0b;">${GordolIcon('camera', 20)}</span><span>ثبت غذا فقط با عکس یا تایپ</span></div>
              <div class="onb-feature"><span style="color:#10b981;">${GordolIcon('target', 20)}</span><span>پیش‌بینی روز رسیدن به هدفت</span></div>
            </div>`, false, 'شروع کنیم', 'onb-start');
          document.getElementById('onb-start').addEventListener('click', () => this.onbNav(main, false));
          break;
        }

        case 'primary-goal':
          main.innerHTML = this.onbChrome('هدف اصلی‌ات از اومدن به گردول چیه؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('PRIMARY_GOAL', 'primaryGoal')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.primaryGoal = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'motivation':
          main.innerHTML = this.onbChrome('چی بیشترین انگیزه رو بهت می‌ده؟', 'شناخت انگیزه به مربی کمک می‌کنه دقیق‌تر برنامه بسازه.', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('MOTIVATION', 'motivation')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.motivation = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'obstacle':
          main.innerHTML = this.onbChrome('بزرگ‌ترین مانع تا امروزت چی بوده؟', 'برنامه‌ت رو جوری می‌چینیم که این مانع نتونه متوقفت کنه.', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('OBSTACLE', 'obstacle')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.obstacle = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'obstacle-response': {
          const resp = O.OBSTACLE_RESPONSE[d.obstacle] || 'بریم جلو!';
          main.innerHTML = this.onbChrome('', resp, `<div style="text-align:center; font-size:2.6rem; padding:12px 0;">💪</div>`, true, 'ادامه');
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          document.getElementById('onb-next').addEventListener('click', () => this.onbNav(main, false));
          break;
        }

        case 'training-invite':
          main.innerHTML = this.onbChrome('می‌خوای مسیر تمرینی هم برات بچینم؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('TRAINING_INVITE', 'trainingInvite')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.trainingInvite = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'training-style':
          main.innerHTML = this.onbChrome('سبک تمرینی مورد علاقه‌ت چیه؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('TRAINING_STYLE', 'trainingStyle')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.trainingStyle = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'training-now':
          main.innerHTML = this.onbChrome('الان چقدر فعالیت ورزشی داری؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('TRAINING_NOW', 'trainingNow')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.trainingNow = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'training-focus':
          main.innerHTML = this.onbChrome('بیشتر روی کدوم بخش بدنت می‌خوای تمرکز کنی؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('TRAINING_FOCUS', 'trainingFocus')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.trainingFocus = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'training-time':
          main.innerHTML = this.onbChrome('هر جلسه تمرین چقدر می‌تونی وقت بذاری؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('TRAINING_TIME', 'trainingMinutes')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.trainingMinutes = parseInt(el.dataset.onbV, 10); this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'training-cadence':
          main.innerHTML = this.onbChrome('چند روز در هفته می‌خوای تمرین کنی؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('CADENCE', 'weeklyCadence')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.weeklyCadence = parseInt(el.dataset.onbV, 10); this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'gender':
          main.innerHTML = this.onbChrome('جنسیتت؟', 'برای دقت فرمول‌های متابولیسم لازمش داریم.', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('GENDER', 'gender')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.gender = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'age':
          main.innerHTML = this.onbChrome('چند سالته؟', '',
            `<div class="form-group"><input type="number" id="onb-age" class="form-input onb-big-input" value="${esc(d.age)}" min="13" max="90"/></div>`, true, 'ادامه ➡️');
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          document.getElementById('onb-next').addEventListener('click', () => {
            d.age = parseInt(document.getElementById('onb-age').value, 10) || 26;
            this.onbNav(main, false);
          });
          break;

        case 'activity':
          main.innerHTML = this.onbChrome('در حالت عادی روزانه‌ات چقدر فعالی؟', 'جواب صادقانه = محاسبه دقیق کالری.', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('ACTIVITY', 'activity')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.activity = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'height':
          main.innerHTML = this.onbChrome('قدت چقدره؟', '',
            `<div class="form-group"><input type="number" id="onb-height" class="form-input onb-big-input" value="${esc(d.heightCm)}" min="120" max="230"/><div class="onb-unit">سانتی‌متر</div></div>`, true, 'ادامه ➡️');
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          document.getElementById('onb-next').addEventListener('click', () => {
            d.heightCm = parseFloat(document.getElementById('onb-height').value) || 178;
            this.onbNav(main, false);
          });
          break;

        case 'current-weight':
          main.innerHTML = this.onbChrome('وزن فعلیت چقدره؟', '',
            `<div class="form-group"><input type="number" id="onb-weight" class="form-input onb-big-input" value="${esc(d.weightKg)}" min="35" max="300" step="0.1"/><div class="onb-unit">کیلوگرم</div></div>`, true, 'ادامه ➡️');
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          document.getElementById('onb-next').addEventListener('click', () => {
            d.weightKg = parseFloat(document.getElementById('onb-weight').value) || 80;
            this.onbNav(main, false);
          });
          break;

        case 'target-weight':
          main.innerHTML = this.onbChrome('به چه وزنی برسی خوشحال می‌شی؟', '',
            `<div class="form-group"><input type="number" id="onb-goal-weight" class="form-input onb-big-input" value="${esc(d.goalWeightKg)}" min="35" max="300" step="0.1"/><div class="onb-unit">کیلوگرم</div></div>`, true, 'ادامه ➡️');
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          document.getElementById('onb-next').addEventListener('click', () => {
            d.goalWeightKg = parseFloat(document.getElementById('onb-goal-weight').value) || 74;
            this.onbNav(main, false);
          });
          break;

        case 'weight-direction':
          main.innerHTML = this.onbChrome('وزنت رو می‌خوای چی بشه؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('WEIGHT_DIRECTION', 'weightDirection')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.weightDirection = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'plan': {
          // پیش‌نمایش برنامه — مثل مرحله plan اپ اصلی
          const preview = this.computeOnboardingPlan();
          main.innerHTML = this.onbChrome('برنامه‌ات آماده‌ست!', 'این چیزیه که گردول بر اساس جواب‌هات برایت چیده:',
            `<div style="display:flex; flex-direction:column; gap:10px;">
              <div class="onb-plan-row"><span>🔥 کالری روزانه</span><b>${faNum(preview.targetKcal)} kcal</b></div>
              <div class="onb-plan-row"><span>🥩 پروتئین</span><b>${faNum(preview.proteinG)} گرم</b></div>
              <div class="onb-plan-row"><span>🌾 کربوهیدرات</span><b>${faNum(preview.carbsG)} گرم</b></div>
              <div class="onb-plan-row"><span>🥑 چربی</span><b>${faNum(preview.fatG)} گرم</b></div>
              <div class="onb-plan-row"><span>💧 آب</span><b>${faNum(preview.waterMl)} میلی‌لیتر</b></div>
              <div class="onb-plan-row"><span>🏋️ مسیر تمرین</span><b>${esc(preview.pathTitle)}</b></div>
            </div>`, true, 'عالیه، ادامه بده');
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          document.getElementById('onb-next').addEventListener('click', () => this.onbNav(main, false));
          break;
        }

        case 'nutrition-invite':
          main.innerHTML = this.onbChrome('حالا بریم سراغ تغذیه؟', 'برنامه غذایی ایرانی + ثبت عکس غذا منتظرته.', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('YES_NO', 'nutritionInvite')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.nutritionInvite = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'tracking-experience':
          main.innerHTML = this.onbChrome('سابقه کالری‌شماریت چیه؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('CALORIE_EXPERIENCE', 'trackingExperience')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.trackingExperience = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'diet':
          main.innerHTML = this.onbChrome('الگوی غذایی‌ات چیه؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('DIET', 'diet')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.diet = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'restrictions': {
          const opts = O.EXCLUSIONS.map(o => `
            <div class="swap-card-item ${d.exclusions.includes(o.v) ? 'selected' : ''}" data-excl="${esc(o.v)}">
              <div style="font-size:0.92rem; font-weight:800;">${esc(o.t)}</div>
              <span class="onb-check">${d.exclusions.includes(o.v) ? '✓' : '+'}</span>
            </div>`).join('');
          main.innerHTML = this.onbChrome('محدودیت یا پرهیز غذایی داری؟', 'هر چند تا که لازمه انتخاب کن — یا رد شو.', opts, true, 'ادامه ➡️');
          main.querySelectorAll('[data-excl]').forEach(el => el.addEventListener('click', () => {
            const v = el.dataset.excl;
            const i = d.exclusions.indexOf(v);
            if (i >= 0) d.exclusions.splice(i, 1); else d.exclusions.push(v);
            el.classList.toggle('selected');
            el.querySelector('.onb-check').textContent = d.exclusions.includes(v) ? '✓' : '+';
          }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          document.getElementById('onb-next').addEventListener('click', () => this.onbNav(main, false));
          break;
        }

        case 'meal-structure':
          main.innerHTML = this.onbChrome('ساختار وعده‌هات در یک روز معمولی چطوره؟', '',
            `<div style="display:flex; flex-direction:column; gap:10px;">
              ${[2, 3, 4, 5].map(n => `
                <div class="swap-card-item ${d.mealsPerDay === n ? 'selected' : ''}" data-meals="${n}">
                  <div style="font-size:0.95rem; font-weight:800;">${faNum(n)} وعده</div>
                  <span class="onb-check">✓</span>
                </div>`).join('')}
            </div>`, true);
          main.querySelectorAll('[data-meals]').forEach(el => el.addEventListener('click', () => {
            d.mealsPerDay = parseInt(el.dataset.meals, 10);
            this.onbNav(main, false);
          }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'habit-focus':
          main.innerHTML = this.onbChrome('دوست داری اول روی کدوم عادت تمرکز کنیم؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('HABIT_FOCUS', 'habitFocus')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.habitFocus = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'starting-point':
          main.innerHTML = this.onbChrome('از کجا شروع کنیم؟', '', `<div style="display:flex; flex-direction:column; gap:10px;">${this.onbOptionList('FIRST_ACTION', 'firstAction')}</div>`, true);
          main.querySelectorAll('[data-onb-v]').forEach(el => el.addEventListener('click', () => { d.firstAction = el.dataset.onbV; this.onbNav(main, false); }));
          main.querySelector('.onb-back').addEventListener('click', () => this.onbNav(main, true));
          break;

        case 'preparing': {
          const firstStep = O.HABIT_FIRST_STEP[d.habitFocus] || '';
          this.finishOnboarding();
          main.innerHTML = `
            <div class="onb-preparing">
              <div style="color:var(--accent-purple);">${GordolIcon('sparkles', 44)}</div>
              <h2 style="font-size:1.25rem; font-weight:800; margin-top:12px;">در حال آماده‌سازی برنامه تو...</h2>
              <p style="font-size:0.85rem; color:var(--text-muted); margin-top:8px; line-height:1.8;">
                ${esc(firstStep ? 'قدم اول امروزت: ' + firstStep : '')}
              </p>
            </div>`;
          // هدایت خودکار بر اساس starting-point
          setTimeout(() => {
            if (d.firstAction === 'open_training') this.switchTab('workout');
            else if (d.firstAction === 'log_meal') { this.switchTab('diet'); this.openFoodScannerModal(); }
            else if (d.firstAction === 'view_plan') this.switchTab('diet');
            else this.switchTab('today');
          }, 1800);
          break;
        }

        default:
          this.onbNav(main, false);
      }
    },

    // محاسبات برنامه در حین آنبوردینگ (بدون ذخیره)
    computeOnboardingPlan() {
      const d = this.onboardingData;
      let bmr = (10 * d.weightKg) + (6.25 * d.heightCm) - (5 * d.age);
      bmr += d.gender === 'male' ? 5 : (d.gender === 'female' ? -161 : -78);
      const PAL = { not_active: 1.2, lightly_active: 1.375, moderately_active: 1.55, highly_active: 1.725 };
      const tdee = Math.round(bmr * (PAL[d.activity] || 1.375));

      const dir = d.weightDirection === 'down' || (d.goalWeightKg < d.weightKg) ? 'down'
        : (d.weightDirection === 'up' || (d.goalWeightKg > d.weightKg) ? 'up' : 'hold');
      let targetKcal = tdee;
      let weeklyRateKg = 0;
      if (dir === 'down') { targetKcal = Math.max(1350, tdee - 500); weeklyRateKg = d.weeklyCadence >= 4 ? 0.75 : 0.6; }
      else if (dir === 'up') { targetKcal = tdee + 350; weeklyRateKg = 0.35; }

      const proteinG = Math.round(d.weightKg * 2.0);
      const fatG = Math.round((targetKcal * 0.25) / 9);
      const carbsG = Math.max(30, Math.round((targetKcal - (proteinG * 4) - (fatG * 9)) / 4));

      let waterMl = Math.round(d.weightKg * 35);
      if (d.trainingMinutes >= 20) waterMl += 500;

      let selectedPath;
      if (d.trainingInvite === 'no') selectedPath = 'fatburn-path';
      else if (d.trainingNow === 'none' && d.trainingFocus === 'full') selectedPath = 'starter-path';
      else if (d.trainingFocus === 'core') selectedPath = 'core-path';
      else if (d.trainingFocus === 'lower') selectedPath = 'glute-path';
      else if (dir === 'up' || d.primaryGoal === 'get_stronger') selectedPath = 'fullbody-path';
      else selectedPath = 'fatburn-path';

      const planTitle = ((window.GORDOL_PLANS || []).find(p => p.slug === selectedPath) || {}).titleFa || 'چالش چربی‌سوزی';

      return { bmr: Math.round(bmr), tdee, targetKcal, proteinG, carbsG, fatG, waterMl, selectedPath, pathTitle: planTitle, dir, weeklyRateKg };
    },

    finishOnboarding() {
      const d = this.onboardingData;
      const plan = this.computeOnboardingPlan();

      const deltaKg = Math.abs(d.weightKg - d.goalWeightKg);
      const targetWeeks = (plan.weeklyRateKg > 0 && deltaKg > 0) ? Math.max(4, Math.ceil(deltaKg / plan.weeklyRateKg)) : 0;
      const estimatedTotalDays = targetWeeks * 7;

      this.profile = {
        // پاسخ‌های دقیق آنبوردینگ اورجینال
        primaryGoal: d.primaryGoal, motivation: d.motivation, obstacle: d.obstacle,
        trainingInvite: d.trainingInvite, trainingStyle: d.trainingStyle, trainingNow: d.trainingNow,
        trainingFocus: d.trainingFocus, trainingMinutes: d.trainingMinutes, weeklyCadence: d.weeklyCadence,
        gender: d.gender, age: d.age, activity: d.activity,
        heightCm: d.heightCm, weightKg: d.weightKg, goalWeightKg: d.goalWeightKg,
        weightDirection: d.weightDirection, nutritionInvite: d.nutritionInvite,
        trackingExperience: d.trackingExperience, diet: d.diet, exclusions: d.exclusions.slice(),
        mealsPerDay: d.mealsPerDay, habitFocus: d.habitFocus, firstAction: d.firstAction,
        // مقادیر محاسباتی
        bmr: plan.bmr, tdee: plan.tdee, targetKcal: plan.targetKcal,
        proteinG: plan.proteinG, carbsG: plan.carbsG, fatG: plan.fatG, waterMl: plan.waterMl,
        selectedPath: plan.selectedPath, currentDay: 1,
        startDate: todayKey(),
        deltaKg, weeklyRateKg: plan.weeklyRateKg, targetWeeks, estimatedTotalDays,
        reminderTime: '18:00',
        weightHistory: [{ date: todayKey(), kg: d.weightKg }]
      };

      this.saveProfile();
      this.renderHeader();
      this.initNotificationSystem();
      toast('پروفایل تو ساخته شد؛ برنامه شخصی‌ات آماده است! 🎉');
    },

    // محاسبه مجدد پیش‌بینی هدف (پس از تغییر وزن یا بازتنظیم AI)
    recomputeProjection() {
      const p = this.profile;
      if (!p) return;
      p.deltaKg = Math.abs(p.weightKg - p.goalWeightKg);
      const dir = p.weightDirection === 'down' || (p.goalWeightKg < p.weightKg) ? 'down'
        : (p.weightDirection === 'up' || (p.goalWeightKg > p.weightKg) ? 'up' : 'hold');
      let rate;
      if (dir === 'down') rate = p.weeklyCadence >= 4 ? 0.75 : 0.6;
      else if (dir === 'up') rate = 0.35;
      else rate = 0;
      p.weeklyRateKg = rate;
      if (rate > 0 && p.deltaKg > 0) {
        p.targetWeeks = Math.max(1, Math.ceil(p.deltaKg / rate));
        p.estimatedTotalDays = p.targetWeeks * 7;
      } else {
        p.targetWeeks = 0;
        p.estimatedTotalDays = 0;
      }
      this.saveProfile();
    },

    calcStreak() {
      let streak = 0;
      let offset = 0;
      const todayDone = (this.logs[todayKey()] || {}).dayCompleted;
      if (!todayDone) offset = 1;
      for (;;) {
        const key = dateKeyOffset(-offset - streak);
        const l = this.logs[key];
        if (l && l.dayCompleted) streak++;
        else break;
        if (streak > 365) break;
      }
      return streak;
    },

    // ================= بخش ۶: تب امروز =================

    renderTodayTab(container) {
      const p = this.profile;
      if (!p) return;
      const t = this.getDayLog(todayKey());
      const loggedCal = t.meals.reduce((s, m) => s + (m.cal || 0), 0);
      const loggedP = t.meals.reduce((s, m) => s + (m.p || 0), 0);
      const calPercent = Math.min(100, Math.round((loggedCal / p.targetKcal) * 100));
      const waterPercent = Math.min(100, Math.round((t.waterMl / p.waterMl) * 100));
      const streak = this.calcStreak();

      let goalDateText = '—';
      if (p.estimatedTotalDays > 0) {
        const startDate = p.startDate ? new Date(p.startDate + 'T00:00:00') : new Date();
        const goalDate = new Date(startDate.getTime() + p.estimatedTotalDays * 86400000);
        goalDateText = faDateLong(goalDate);
      }

      container.innerHTML = `
        <div class="target-projection-card">
          <div class="projection-header">
            <span>${GordolIcon('target', 17)} روز رسیدن به هدف</span>
            <span style="font-size:0.72rem; background:rgba(16,185,129,0.2); color:#10b981; padding:2px 8px; border-radius:6px;">محاسبه علمی</span>
          </div>
          <div class="proj-goal-date">${GordolIcon('calendar', 16)} حدود <b>${esc(goalDateText)}</b> به وزن هدف (${faNum(p.goalWeightKg)} کیلو) می‌رسی</div>
          <p style="font-size:0.78rem; color:#fff; line-height:1.6; margin-top:6px;">
            با نرخ ایمن <b>${faNum(p.weeklyRateKg || 0)} کیلو در هفته</b> از ${faNum(p.weightKg)} به ${faNum(p.goalWeightKg)} کیلوگرم.
          </p>
          <div class="projection-stats">
            <div class="proj-stat-box">
              <div class="proj-stat-val">${p.estimatedTotalDays > 0 ? faNum(p.estimatedTotalDays) + ' روز' : 'حفظ وزن'}</div>
              <div class="proj-stat-lbl">کل مسیر (${faNum(p.targetWeeks || 0)} هفته)</div>
            </div>
            <div class="proj-stat-box">
              <div class="proj-stat-val">روز ${faNum(p.currentDay)}</div>
              <div class="proj-stat-lbl">پیشرفت فعال فعلی</div>
            </div>
            <div class="proj-stat-box">
              <div class="proj-stat-val">${faNum(streak)} روز 🔥</div>
              <div class="proj-stat-lbl">استریک تمرین پشت‌سرهم</div>
            </div>
            <div class="proj-stat-box">
              <div class="proj-stat-val">${p.deltaKg > 0 ? faNum(Math.round(p.deltaKg * 10) / 10) + ' کیلو' : 'بدون فاصله'}</div>
              <div class="proj-stat-lbl">فاصله تا وزن هدف</div>
            </div>
          </div>
          <p style="font-size:0.7rem; color:var(--text-muted); margin-top:8px;">
            پیشرفت روز فقط با تکمیل تمرین ثبت می‌شود — وزن‌کشی منظم دقت پیش‌بینی را بالاتر می‌برد.
          </p>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div class="card eye-shortcut" style="padding:14px; margin-bottom:0; cursor:pointer;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:#10b981;">${GordolIcon('eye', 26)}</span>
              <span style="font-size:0.7rem; background:rgba(16,185,129,0.2); color:#10b981; padding:2px 8px; border-radius:999px; font-weight:700;">چشم هوشمند</span>
            </div>
            <div style="margin-top:10px;">
              <h4 style="font-size:0.95rem; font-weight:800; color:#fff;">چشم گِردول</h4>
              <p style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">شمارش تکرار و کنترل فرم با دوربین، برای همه حرکات</p>
            </div>
          </div>
          <div class="card food-shortcut" style="padding:14px; margin-bottom:0; cursor:pointer;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:#f59e0b;">${GordolIcon('camera', 26)}</span>
              <span style="font-size:0.7rem; background:rgba(245,158,11,0.2); color:#f59e0b; padding:2px 8px; border-radius:999px; font-weight:700;">تحلیل تصویر</span>
            </div>
            <div style="margin-top:10px;">
              <h4 style="font-size:0.95rem; font-weight:800; color:#fff;">دوربین تغذیه</h4>
              <p style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">عکس یا متن غذا → کالری و ماکرو دقیق</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>${GordolIcon('flame', 17)} کالری و ماکروهای امروز</span>
            <span style="font-size:0.85rem; color:var(--accent-purple); font-weight:800;">${faNum(loggedCal)} / ${faNum(p.targetKcal)} kcal</span>
          </div>
          <div style="height:10px; background:var(--bg-elevated); border-radius:5px; overflow:hidden; margin:12px 0;">
            <div style="height:100%; width:${calPercent}%; background:linear-gradient(90deg, var(--accent-purple), var(--accent-coral)); border-radius:5px; transition:width 0.3s;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:10px;">
            <span class="macro-tag prot">پروتئین: ${faNum(loggedP)}/${faNum(p.proteinG)} گرم</span>
            <span class="macro-tag carb">کربوهیدرات: ${faNum(p.carbsG)} گرم</span>
            <span class="macro-tag fat">چربی: ${faNum(p.fatG)} گرم</span>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn-secondary" style="flex:1; font-size:0.8rem;" id="btn-food-photo">${GordolIcon('camera', 16)} عکس غذا</button>
            <button class="btn-secondary" style="flex:1; font-size:0.8rem;" id="btn-food-text">${GordolIcon('pencil', 16)} متن غذا</button>
            <button class="btn-secondary" style="width:auto; padding:6px 12px; font-size:0.8rem;" id="btn-ai-retune">${GordolIcon('sparkles', 16)} بازتنظیم</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>${GordolIcon('droplet', 17)} مصرف آب روزانه</span>
            <span style="font-size:0.85rem; color:#06b6d4; font-weight:800;">${faNum(t.waterMl)} / ${faNum(p.waterMl)} ml</span>
          </div>
          <div style="height:8px; background:var(--bg-elevated); border-radius:4px; overflow:hidden; margin:10px 0;">
            <div style="height:100%; width:${waterPercent}%; background:#06b6d4; border-radius:4px; transition:width 0.3s;"></div>
          </div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button class="btn-secondary" style="flex:1;" data-water="250">+۱ لیوان (۲۵۰ml)</button>
            <button class="btn-secondary" style="flex:1;" data-water="500">+۱ بطری (۵۰۰ml)</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>${GordolIcon('dumbbell', 17)} تمرین اختصاصی روز ${faNum(p.currentDay)}</span>
            <span style="font-size:0.75rem; color:var(--text-muted);">${t.dayCompleted ? '✅ ثبت شده' : 'در انتظار انجام'}</span>
          </div>
          <p style="color:var(--text-muted); font-size:0.84rem; margin-bottom:12px;">
            مدت: ${faNum(p.trainingMinutes)} دقیقه | تمرکز: ${p.trainingFocus === 'core' ? 'شکم و مرکز بدن' : (p.trainingFocus === 'lower' ? 'باسن و پا' : 'کل بدن')} | سبک: ${p.trainingStyle === 'mastery' ? 'چشم گردول' : 'مسیر روزانه'}
          </p>
          <button class="btn-primary" id="btn-go-workout">${GordolIcon('play', 17)} شروع تمرین امروز</button>
        </div>
      `;

      container.querySelector('.eye-shortcut').addEventListener('click', () => this.openPoseModal(null));
      container.querySelector('.food-shortcut').addEventListener('click', () => this.openFoodScannerModal());
      document.getElementById('btn-food-photo').addEventListener('click', () => this.openFoodScannerModal());
      document.getElementById('btn-food-text').addEventListener('click', () => this.openFoodTextModal());
      document.getElementById('btn-ai-retune').addEventListener('click', () => this.aiRetuneTargets());
      container.querySelectorAll('[data-water]').forEach(b => {
        b.addEventListener('click', () => this.addWater(parseInt(b.dataset.water, 10)));
      });
      document.getElementById('btn-go-workout').addEventListener('click', () => this.switchTab('workout'));
    },

    addWater(ml) {
      const t = this.getDayLog(todayKey());
      t.waterMl += ml;
      this.saveLogs();
      this.renderTodayTab(document.querySelector('main.main-content'));
      if (t.waterMl >= this.profile.waterMl && !this.notifSentToday('water-goal')) {
        this.markNotifSent('water-goal');
        this.sendLocalNotification('💧 هدف آب امروز کامل شد!', 'متابولیسم بدنت امروز شارژ است. آفرین قهرمان!');
      }
    },

    // بازتنظیم هوشمند اهداف با AI (مشابه workout-tune اپ اصلی)
    async aiRetuneTargets() {
      if (!GordolAI.hasKey()) { this.openMandatoryApiModal(); return; }
      toast('مربی گردول در حال بازتنظیم برنامه...');
      const p = this.profile;
      const last7 = [];
      for (let i = 0; i < 7; i++) {
        const k = dateKeyOffset(-i);
        const l = this.logs[k];
        if (l && (l.meals.length || l.dayCompleted)) {
          last7.push({ date: k, calories: l.meals.reduce((s, m) => s + (m.cal || 0), 0), waterMl: l.waterMl, workoutDone: !!l.dayCompleted });
        }
      }
      const prompt = `تو مربی ارشد و کارشناس تغذیه بالینی گردول هستی. بر اساس پروفایل و هفت روز گذشته کاربر، اهداف روزانه او را بازتنظیم کن.
پروفایل: جنسیت ${p.gender}، سن ${p.age}، قد ${p.heightCm}، وزن ${p.weightKg}، وزن هدف ${p.goalWeightKg}، هدف اصلی ${p.primaryGoal}، تمرین ${p.weeklyCadence} روز در هفته، ${p.trainingMinutes} دقیقه.
اهداف فعلی: کالری ${p.targetKcal}، پروتئین ${p.proteinG}، کربوهیدرات ${p.carbsG}، چربی ${p.fatG}، آب ${p.waterMl} میلی‌لیتر.
رکورد روزهای اخیر: ${JSON.stringify(last7)}
[قانون سخت]: نرخ کاهش وزن هرگز از ۱ کیلوگرم در هفته بیشتر نشود و کالری از ۱۳۵۰ کمتر نشود. اگر رکورد خالی است اهداف فعلی را حفظ کن.
فقط JSON برگردان با کلیدها: targetKcal, proteinG, carbsG, fatG, waterMl (همه عدد), note (یک جمله انگیزشی فارسی).`;
      try {
        const res = await GordolAI.generateJSON(prompt, ['targetKcal', 'proteinG', 'carbsG', 'fatG', 'waterMl', 'note'],
          { numericKeys: ['targetKcal', 'proteinG', 'carbsG', 'fatG', 'waterMl'] });
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
        p.targetKcal = clamp(res.targetKcal, 1350, 4500);
        p.proteinG = clamp(res.proteinG, 40, 350);
        p.carbsG = clamp(res.carbsG, 20, 600);
        p.fatG = clamp(res.fatG, 20, 200);
        p.waterMl = clamp(res.waterMl, 1200, 6000);
        this.saveProfile();
        this.recomputeProjection();
        this.renderTodayTab(document.querySelector('main.main-content'));
        toast('✅ ' + (res.note || 'اهداف روزانه بازتنظیم شد.'));
      } catch (e) {
        toast('خطا در بازتنظیم: ' + e.message, false);
      }
    },

    // ================= بخش ۷: تب تمرین =================

    getPlan() {
      const p = this.profile;
      return (window.GORDOL_PLANS || []).find(pl => pl.slug === p.selectedPath) || window.GORDOL_PLANS[0];
    },

    getDayTemplate(plan, day) {
      const chapter = plan.chapters.find(ch => day >= ch.from && day <= ch.to) || plan.chapters[0];
      const tIdx = (day - chapter.from) % chapter.templates.length;
      return { chapter, template: chapter.templates[tIdx], templateIdx: tIdx };
    },

    renderWorkoutTab(container) {
      const p = this.profile;
      if (!p) return;
      const plan = this.getPlan();
      const { chapter, template, templateIdx } = this.getDayTemplate(plan, p.currentDay);
      const t = this.getDayLog(todayKey());

      container.innerHTML = `
        <div class="card" style="background:linear-gradient(135deg, rgba(156,107,255,0.15), rgba(255,127,92,0.15)); border-color:var(--accent-purple);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div style="flex:1;">
              <h3 style="font-size:1.1rem; font-weight:800; color:#fff;">${esc(plan.titleFa)} — روز ${faNum(p.currentDay)}</h3>
              <p style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">${esc(template.name)} · ${esc(plan.subtitle)}</p>
              <div style="display:flex; gap:8px; margin-top:12px; font-size:0.78rem; font-weight:700; flex-wrap:wrap;">
                <span class="macro-tag">${GordolIcon('timer', 13)} ${faNum(p.trainingMinutes)} دقیقه</span>
                <span class="macro-tag">${GordolIcon('refresh', 13)} ${faNum(chapter.rounds)} راند</span>
                <span class="macro-tag">${GordolIcon('dumbbell', 13)} ${faNum(template.training.length)} حرکت اصلی</span>
              </div>
            </div>
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem; flex-shrink:0;" id="btn-switch-program">${GordolIcon('refresh', 14)} تغییر مسیر</button>
          </div>
        </div>

        <button class="btn-emerald" style="width:100%; padding:14px; font-size:1rem;" id="btn-start-session">
          ${GordolIcon('play', 17)} شروع جلسه تمرین با تایمر
        </button>
        <p style="text-align:center; font-size:0.72rem; color:var(--text-muted); margin:8px 0 16px;">
          ویدیو + تایمر + بوق + استراحت خودکار — مثل مربی واقعی کنارت هستیم
        </p>

        <h4 style="font-size:0.92rem; font-weight:800; margin:8px 0 10px; color:var(--accent-purple);">۱. گرم کردن (${faNum(template.warmup.length)} حرکت)</h4>
        <div style="display:flex; flex-direction:column; gap:10px;" id="list-warmup"></div>
        <h4 style="font-size:0.92rem; font-weight:800; margin:20px 0 10px; color:var(--accent-coral);">۲. تمرین اصلی (${faNum(template.training.length)} حرکت)</h4>
        <div style="display:flex; flex-direction:column; gap:10px;" id="list-training"></div>
        <h4 style="font-size:0.92rem; font-weight:800; margin:20px 0 10px; color:var(--accent-emerald);">۳. سرد کردن و کشش (${faNum(template.cooldown.length)} حرکت)</h4>
        <div style="display:flex; flex-direction:column; gap:10px;" id="list-cooldown"></div>

        <div style="margin-top:24px; padding-bottom:20px;">
          <button class="btn-secondary" style="width:100%; padding:12px;" id="btn-manual-complete">
            ${GordolIcon('check-circle', 17)} امروز را بیرون از اپ تمرین کردم — ثبت دستی
          </button>
        </div>
      `;

      const renderList = (listEl, ids) => {
        const restSec = Math.max(10, chapter.rest[templateIdx % chapter.rest.length] || 20);
        ids.forEach(rawId => {
          const finalId = this.swaps.exercises[rawId] || rawId;
          const e = (window.GORDOL_EXERCISES || []).find(x => x.id === finalId) || { id: finalId, nameFa: finalId, targetFa: 'عمومی' };
          const done = (t.exercises || []).some(x => x.exId === finalId);
          const card = document.createElement('div');
          card.className = 'card';
          card.style.cssText = 'margin-bottom:0; padding:12px;';
          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <h5 style="font-size:0.9rem; font-weight:800; color:#fff;">${esc(e.nameFa)}</h5>
                  ${this.swaps.exercises[rawId] ? '<span style="font-size:0.62rem; background:var(--accent-purple); color:#fff; padding:1px 6px; border-radius:6px;">جایگزین</span>' : ''}
                  ${done ? '<span style="font-size:0.62rem; background:rgba(16,185,129,0.25); color:#10b981; padding:1px 6px; border-radius:6px;">✔ انجام شد</span>' : ''}
                </div>
                <div style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">${esc(e.targetFa || 'عضلات هدف')}</div>
                <div style="display:flex; gap:5px; margin-top:6px; flex-wrap:wrap;">
                  <span class="macro-tag" style="font-size:0.7rem;">${faNum(chapter.rounds)} ست × ${e.measure === 'SECONDS' ? faNum(e.suggestedSeconds || 30) + ' ثانیه' : faNum(e.suggestedReps || 12) + ' تکرار'}</span>
                  <span class="macro-tag" style="font-size:0.7rem;">استراحت ${faNum(restSec)} ثانیه</span>
                </div>
              </div>
              <div style="display:flex; gap:5px; flex-shrink:0;">
                <button class="btn-secondary mini" data-act="video" title="ویدیو و نکات">${GordolIcon('play', 14)}</button>
                <button class="btn-emerald mini" data-act="eye" title="چشم گردول">${GordolIcon('eye', 14)}</button>
                <button class="btn-secondary mini" data-act="swap" title="جایگزینی">${GordolIcon('refresh', 14)}</button>
              </div>
            </div>
          `;
          card.querySelector('[data-act="video"]').addEventListener('click', () => this.openVideoModal(finalId));
          card.querySelector('[data-act="eye"]').addEventListener('click', () => this.openPoseModal(finalId));
          card.querySelector('[data-act="swap"]').addEventListener('click', () => this.openExerciseSwapModal(rawId));
          listEl.appendChild(card);
        });
      };

      renderList(document.getElementById('list-warmup'), template.warmup);
      renderList(document.getElementById('list-training'), template.training);
      renderList(document.getElementById('list-cooldown'), template.cooldown);

      document.getElementById('btn-start-session').addEventListener('click', () => this.startSessionPlayer());
      document.getElementById('btn-switch-program').addEventListener('click', () => this.openProgramSwitcher());
      document.getElementById('btn-manual-complete').addEventListener('click', () => {
        if (confirm(`تمام تمرینات روز ${p.currentDay} را انجام داده‌ای؟`)) {
          this.completeWorkoutDay(Math.round(p.trainingMinutes * 60));
        }
      });
    },

    completeWorkoutDay(workedSeconds) {
      const p = this.profile;
      const t = this.getDayLog(todayKey());
      if (t.dayCompleted) {
        toast('روز امروز قبلاً ثبت شده است.', false);
        return;
      }
      t.dayCompleted = true;
      t.workoutSeconds = workedSeconds || 0;
      p.currentDay++;
      this.saveLogs();
      this.saveProfile();
      this.renderHeader();
      this.sendLocalNotification('یک روز دیگر به هدف نزدیک‌تر شدی!', `روز ${faNum(p.currentDay - 1)} کامل شد. استریک تو ادامه دارد 🔥`);
      toast(`آفرین قهرمان! روز ${faNum(p.currentDay - 1)} ثبت شد`);
      this.switchTab('workout');
    },

    // ---------- سوییچر ۱۰ برنامه تمرینی اورجینال ----------
    openProgramSwitcher() {
      if (!this.profile) return;
      const modal = document.getElementById('program-switcher-modal');
      const plans = window.GORDOL_PLANS || [];
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">🔄 انتخاب مسیر تمرینی</h3>
          <button class="btn-close progs-close">×</button>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
          هر ۱۰ برنامه اورجینال گردول با دیتای کامل فصل‌ها. روز فعلی تو حفظ می‌شود.
        </p>
        <div style="display:flex; flex-direction:column; gap:10px; max-height:60vh; overflow-y:auto;">
          ${plans.map(pl => `
            <div class="swap-card-item ${this.profile.selectedPath === pl.slug ? 'selected' : ''}" data-prog="${esc(pl.slug)}">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:1.6rem;">${pl.icon || '🏋️'}</span>
                <div>
                  <div style="font-size:0.9rem; font-weight:800; color:#fff;">${esc(pl.titleFa)}</div>
                  <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">${esc(pl.subtitle || '')}</div>
                </div>
              </div>
              ${this.profile.selectedPath === pl.slug ? '<span style="color:#10b981; font-weight:800;">✓ فعال</span>' : '<button class="btn-secondary" style="width:auto; padding:4px 10px; font-size:0.72rem;">انتخاب</button>'}
            </div>
          `).join('')}
        </div>
      `;
      modal.classList.add('active');
      modal.querySelector('.progs-close').addEventListener('click', () => modal.classList.remove('active'));
      modal.querySelectorAll('[data-prog]').forEach(el => {
        el.addEventListener('click', () => {
          this.profile.selectedPath = el.dataset.prog;
          this.saveProfile();
          modal.classList.remove('active');
          this.renderWorkoutTab(document.querySelector('main.main-content'));
          toast('مسیر تمرینی تغییر کرد ✅');
        });
      });
    },

    // ---------- پلیر جلسه تمرین (تایمر خودکار) ----------

    startSessionPlayer() {
      const p = this.profile;
      const plan = this.getPlan();
      const { chapter, template, templateIdx } = this.getDayTemplate(plan, p.currentDay);
      const workSec = Math.max(20, chapter.work[templateIdx % chapter.work.length] || 30);
      const restSec = Math.max(10, chapter.rest[templateIdx % chapter.rest.length] || 20);

      const items = [];
      for (let r = 1; r <= chapter.rounds; r++) {
        template.warmup.forEach(id => items.push({ exId: id, phase: 'گرم کردن', kind: 'work', sec: Math.min(workSec, 30), round: r }));
        template.training.forEach(id => items.push({ exId: id, phase: 'تمرین اصلی', kind: 'work', sec: workSec, round: r }));
        if (r < chapter.rounds) {
          items.push({ exId: null, phase: 'استراحت', kind: 'rest', sec: restSec + 10, round: r });
        }
      }
      template.cooldown.forEach(id => {
        const hold = (chapter.coolHold || {})[id];
        items.push({ exId: id, phase: 'کشش پایانی', kind: 'work', sec: hold || 40, round: chapter.rounds });
      });

      this.sessionPlayer = {
        items, idx: -1, remaining: 0, timerId: null, paused: false,
        startedAt: Date.now(), workedTotal: 0,
        totalRounds: chapter.rounds, workSec, restSec
      };

      const modal = document.getElementById('session-player-modal');
      modal.querySelector('.modal-card').style.maxWidth = '480px';
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title" id="sp-title">آماده‌سازی جلسه...</h3>
          <span style="font-size:0.74rem; color:var(--text-muted); font-weight:700;" id="sp-counter"></span>
          <button class="btn-close" id="sp-close">×</button>
        </div>
        <div class="sp-video-box">
          <video id="sp-video" autoplay loop muted playsinline></video>
          <div class="sp-rest-overlay" id="sp-rest-overlay" style="display:none;">
            <div style="color:#60a5fa;">${GordolIcon('droplet', 40)}</div>
            <div style="font-size:1.1rem; font-weight:800; color:#fff; margin-top:8px;">نفس بگیر و آب بنوش</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:4px;">عضلاتت رو ریلکس کن — حرکت بعدی نزدیکه</div>
          </div>
          <div class="sp-phase-badge" id="sp-phase">—</div>
        </div>
        <div style="display:flex; align-items:center; justify-content:center; margin:14px 0;">
          <div class="sp-timer-wrap">
            <svg viewBox="0 0 120 120" class="sp-timer-svg">
              <circle cx="60" cy="60" r="54" class="sp-timer-bg"/>
              <circle cx="60" cy="60" r="54" class="sp-timer-fg" id="sp-timer-circle"/>
            </svg>
            <div class="sp-timer-num" id="sp-timer-num">۰</div>
          </div>
        </div>
        <div style="text-align:center; min-height:48px;">
          <div style="font-size:0.78rem; color:var(--text-muted);" id="sp-next">—</div>
        </div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="btn-secondary" style="flex:1;" id="sp-pause">${GordolIcon('pause', 15)} مکث</button>
          <button class="btn-secondary" style="flex:1;" id="sp-skip">رد کردن ${GordolIcon('skip', 15)}</button>
          <button class="btn-secondary" style="width:auto; padding:0 14px; color:#ef4444;" id="sp-end">پایان</button>
        </div>
      `;
      modal.classList.add('active');

      document.getElementById('sp-close').addEventListener('click', () => this.endSessionPlayer(false));
      document.getElementById('sp-end').addEventListener('click', () => this.endSessionPlayer(false));
      document.getElementById('sp-pause').addEventListener('click', () => {
        const sp = this.sessionPlayer;
        if (!sp) return;
        sp.paused = !sp.paused;
        document.getElementById('sp-pause').innerHTML = sp.paused ? GordolIcon('play', 15) + ' ادامه' : GordolIcon('pause', 15) + ' مکث';
      });
      document.getElementById('sp-skip').addEventListener('click', () => this.advanceSessionItem());

      this.advanceSessionItem();
    },

    advanceSessionItem() {
      const sp = this.sessionPlayer;
      if (!sp) return;
      // احتساب زمان واقعی اجراشده‌ی آیتم قبلی (نه زمان کامل در صورت رد کردن)
      const prev = sp.items[sp.idx];
      if (prev && prev.kind === 'work') {
        sp.workedTotal += Math.max(0, prev.sec - Math.max(0, sp.remaining));
      }
      sp.idx++;
      if (sp.idx >= sp.items.length) { this.endSessionPlayer(true); return; }
      const item = sp.items[sp.idx];
      sp.remaining = item.sec;
      sp.paused = false; // باگ: حرکت بعدی نباید مکث‌شده از آیتم قبل به ارث برسد

      const ex = item.exId ? (window.GORDOL_EXERCISES || []).find(e => e.id === (this.swaps.exercises[item.exId] || item.exId)) : null;

      document.getElementById('sp-title').textContent = ex ? ex.nameFa : (item.phase || 'استراحت');
      const cnt = document.getElementById('sp-counter');
      if (cnt) cnt.textContent = 'حرکت ' + faNum(sp.idx + 1) + ' از ' + faNum(sp.items.length);
      const roundTxt = item.kind === 'rest'
        ? 'استراحت'
        : `${item.phase} · ست ${faNum(item.round)} از ${faNum(sp.totalRounds)}`;
      document.getElementById('sp-phase').textContent = roundTxt;
      document.getElementById('sp-phase').className = 'sp-phase-badge' + (item.kind === 'rest' ? ' rest' : '');
      const pauseBtn = document.getElementById('sp-pause');
      if (pauseBtn) pauseBtn.innerHTML = GordolIcon('pause', 15) + ' مکث';

      // کادر ویدیو: در استراحت به جای ویدیوی سیاه، اورلی تنفس نمایش داده می‌شود
      const restOverlay = document.getElementById('sp-rest-overlay');
      const video = document.getElementById('sp-video');
      if (item.kind === 'rest') {
        if (video) video.style.display = 'none';
        if (restOverlay) restOverlay.style.display = 'flex';
      } else {
        if (restOverlay) restOverlay.style.display = 'none';
        if (video) video.style.display = '';
      }

      const nextItem = sp.items[sp.idx + 1];
      const nextEx = nextItem && nextItem.exId ? (window.GORDOL_EXERCISES || []).find(e => e.id === (this.swaps.exercises[nextItem.exId] || nextItem.exId)) : null;
      document.getElementById('sp-next').innerHTML = nextItem
        ? `بعدی: ${nextItem.kind === 'rest' ? 'استراحت ' + faNum(nextItem.sec) + ' ثانیه‌ای' : esc(nextEx ? nextEx.nameFa : '') + ' (' + (nextEx && nextEx.measure === 'SECONDS' ? faNum(nextEx.suggestedSeconds || 30) + ' ثانیه' : faNum(nextEx ? nextEx.suggestedReps || 12 : 12) + ' تکرار') + ')'} <span style="opacity:0.7;">— ست ${faNum(nextItem.round)}/${faNum(sp.totalRounds)}</span>`
        : '🎉 آخرین حرکت — تمومش کن!';

      if (ex && ex.videoUrl && video) {
        const expected = ex.videoUrl;
        if (!video.getAttribute('src') || !video.getAttribute('src').endsWith(expected)) {
          video.setAttribute('src', expected);
          video.load();
        }
        video.play().catch(() => {});
      } else if (video) {
        video.removeAttribute('src');
      }

      // نمایش فوری شمارنده (بدون انتظار برای اولین تیک)
      const numNow = document.getElementById('sp-timer-num');
      const circleNow = document.getElementById('sp-timer-circle');
      if (numNow) numNow.textContent = faNum(item.sec);
      if (circleNow) {
        const cFull = 2 * Math.PI * 54;
        circleNow.style.strokeDasharray = cFull;
        circleNow.style.strokeDashoffset = 0;
      }

      this.playBeep(item.kind === 'rest' ? 440 : 880, 0.18);
      if (sp.timerId) clearInterval(sp.timerId);
      sp.timerId = setInterval(() => {
        if (sp.paused) return;
        sp.remaining--;
        const total = item.sec;
        const left = Math.max(0, sp.remaining);
        if (left <= 3 && left > 0) this.playBeep(660, 0.09);
        const numEl = document.getElementById('sp-timer-num');
        const circle = document.getElementById('sp-timer-circle');
        if (numEl) numEl.textContent = faNum(left);
        if (circle) {
          const c = 2 * Math.PI * 54;
          circle.style.strokeDasharray = c;
          circle.style.strokeDashoffset = c * (1 - left / total);
        }
        if (sp.remaining <= 0) {
          clearInterval(sp.timerId);
          this.advanceSessionItem();
        }
      }, 1000);
    },

    endSessionPlayer(completed) {
      const sp = this.sessionPlayer;
      if (!sp) return;
      if (sp.timerId) clearInterval(sp.timerId);
      const worked = sp.workedTotal;
      const doneItems = sp.items.map(it => it.exId).filter(Boolean);
      this.sessionPlayer = null;
      document.getElementById('session-player-modal').classList.remove('active');

      if (completed) {
        const t = this.getDayLog(todayKey());
        const seen = {};
        doneItems.forEach(id => { seen[this.swaps.exercises[id] || id] = true; });
        Object.keys(seen).forEach(id => {
          if (!t.exercises.some(x => x.exId === id)) t.exercises.push({ exId: id, reps: 0, source: 'session' });
        });
        this.completeWorkoutDay(worked);
      } else {
        toast('جلسه نیمه‌کاره رها شد — هر وقت آماده بودی ادامه بده.', false);
        this.renderWorkoutTab(document.querySelector('main.main-content'));
      }
    },

    // ---------- ویدیو و نکات حرکت ----------

    openVideoModal(exId) {
      const ex = (window.GORDOL_EXERCISES || []).find(e => e.id === exId);
      if (!ex) return;
      const modal = document.getElementById('exercise-player-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <div>
            <h3 class="modal-title">${esc(ex.nameFa)}</h3>
            ${ex.nameEn ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;" dir="ltr">${esc(ex.nameEn)}</div>` : ''}
          </div>
          <button class="btn-close exv-close">×</button>
        </div>
        <div style="border-radius:18px; overflow:hidden; background:#000; margin-bottom:14px;">
          <video controls autoplay loop muted playsinline style="width:100%; max-height:260px; object-fit:cover;">
            <source src="${esc(ex.videoUrl)}" type="video/mp4"/>
          </video>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
          <span class="macro-tag">🎯 ${esc(ex.targetFa || '')}</span>
          <span class="macro-tag">سطح: ${ex.difficulty === 'BEGINNER' ? 'مبتدی' : (ex.difficulty === 'INTERMEDIATE' ? 'متوسط' : (ex.difficulty === 'NOVICE' ? 'نیمه‌مبتدی' : 'پیشرفته'))}</span>
          <span class="macro-tag">${ex.measure === 'SECONDS' ? faNum(ex.suggestedSeconds || 30) + ' ثانیه' : faNum(ex.suggestedReps || 12) + ' تکرار'}</span>
        </div>
        ${ex.summaryFa ? `<div style="background:rgba(156,107,255,0.1); border-radius:14px; padding:10px 12px; margin-bottom:12px; font-size:0.8rem; color:#fff; line-height:1.6;">${esc(ex.summaryFa)}</div>` : ''}
        <div class="ex-details-section">
          ${(ex.stepsFa || []).length ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title steps">${GordolIcon('list-ordered', 16)}<span>مراحل اجرای صحیح:</span></div>
              <ol class="ex-list">${ex.stepsFa.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
            </div>` : ''}
          ${(ex.cuesFa || []).length ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title cues">${GordolIcon('lightbulb', 16)}<span>نکات کلیدی مربی گردول:</span></div>
              <ul class="ex-list">${ex.cuesFa.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
            </div>` : ''}
          ${(ex.mistakesFa || []).length ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title mistakes">${GordolIcon('triangle-alert', 16)}<span>اشتباهات رایج:</span></div>
              <ul class="ex-list">${ex.mistakesFa.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
            </div>` : ''}
          ${ex.cautionFa ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title caution">${GordolIcon('octagon-alert', 16)}<span>هشدار پزشکی:</span></div>
              <p style="font-size:0.78rem; color:#fca5a5; line-height:1.6;">${esc(ex.cautionFa)}</p>
            </div>` : ''}
        </div>
        <div style="display:flex; gap:8px; margin-top:14px;">
          <button class="btn-emerald" style="flex:1;" id="exv-eye">${GordolIcon('eye', 16)} تمرین با چشم گردول</button>
        </div>
      `;
      modal.classList.add('active');
      modal.querySelector('.exv-close').addEventListener('click', () => modal.classList.remove('active'));
      document.getElementById('exv-eye').addEventListener('click', () => {
        modal.classList.remove('active');
        this.openPoseModal(exId);
      });
    },

    // ---------- جایگزینی حرکت ----------

    openExerciseSwapModal(rawExId) {
      const all = window.GORDOL_EXERCISES || [];
      const current = all.find(e => e.id === rawExId) || {};
      const muscleKey = (current.targetFa || '').split(/[ ،,]/)[0];
      let alternatives = all.filter(e => e.id !== rawExId && muscleKey && (e.targetFa || '').includes(muscleKey));
      if (alternatives.length < 4) {
        const extra = all.filter(e => e.id !== rawExId && !alternatives.includes(e) && (e.targetFa || '')).slice(0, 10);
        alternatives = alternatives.concat(extra).slice(0, 12);
      }
      alternatives = alternatives.slice(0, 12);

      const modal = document.getElementById('exercise-swap-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">🔄 جایگزینی «${esc(current.nameFa || rawExId)}»</h3>
          <button class="btn-close swapx-close">×</button>
        </div>
        <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:14px;">
          یک حرکت هم‌خانواده انتخاب کن — یا از مربی هوش مصنوعی پیشنهاد بگیر:
        </p>
        <button class="btn-primary" style="margin-bottom:14px; padding:10px;" id="swap-ai-btn">${GordolIcon('sparkles', 16)} پیشنهاد هوشمند جایگزین</button>
        <div id="swap-ai-result" style="display:none; margin-bottom:12px;"></div>
        <div style="display:flex; flex-direction:column; gap:8px; max-height:52vh; overflow-y:auto;">
          <div class="swap-card-item ${!this.swaps.exercises[rawExId] ? 'selected' : ''}" data-swap-id="">
            <div style="font-size:0.9rem; font-weight:800; color:#fff;">${esc(current.nameFa || rawExId)} (حرکت اصلی برنامه)</div>
            <span>✓</span>
          </div>
          ${alternatives.map(alt => `
            <div class="swap-card-item ${this.swaps.exercises[rawExId] === alt.id ? 'selected' : ''}" data-swap-id="${esc(alt.id)}">
              <div>
                <div style="font-size:0.9rem; font-weight:800; color:#fff;">${esc(alt.nameFa)}</div>
                <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">${esc(alt.targetFa || '')} | ${alt.measure === 'SECONDS' ? faNum(alt.suggestedSeconds || 30) + ' ثانیه' : faNum(alt.suggestedReps || 12) + ' تکرار'}</div>
              </div>
              <button class="btn-secondary" style="width:auto; padding:4px 10px; font-size:0.72rem;">انتخاب</button>
            </div>
          `).join('')}
        </div>
      `;
      modal.classList.add('active');
      modal.querySelector('.swapx-close').addEventListener('click', () => modal.classList.remove('active'));

      modal.querySelectorAll('[data-swap-id]').forEach(el => {
        el.addEventListener('click', () => {
          const newId = el.dataset.swapId;
          if (newId) this.swaps.exercises[rawExId] = newId;
          else delete this.swaps.exercises[rawExId];
          this.saveSwaps();
          modal.classList.remove('active');
          this.renderWorkoutTab(document.querySelector('main.main-content'));
          toast('جایگزینی ثبت شد ✅');
        });
      });

      document.getElementById('swap-ai-btn').addEventListener('click', async () => {
        const btn = document.getElementById('swap-ai-btn');
        btn.disabled = true;
        btn.textContent = 'در حال دریافت پیشنهاد مربی...';
        try {
          const pool = alternatives.slice(0, 14).map(a => `${a.id} (${a.nameFa})`).join('، ');
          const prompt = `حرکت فعلی کاربر: «${current.nameFa}» (${current.targetFa || 'عمومی'}).
از بین این گزینه‌های موجود، بهترین جایگزین متناسب با همان گروه عضلانی و سطح سختی را انتخاب کن:
${pool}
فقط JSON برگردان با کلیدها: pickId (شناسه انگلیسی یکی از گزینه‌های بالا), reason (یک جمله فارسی کوتاه).`;
          const res = await GordolAI.generateJSON(prompt, ['pickId', 'reason']);
          const pick = alternatives.find(a => a.id === res.pickId);
          if (!pick) throw new Error('پیشنهاد خارج از فهرست بود');
          const box = document.getElementById('swap-ai-result');
          box.style.display = 'block';
          box.innerHTML = `
            <div style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.4); border-radius:14px; padding:12px;">
              <div style="font-size:0.85rem; font-weight:800; color:#10b981;">${GordolIcon('sparkles', 15)} پیشنهاد مربی: ${esc(pick.nameFa)}</div>
              <div style="font-size:0.76rem; color:var(--text-muted); margin-top:4px;">${esc(res.reason)}</div>
              <button class="btn-emerald" style="width:100%; margin-top:10px; padding:9px; font-size:0.85rem;" id="swap-ai-apply">پذیرش پیشنهاد ✅</button>
            </div>`;
          document.getElementById('swap-ai-apply').addEventListener('click', () => {
            this.swaps.exercises[rawExId] = pick.id;
            this.saveSwaps();
            modal.classList.remove('active');
            this.renderWorkoutTab(document.querySelector('main.main-content'));
            toast('جایگزین هوشمند اعمال شد ✅');
          });
        } catch (e) {
          toast('خطا در پیشنهاد AI: ' + e.message, false);
        }
        btn.disabled = false;
        btn.innerHTML = GordolIcon('sparkles', 16) + ' پیشنهاد هوشمند جایگزین';
      });
    },

    // ================= بخش ۸: چشم گِردول (دوربین واقعی MediaPipe) =================

    async openPoseModal(exId) {
      this.poseExId = exId || 'push-up';
      this.poseFacingMode = /floor|plank|crunch|bridge|superman|lunge|squat|dead|bird|wall|pike|push-up|sit-up|hip/.test(this.poseExId) ? 'environment' : 'user';

      const modal = document.getElementById('pose-camera-modal');
      const card = modal.querySelector('.modal-card');
      card.style.maxWidth = '480px';
      card.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${GordolIcon('eye', 18)} چشم گردول</h3>
          <button class="btn-close" id="pose-close">×</button>
        </div>

        <div style="display:flex; gap:6px; margin-bottom:10px; overflow-x:auto; padding-bottom:4px;">
          ${[
            ['push-up', 'شنا'], ['bodyweight-squat', 'اسکوات'], ['forearm-plank', 'پلانک'],
            ['crunch', 'کرانچ'], ['glute-bridge', 'پل باسن'], ['walking-lunge', 'لانج'],
            ['jumping-jacks', 'پروانه'], ['slalom-mountain-climber', 'مونتین']
          ].map(([id, label]) => `
            <button class="btn-secondary pose-quick" data-ex="${esc(id)}" style="flex-shrink:0; width:auto; padding:5px 12px; font-size:0.76rem;">${esc(label)}</button>
          `).join('')}
        </div>

        <div class="form-group" style="margin-bottom:10px;">
          <select id="pose-ex-select" class="form-select" style="font-size:0.82rem;"></select>
        </div>

        <div class="camera-viewfinder" style="height:300px;">
          <video id="pose-video" autoplay playsinline muted></video>
          <canvas id="pose-canvas"></canvas>
          <div id="pose-counter" class="pose-counter-big">۰</div>
          <div id="pose-info" class="pose-info-badge"></div>
          <div id="pose-warning" class="pose-warning-banner" style="display:none;"></div>
          <div id="pose-loading" class="pose-loading-overlay">
            <div style="text-align:center;">
              <div style="color:var(--accent-purple);">${GordolIcon('eye', 38)}</div>
              <div style="font-size:0.85rem; font-weight:800; color:#fff; margin-top:8px;">در حال بارگذاری موتور بینایی ماشین...</div>
              <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">فقط بار اول — پردازش کاملاً روی دستگاه خودت انجام می‌شود</div>
            </div>
          </div>
        </div>

        <div id="pose-goal-hint" style="font-size:0.76rem; color:var(--text-muted); text-align:center; margin:6px 0;"></div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
          <button class="btn-secondary" style="width:auto; padding:8px 14px; font-size:0.8rem;" id="pose-flip">${GordolIcon('flip', 14)} چرخش</button>
          <button class="btn-emerald" style="width:auto; padding:9px 20px; font-size:0.85rem;" id="pose-finish">${GordolIcon('check', 15)} ثبت و اتمام</button>
        </div>
      `;

      const sel = document.getElementById('pose-ex-select');
      const all = window.GORDOL_EXERCISES || [];
      sel.innerHTML = all.map(e => `<option value="${esc(e.id)}" ${e.id === this.poseExId ? 'selected' : ''}>${esc(e.nameFa)}</option>`).join('');
      sel.addEventListener('change', () => {
        this.poseExId = sel.value;
        this.poseFacingMode = /floor|plank|crunch|bridge|superman|lunge|squat|dead|bird|wall|pike|push-up|sit-up|hip/.test(this.poseExId) ? 'environment' : 'user';
        this.restartPoseEngine();
      });
      card.querySelectorAll('.pose-quick').forEach(b => {
        b.addEventListener('click', () => {
          this.poseExId = b.dataset.ex;
          sel.value = this.poseExId;
          this.poseFacingMode = /floor|plank|crunch|bridge|superman|lunge|squat|dead|bird|wall|pike|push-up|sit-up|hip/.test(this.poseExId) ? 'environment' : 'user';
          this.restartPoseEngine();
        });
      });

      modal.classList.add('active');
      document.getElementById('pose-close').addEventListener('click', () => this.closePoseModal());
      document.getElementById('pose-flip').addEventListener('click', () => {
        this.poseFacingMode = this.poseFacingMode === 'user' ? 'environment' : 'user';
        this.restartPoseEngine();
      });
      document.getElementById('pose-finish').addEventListener('click', () => this.finishPoseSession());

      await this.restartPoseEngine();
    },

    async restartPoseEngine() {
      const ex = (window.GORDOL_EXERCISES || []).find(e => e.id === this.poseExId) || {};
      const detector = window.GordolEye.resolveDetector(this.poseExId);
      const goalText = detector.mech === 'hold'
        ? 'حالت نشست: ثانیه‌شمار فعال است، فرم بدن را حفظ کن'
        : (ex.measure === 'SECONDS'
          ? `هدف: ${faNum(ex.suggestedSeconds || 30)} ثانیه اجرای پیوسته`
          : `هدف: ${faNum(ex.suggestedReps || 12)} تکرار`);
      document.getElementById('pose-goal-hint').textContent =
        (ex.nameFa || this.poseExId) + ' — ' + goalText;
      document.getElementById('pose-counter').textContent = detector.mech === 'hold' ? '۰ ثانیه' : '۰';

      try {
        if (this.poseStream) this.poseStream.getTracks().forEach(t => t.stop());
        this.poseStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.poseFacingMode, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false
        });
        const video = document.getElementById('pose-video');
        video.srcObject = this.poseStream;
        video.style.transform = this.poseFacingMode === 'user' ? 'scaleX(-1)' : 'none';
        await video.play();
      } catch (err) {
        const badge = document.getElementById('pose-warning');
        badge.style.display = 'block';
        badge.textContent = 'دسترسی به دوربین برقرار نشد — مجوز دوربین را تایید کن.';
        return;
      }

      const loadingEl = document.getElementById('pose-loading');
      loadingEl.style.display = 'flex';
      const ok = await window.GordolEye.ensureLoaded();
      loadingEl.style.display = 'none';
      if (!ok) {
        const badge = document.getElementById('pose-warning');
        badge.style.display = 'block';
        badge.textContent = 'موتور بینایی ماشین بارگذاری نشد: ' + (window.GordolEye.loadError || 'خطای نامشخص');
        return;
      }

      this.poseSession = window.GordolEye.createSession(detector);
      this.runPoseLoop();
    },

    runPoseLoop() {
      const video = document.getElementById('pose-video');
      const canvas = document.getElementById('pose-canvas');
      if (!video || !canvas || !this.poseStream || !this.poseSession) return;
      const ctx = canvas.getContext('2d');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      this.poseVideoTs = performance.now();

      const loop = () => {
        if (!this.poseStream || !this.poseSession) return;
        const v = document.getElementById('pose-video');
        const c = document.getElementById('pose-canvas');
        if (!v || !c) return;

        this.poseVideoTs += 33;
        let landmarks = null;
        try {
          const res = window.GordolEye.landmarker.detectForVideo(v, this.poseVideoTs);
          if (res && res.landmarks && res.landmarks.length) landmarks = res.landmarks[0];
        } catch (e) { /* فریم رد شد */ }

        const out = window.GordolEye.step(this.poseSession, landmarks, this.poseFacingMode === 'user');
        this.drawPoseOverlay(ctx, c, landmarks, out);

        const counter = document.getElementById('pose-counter');
        if (counter) counter.textContent = this.poseSession.detector.mech === 'hold'
          ? faNum(out.holdSec) + ' ثانیه' : faNum(out.reps);
        const info = document.getElementById('pose-info');
        if (info) {
          const a = out.angles || {};
          const parts = [];
          if (a.elbow !== undefined) parts.push('آرنج ' + faNum(a.elbow) + '°');
          if (a.knee !== undefined) parts.push('زانو ' + faNum(a.knee) + '°');
          if (a.kneeMin !== undefined) parts.push('زانو ' + faNum(a.kneeMin) + '°');
          if (a.spine !== undefined) parts.push('خط بدن ' + faNum(a.spine) + '°');
          if (a.torsoHip !== undefined) parts.push('تنه ' + faNum(a.torsoHip) + '°');
          if (a.hipLeg !== undefined) parts.push('لگن ' + faNum(a.hipLeg) + '°');
          info.textContent = parts.length ? parts.join(' | ') : (out.personVisible ? 'فرم خوبه، ادامه بده 💪' : 'کل بدنت رو در کادر قرار بده');
          info.style.borderColor = out.formOk ? 'rgba(16,185,129,0.5)' : 'rgba(245,158,11,0.6)';
        }
        const warnEl = document.getElementById('pose-warning');
        if (warnEl) {
          if (out.warning) { warnEl.style.display = 'block'; warnEl.textContent = out.warning; }
          else warnEl.style.display = 'none';
        }
        if (out.justCounted) this.playBeep(880, 0.12);

        this.poseAnimId = requestAnimationFrame(loop);
      };
      loop();
    },

    drawPoseOverlay(ctx, canvas, lms, out) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!lms) return;
      const mirror = this.poseFacingMode === 'user';
      const color = out.formOk ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      window.GORDOL_POSE_CONNECTIONS.forEach(([a, b]) => {
        const p1 = lms[a], p2 = lms[b];
        if (!p1 || !p2) return;
        const v1 = p1.visibility === undefined ? 1 : p1.visibility;
        const v2 = p2.visibility === undefined ? 1 : p2.visibility;
        if (v1 < 0.35 || v2 < 0.35) return;
        ctx.beginPath();
        ctx.moveTo((mirror ? 1 - p1.x : p1.x) * canvas.width, p1.y * canvas.height);
        ctx.lineTo((mirror ? 1 - p2.x : p2.x) * canvas.width, p2.y * canvas.height);
        ctx.stroke();
      });
      [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach(i => {
        const p = lms[i];
        if (!p || (p.visibility !== undefined && p.visibility < 0.35)) return;
        ctx.beginPath();
        ctx.fillStyle = '#0c0d14';
        ctx.arc((mirror ? 1 - p.x : p.x) * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      });
    },

    finishPoseSession() {
      const ex = (window.GORDOL_EXERCISES || []).find(e => e.id === this.poseExId) || {};
      const detector = this.poseSession ? this.poseSession.detector : null;
      const isHold = detector && detector.mech === 'hold';
      const reps = this.poseSession ? this.poseSession.reps : 0;
      const holdSec = this.poseSession ? Math.floor(this.poseSession.holdMs / 1000) : 0;
      const t = this.getDayLog(todayKey());
      const existing = t.exercises.find(x => x.exId === this.poseExId);
      if (existing) {
        existing.reps = isHold ? Math.max(existing.reps || 0, holdSec) : (existing.reps || 0) + reps;
        existing.source = 'eye';
      } else {
        t.exercises.push({ exId: this.poseExId, reps: isHold ? holdSec : reps, source: 'eye' });
      }
      this.saveLogs();
      this.closePoseModal();
      toast(isHold ? `${faNum(holdSec)} ثانیه ${ex.nameFa || ''} ثبت شد ✅` : `${faNum(reps)} تکرار ${ex.nameFa || ''} با تایید چشم گردول ثبت شد ✅`);
    },

    closePoseModal() {
      if (this.poseStream) { this.poseStream.getTracks().forEach(t => t.stop()); this.poseStream = null; }
      if (this.poseAnimId) { cancelAnimationFrame(this.poseAnimId); this.poseAnimId = null; }
      this.poseSession = null;
      const modal = document.getElementById('pose-camera-modal');
      if (modal) modal.classList.remove('active');
    },

    // ================= بخش ۹: تغذیه =================

    renderDietTab(container) {
      const p = this.profile;
      if (!p) return;
      const t = this.getDayLog(todayKey());
      const meals = (window.GORDOL_MEALS && window.GORDOL_MEALS.dailyMeals) || [];
      const grocery = window.GORDOL_GROCERY || [];

      container.innerHTML = `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:14px; background:linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15)); border-color:rgba(245,158,11,0.4);">
          <div>
            <h4 style="font-size:0.95rem; font-weight:800; color:#fff;">${GordolIcon('camera', 17)} اسکن بشقاب غذا با هوش مصنوعی</h4>
            <p style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">عکس بگیر یا غذا رو تایپ کن — کالری و ماکرو خودکار حساب می‌شه</p>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button class="btn-amber" style="width:auto; padding:6px 12px; font-size:0.78rem;" id="diet-scan-photo">${GordolIcon('camera', 15)} عکس</button>
            <button class="btn-secondary" style="width:auto; padding:5px 12px; font-size:0.74rem;" id="diet-scan-text">${GordolIcon('pencil', 14)} متن</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title"><span>${GordolIcon('flame', 17)} ثبت‌شده‌های امروز</span>
            <span style="font-size:0.85rem; color:var(--accent-purple); font-weight:800;">
              ${faNum(t.meals.reduce((s, m) => s + (m.cal || 0), 0))} / ${faNum(p.targetKcal)} kcal
            </span>
          </div>
          <div id="today-meals-list" style="display:flex; flex-direction:column; gap:8px;">
            ${t.meals.length === 0 ? '<div style="text-align:center; padding:14px;"><div style="color:var(--text-muted); display:flex; justify-content:center; margin-bottom:6px;">' + GordolIcon('salad', 30) + '</div><div style="font-size:0.85rem; font-weight:800; color:#fff;">هنوز چیزی ثبت نشده</div><div style="font-size:0.76rem; color:var(--text-muted); margin-top:4px;">اولین وعده‌ات را اسکن یا تایپ کن</div></div>' : ''}
          </div>
        </div>

        ${meals.map(m => this.renderMealCard(m, t)).join('')}

        ${this.renderFastingCard()}

        <div class="card">
          <div class="card-title"><span>${GordolIcon('cart', 17)} لیست خرید هفتگی گردول</span></div>
          ${grocery.map(g => `
            <div style="margin-bottom:12px;">
              <div style="font-size:0.85rem; font-weight:800; color:var(--accent-purple); margin-bottom:6px;">${esc(g.cat)}</div>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${g.items.map(it => `<span class="macro-tag" style="font-size:0.74rem;">${esc(it)}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `;

      const listEl = document.getElementById('today-meals-list');
      t.meals.forEach((m, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:var(--bg-elevated); border-radius:12px; padding:8px 12px;';
        row.innerHTML = `
          <div>
            <span style="font-size:0.85rem; font-weight:800; color:#fff;">${esc(m.name)}</span>
            <span style="font-size:0.7rem; color:var(--text-muted); margin-right:6px;">(${esc(this.mealTypeFa(m.mealType))})</span>
            <div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">🥩 ${faNum(m.p)}g · 🌾 ${faNum(m.c)}g · 🥑 ${faNum(m.f)}g</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.8rem; font-weight:800; color:#f59e0b;">${faNum(m.cal)} kcal</span>
            <button class="btn-close" style="font-size:1rem;" data-del-meal="${i}">×</button>
          </div>
        `;
        row.querySelector('[data-del-meal]').addEventListener('click', () => {
          t.meals.splice(i, 1);
          this.saveLogs();
          this.renderDietTab(container);
        });
        listEl.appendChild(row);
      });

      document.getElementById('diet-scan-photo').addEventListener('click', () => this.openFoodScannerModal());
      document.getElementById('diet-scan-text').addEventListener('click', () => this.openFoodTextModal());

      container.querySelectorAll('[data-meal-swap]').forEach(b => {
        b.addEventListener('click', () => this.openMealSwapModal(b.dataset.mealSwap));
      });
      container.querySelectorAll('[data-meal-scan]').forEach(b => {
        b.addEventListener('click', () => this.openFoodScannerModal(b.dataset.mealScan));
      });
      container.querySelectorAll('[data-fast-action]').forEach(b => {
        b.addEventListener('click', () => this.fastAction(b.dataset.fastAction));
      });

      if (this.fasting && this.fasting.startTs && !this.fasting.endTs) this.startFastingTicker();
    },

    mealTypeFa(t) {
      return { breakfast: 'صبحانه', snack1: 'میان‌وعده صبح', lunch: 'ناهار', snack2: 'میان‌وعده عصر', dinner: 'شام' }[t] || t;
    },

    renderMealCard(meal, todayLog) {
      const active = this.swaps.meals[meal.id] || {
        name: meal.name, desc: meal.current, cal: meal.cal, p: meal.p, c: meal.c || 0, f: meal.f || 0, image: meal.image
      };
      const loggedCount = todayLog.meals.filter(m => m.mealType === meal.id).length;
      return `
        <div class="meal-card-rich">
          <div class="meal-card-banner" style="background:${MEAL_GRADIENT[meal.id] || 'var(--bg-elevated)'};">
            <img src="${esc(active.image || meal.image || '')}" alt="${esc(active.name)}" loading="lazy" onerror="this.style.display='none'"/>
            <div class="meal-badge-time">⏰ ${esc(meal.time)}</div>
            ${loggedCount ? `<div class="meal-badge-time" style="top:10px; left:10px; right:auto; background:rgba(16,185,129,0.85); color:#0c0d14;">✓ ${faNum(loggedCount)} ثبت</div>` : ''}
          </div>
          <div class="meal-card-body">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h4 style="font-size:0.98rem; font-weight:800; color:#fff;">${esc(active.name)}</h4>
              <span style="font-size:0.8rem; font-weight:800; color:var(--accent-gold);">🔥 ${faNum(active.cal)} kcal</span>
            </div>
            <p style="font-size:0.78rem; color:var(--text-muted); margin-top:6px; line-height:1.6;">${esc(active.desc)}</p>
            <div class="macro-row">
              <span class="macro-tag prot">${faNum(active.p)} گرم پروتئین</span>
              <span class="macro-tag carb">${faNum(active.c)} گرم کربوهیدرات</span>
              <span class="macro-tag fat">${faNum(active.f)} گرم چربی</span>
            </div>
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="btn-secondary" style="flex:1; padding:7px; font-size:0.76rem;" data-meal-swap="${esc(meal.id)}">${GordolIcon('refresh', 14)} جایگزینی</button>
              <button class="btn-amber" style="width:auto; padding:7px 12px; font-size:0.76rem;" data-meal-scan="${esc(meal.id)}">${GordolIcon('camera', 14)} ثبت این وعده</button>
            </div>
          </div>
        </div>
      `;
    },

    logMeal(mealType, name, cal, p, c, f) {
      const t = this.getDayLog(todayKey());
      t.meals.push({
        id: 'm' + Date.now(), mealType, name,
        cal: Math.round(cal), p: Math.round(p), c: Math.round(c || 0), f: Math.round(f || 0),
        time: new Date().toTimeString().slice(0, 5)
      });
      this.saveLogs();
    },

    // ---------- جایگزینی وعده غذایی ----------

    openMealSwapModal(mealId) {
      const meal = ((window.GORDOL_MEALS && window.GORDOL_MEALS.dailyMeals) || []).find(m => m.id === mealId);
      if (!meal) return;
      const active = this.swaps.meals[mealId];

      const modal = document.getElementById('meal-swap-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">🔄 جایگزین‌های ${esc(meal.name)}</h3>
          <button class="btn-close swapm-close">×</button>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
          گزینه استاندارد گردول را انتخاب کن یا از AI پیشنهاد بگیر (متناسب با کالری هدف ${faNum(this.profile.targetKcal)}):
        </p>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <button class="btn-primary" style="padding:9px; font-size:0.8rem;" id="swapmeal-ai-btn">${GordolIcon('sparkles', 15)} پیشنهاد هوشمند</button>
          <button class="btn-secondary" style="padding:9px; font-size:0.8rem; width:auto;" id="swapmeal-reset-btn" ${active ? '' : 'disabled'}>بازگشت به اصلی</button>
        </div>
        <div id="swapmeal-ai-result" style="display:none; margin-bottom:12px;"></div>
        <div style="display:flex; flex-direction:column; gap:10px; max-height:52vh; overflow-y:auto;">
          <div class="swap-card-item ${!active ? 'selected' : ''}" data-swap-reset="1">
            <div>
              <div style="font-size:0.9rem; font-weight:800; color:#fff;">${esc(meal.name)} (اصلی)</div>
              <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">${esc(meal.current)}</div>
            </div>
            <span style="font-weight:800; color:#f59e0b;">${faNum(meal.cal)}</span>
          </div>
          ${(meal.swaps || []).map((sw, i) => `
            <div class="swap-card-item ${active && active.name === sw.name ? 'selected' : ''}" data-swap-idx="${i}">
              <div style="display:flex; align-items:center; gap:10px;">
                <img src="${esc(sw.image || meal.image || '')}" alt="${esc(sw.name)}" class="swap-thumb" loading="lazy" onerror="this.style.display='none'"/>
                <div>
                  <div style="font-size:0.88rem; font-weight:800; color:#fff;">${esc(sw.name)}</div>
                  <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">${esc(sw.desc)}</div>
                </div>
              </div>
              <span style="font-weight:800; color:#f59e0b; font-size:0.8rem;">${faNum(sw.cal)}</span>
            </div>
          `).join('')}
        </div>
      `;
      modal.classList.add('active');
      modal.querySelector('.swapm-close').addEventListener('click', () => modal.classList.remove('active'));

      modal.querySelector('[data-swap-reset]').addEventListener('click', () => {
        delete this.swaps.meals[mealId];
        this.saveSwaps();
        modal.classList.remove('active');
        this.renderDietTab(document.querySelector('main.main-content'));
      });
      modal.querySelectorAll('[data-swap-idx]').forEach(el => {
        el.addEventListener('click', () => {
          this.swaps.meals[mealId] = meal.swaps[parseInt(el.dataset.swapIdx, 10)];
          this.saveSwaps();
          modal.classList.remove('active');
          this.renderDietTab(document.querySelector('main.main-content'));
          toast('وعده جایگزین شد ✅');
        });
      });
      document.getElementById('swapmeal-reset-btn').addEventListener('click', () => {
        delete this.swaps.meals[mealId];
        this.saveSwaps();
        modal.classList.remove('active');
        this.renderDietTab(document.querySelector('main.main-content'));
      });

      document.getElementById('swapmeal-ai-btn').addEventListener('click', async () => {
        const btn = document.getElementById('swapmeal-ai-btn');
        btn.disabled = true;
        btn.textContent = '⏳ ...';
        try {
          const p = this.profile;
          const prompt = `برای وعده «${meal.name}» کاربر (کالری هدف روزانه ${p.targetKcal}، رژیم ${p.diet}، پرهیز: ${(Array.isArray(p.exclusions) && p.exclusions.length) ? p.exclusions.join('، ') : 'ندارد'}) یک جایگزین ایرانی سالم پیشنهاد بده با کالری حدود ${meal.cal} و پروتئین حدود ${meal.p} گرم.
فقط JSON با کلیدها برگردان: name (نام فارسی کوتاه), desc (مواد دقیق با مقادیر), cal (عدد), p (عدد), c (عدد), f (عدد).`;
          const res = await GordolAI.generateJSON(prompt, ['name', 'desc', 'cal', 'p', 'c', 'f'],
            { numericKeys: ['cal', 'p', 'c', 'f'] });
          const clampMacro = (v, hi) => Math.max(0, Math.min(hi, Math.round(Number(v) || 0)));
          res.cal = clampMacro(res.cal, 5000);
          res.p = clampMacro(res.p, 500);
          res.c = clampMacro(res.c, 800);
          res.f = clampMacro(res.f, 400);
          const box = document.getElementById('swapmeal-ai-result');
          box.style.display = 'block';
          box.innerHTML = `
            <div class="swap-card-item selected" style="border-color:#10b981;">
              <div>
                <div style="font-size:0.88rem; font-weight:800; color:#10b981;">${GordolIcon('sparkles', 15)} پیشنهاد هوشمند: ${esc(res.name)}</div>
                <div style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">${esc(res.desc)}</div>
                <div style="font-size:0.72rem; color:#f59e0b; margin-top:4px;">🔥 ${faNum(res.cal)} kcal · 🥩 ${faNum(res.p)}g</div>
              </div>
            </div>
            <button class="btn-emerald" style="width:100%; margin-top:8px; padding:9px; font-size:0.85rem;" id="swapmeal-ai-apply">پذیرش ✅</button>`;
          document.getElementById('swapmeal-ai-apply').addEventListener('click', () => {
            this.swaps.meals[mealId] = { name: res.name, desc: res.desc, cal: res.cal, p: res.p, c: res.c, f: res.f, ai: true };
            this.saveSwaps();
            modal.classList.remove('active');
            this.renderDietTab(document.querySelector('main.main-content'));
            toast('جایگزین هوشمند اعمال شد ✅');
          });
        } catch (e) {
          toast('خطا: ' + e.message, false);
        }
        btn.disabled = false;
        btn.innerHTML = GordolIcon('sparkles', 15) + ' پیشنهاد هوشمند';
      });
    },

    // ---------- اسکن عکس غذا ----------

    openFoodScannerModal(targetMeal) {
      this.selectedFoodBase64 = null;
      this.scannedFoodResult = null;
      this.scannedTargetMeal = targetMeal || 'lunch';
      const modal = document.getElementById('food-scanner-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${GordolIcon('camera', 18)} دوربین تغذیه هوشمند</h3>
          <button class="btn-close" id="fsc-close">×</button>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
          از بشقاب غذا عکس بگیر یا از گالری انتخاب کن — AI گردول اجزای بشقاب را تشخیص می‌دهد و کالری و ماکرو تخمین می‌زند.
        </p>
        <div class="camera-viewfinder" style="height:240px; position:relative;">
          <video id="food-video" autoplay playsinline muted></video>
          <img id="food-preview-img" style="display:none; width:100%; height:100%; object-fit:cover; position:absolute; inset:0;"/>
          <div id="food-loading" class="pose-loading-overlay" style="display:none;">
            <div style="text-align:center;">
              <div style="color:#f59e0b;">${GordolIcon('camera', 36)}</div>
              <div style="font-size:0.82rem; font-weight:800; color:#fff; margin-top:8px;">در حال تحلیل بشقاب غذا...</div>
            </div>
          </div>
        </div>
        <input type="file" id="food-file-input" accept="image/*" style="display:none;"/>
        <div style="display:flex; gap:8px; margin:12px 0;">
          <button class="btn-secondary" style="flex:1; font-size:0.78rem;" id="food-capture">${GordolIcon('camera', 15)} گرفتن عکس</button>
          <button class="btn-secondary" style="flex:1; font-size:0.78rem;" id="food-upload">${GordolIcon('image', 15)} از گالری</button>
        </div>
        <div class="form-group">
          <label class="form-label">ثبت در وعده:</label>
          <select id="food-scan-meal-target" class="form-select">
            <option value="breakfast">صبحانه</option>
            <option value="snack1">میان‌وعده صبح</option>
            <option value="lunch" selected>ناهار</option>
            <option value="snack2">میان‌وعده عصر</option>
            <option value="dinner">شام</option>
          </select>
        </div>
        <div id="food-scan-result-card" style="display:none; margin-bottom:12px;" class="card"></div>
        <button id="btn-analyze-food" class="btn-amber" style="width:100%;">${GordolIcon('sparkles', 16)} تحلیل کالری و ماکرو با هوش مصنوعی</button>
      `;
      modal.classList.add('active');
      document.getElementById('fsc-close').addEventListener('click', () => this.closeFoodScannerModal());
      document.getElementById('food-capture').addEventListener('click', () => this.captureFoodPhoto());
      document.getElementById('food-upload').addEventListener('click', () => document.getElementById('food-file-input').click());
      document.getElementById('food-file-input').addEventListener('change', (e) => this.handleFoodImageFile(e));
      document.getElementById('btn-analyze-food').addEventListener('click', () => this.analyzeFoodImage());
      document.getElementById('food-scan-meal-target').value = this.scannedTargetMeal;

      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 960 } }, audio: false })
        .then(stream => {
          this.foodStream = stream;
          const v = document.getElementById('food-video');
          if (v) { v.srcObject = stream; v.play().catch(() => {}); }
        })
        .catch(() => { /* بدون دوربین — آپلود گالری کار می‌کند */ });
    },

    captureFoodPhoto() {
      const video = document.getElementById('food-video');
      const preview = document.getElementById('food-preview-img');
      if (!video || !preview) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      preview.src = dataUrl;
      preview.style.display = 'block';
      this.selectedFoodBase64 = dataUrl.split(',')[1];
      toast('عکس گرفته شد — حالا تحلیل کن ⚡');
    },

    handleFoodImageFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const max = 900;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const preview = document.getElementById('food-preview-img');
          if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
          this.selectedFoodBase64 = dataUrl.split(',')[1];
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },

    async analyzeFoodImage() {
      if (!this.selectedFoodBase64) { toast('اول عکس بگیر یا آپلود کن.', false); return; }
      if (!GordolAI.hasKey()) { this.openMandatoryApiModal(); return; }

      const btn = document.getElementById('btn-analyze-food');
      const loading = document.getElementById('food-loading');
      btn.disabled = true;
      loading.style.display = 'flex';

      const prompt = `تو کارشناس ارشد تغذیه بالینی گردول هستی. این تصویر بشقاب غذا را با دقت تحلیل کن:
۱. اجزای بشقاب را شناسایی کن (نان، برنج، گوشت، سبزیجات، سس و روغن).
۲. وزن تقریبی هر جزء را بر اساس مقیاس ظرف تخمین بزن.
۳. کالری کل و ماکروها را با دقت علمی محاسبه کن (غذاهای ایرانی را کامل بشناس).
فقط JSON با این کلیدها: foodName (نام فارسی), calories (عدد), protein (عدد), carbs (عدد), fat (عدد), healthScore (عدد ۱ تا ۱۰), coachTip (یک جمله نکته مربی به فارسی).`;
      try {
        const res = await GordolAI.generateJSON(prompt, ['foodName', 'calories', 'protein', 'carbs', 'fat', 'healthScore', 'coachTip'],
          { numericKeys: ['calories', 'protein', 'carbs', 'fat', 'healthScore'] });
        this.scannedFoodResult = res;
        this.renderScannedFoodResult(res);
        btn.textContent = 'تحلیل مجدد';
      } catch (e) {
        // خطای ماندگار داخل کارت نتیجه
        const card = document.getElementById('food-scan-result-card');
        card.style.display = 'block';
        card.innerHTML = `<div class="chat-bubble-msg error" style="max-width:100%;">${GordolIcon('triangle-alert', 15)} ${esc(e.message)}<br/><span style="font-size:0.72rem;">دوباره تلاش کن یا از تنظیمات، کلید و اتصال را بررسی کن.</span></div>`;
        btn.textContent = 'تلاش مجدد';
      }
      btn.disabled = false;
      loading.style.display = 'none';
    },

    renderScannedFoodResult(r) {
      const card = document.getElementById('food-scan-result-card');
      card.style.display = 'block';
      card.innerHTML = `
        <h4 style="font-size:0.98rem; font-weight:800; color:#fff; margin-bottom:6px;">🍽️ ${esc(r.foodName)}</h4>
        <div style="display:flex; gap:6px; margin:8px 0; flex-wrap:wrap;">
          <span class="macro-tag cal">🔥 ${faNum(r.calories)} kcal</span>
          <span class="macro-tag prot">🥩 ${faNum(r.protein)}g</span>
          <span class="macro-tag carb">🌾 ${faNum(r.carbs)}g</span>
          <span class="macro-tag fat">🥑 ${faNum(r.fat)}g</span>
        </div>
        <p style="font-size:0.78rem; color:#10b981;">⭐ نمره سلامت: ${faNum(r.healthScore)} از ۱۰</p>
        <p style="font-size:0.76rem; color:var(--text-muted); line-height:1.6; margin-top:4px;">💡 ${esc(r.coachTip)}</p>
        <button class="btn-emerald" style="width:100%; margin-top:10px;" id="food-apply-btn">ثبت این وعده در کالری امروز ✅</button>
      `;
      document.getElementById('food-apply-btn').addEventListener('click', () => {
        const mealType = document.getElementById('food-scan-meal-target').value;
        this.logMeal(mealType, r.foodName, r.calories, r.protein, r.carbs, r.fat);
        this.closeFoodScannerModal();
        this.switchTab('diet');
        toast(`وعده «${r.foodName}» ثبت شد ✅`);
      });
    },

    closeFoodScannerModal() {
      if (this.foodStream) { this.foodStream.getTracks().forEach(t => t.stop()); this.foodStream = null; }
      const modal = document.getElementById('food-scanner-modal');
      if (modal) modal.classList.remove('active');
    },

    // ---------- ثبت غذا با متن ----------

    openFoodTextModal() {
      const modal = document.getElementById('food-text-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${GordolIcon('pencil', 18)} ثبت غذا با متن</h3>
          <button class="btn-close" id="ftx-close">×</button>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
          غذایی که خوردی را بنویس (مثلاً: «۲ کف دست برنج با خورشت قورمه‌سبزی و یک تکه مرغ») — AI گردول تحلیلش می‌کند.
        </p>
        <div class="form-group">
          <textarea id="food-text-input" class="form-input" rows="3" placeholder="غذا و مقدار تقریبی را بنویس..."></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">ثبت در وعده:</label>
          <select id="food-text-meal-target" class="form-select">
            <option value="breakfast">صبحانه</option>
            <option value="snack1">میان‌وعده صبح</option>
            <option value="lunch" selected>ناهار</option>
            <option value="snack2">میان‌وعده عصر</option>
            <option value="dinner">شام</option>
          </select>
        </div>
        <div id="food-text-result" style="display:none; margin-bottom:12px;"></div>
        <button class="btn-amber" style="width:100%;" id="food-text-analyze">${GordolIcon('sparkles', 16)} تحلیل با هوش مصنوعی</button>
      `;
      modal.classList.add('active');
      document.getElementById('ftx-close').addEventListener('click', () => modal.classList.remove('active'));
      document.getElementById('food-text-analyze').addEventListener('click', async () => {
        const text = document.getElementById('food-text-input').value.trim();
        if (!text) { toast('متن غذا را بنویس.', false); return; }
        const btn = document.getElementById('food-text-analyze');
        btn.disabled = true;
        btn.textContent = '⏳ در حال تحلیل...';
        try {
          const prompt = `تو کارشناس تغذیه بالینی گردول هستی. غذای زیر (به فارسی) را تحلیل کن و مقادیر دقیق بر اساس دانش بانک غذاهای ایرانی تخمین بزن:
«${text}»
فقط JSON با کلیدها: foodName (نام استاندارد فارسی غذا), calories (عدد), protein (عدد), carbs (عدد), fat (عدد), healthScore (عدد ۱-۱۰), coachTip (یک جمله فارسی).`;
          const res = await GordolAI.generateJSON(prompt, ['foodName', 'calories', 'protein', 'carbs', 'fat', 'healthScore', 'coachTip'],
            { numericKeys: ['calories', 'protein', 'carbs', 'fat', 'healthScore'] });
          const box = document.getElementById('food-text-result');
          box.style.display = 'block';
          box.innerHTML = `
            <div class="card" style="margin-bottom:10px;">
              <h4 style="font-size:0.95rem; font-weight:800; color:#fff;">🍽️ ${esc(res.foodName)}</h4>
              <div style="display:flex; gap:6px; margin:8px 0; flex-wrap:wrap;">
                <span class="macro-tag cal">🔥 ${faNum(res.calories)} kcal</span>
                <span class="macro-tag prot">🥩 ${faNum(res.protein)}g</span>
                <span class="macro-tag carb">🌾 ${faNum(res.carbs)}g</span>
                <span class="macro-tag fat">🥑 ${faNum(res.fat)}g</span>
              </div>
              <p style="font-size:0.75rem; color:var(--text-muted);">💡 ${esc(res.coachTip)}</p>
              <button class="btn-emerald" style="width:100%; margin-top:10px;" id="food-text-apply">ثبت ✅</button>
            </div>`;
          document.getElementById('food-text-apply').addEventListener('click', () => {
            const mealType = document.getElementById('food-text-meal-target').value;
            this.logMeal(mealType, res.foodName, res.calories, res.protein, res.carbs, res.fat);
            modal.classList.remove('active');
            this.switchTab('diet');
            toast(`«${res.foodName}» ثبت شد ✅`);
          });
        } catch (e) {
          // خطا به صورت ماندگار داخل مودال نمایش داده می‌شود (نه توست زودگذر)
          const box = document.getElementById('food-text-result');
          box.style.display = 'block';
          box.innerHTML = `<div class="chat-bubble-msg error" style="max-width:100%;">${GordolIcon('triangle-alert', 15)} ${esc(e.message)}<br/><span style="font-size:0.72rem;">دوباره تلاش کن یا از تنظیمات، کلید و اتصال را بررسی کن.</span></div>`;
        }
        btn.disabled = false;
        btn.textContent = '⚡ تحلیل با هوش مصنوعی';
      });
    },

    // ---------- فستینگ ۱۶:۸ ----------

    renderFastingCard() {
      const active = this.fasting && this.fasting.startTs && !this.fasting.endTs;
      let inner;
      if (active) {
        const elapsedH = (Date.now() - this.fasting.startTs) / 3600000;
        const stage = elapsedH < 4 ? 'فاز ۱ — گلیکوژن: بدن از قند ذخیره‌شده استفاده می‌کند'
          : elapsedH < 8 ? 'فاز ۲ — سوخت‌وساز: گلیکوژن رو به پایان است'
          : elapsedH < 12 ? 'فاز ۳ — چربی‌سوزی: بدن وارد سوزاندن چربی شده!'
          : 'فاز ۴ — اتوفاژی: سلول‌ها در حال بازیافت و تعمیر هستند';
        inner = `
          <div style="text-align:center;">
            <div style="font-size:1.6rem; font-weight:800; color:#9c6bff;" id="fasting-live-timer">${faNum(this.formatFastingHMS())}</div>
            <div style="font-size:0.74rem; color:var(--text-muted); margin-top:4px;">از هدف ${faNum(16)} ساعته</div>
            <p style="font-size:0.78rem; color:#fff; margin-top:8px; line-height:1.6;">${stage}</p>
            <button class="btn-secondary" style="margin-top:10px;" data-fast-action="stop">پایان فستینگ</button>
          </div>`;
      } else {
        inner = `
          <p style="font-size:0.78rem; color:var(--text-muted); line-height:1.6;">
            فستینگ متناوب ۱۶:۸ — روزه‌داری با پنجره غذایی ۸ ساعته. تایمر زنده با تشریح مراحل بیولوژیک بدن.
          </p>
          <button class="btn-primary" style="margin-top:10px;" data-fast-action="start">شروع فستینگ ۱۶ ساعته</button>`;
      }
      return `
        <div class="card">
          <div class="card-title"><span>${GordolIcon('timer', 17)} ردیاب فستینگ ۱۶:۸ (اختیاری)</span></div>
          ${inner}
        </div>
      `;
    },

    formatFastingHMS() {
      if (!this.fasting || !this.fasting.startTs) return '00:00:00';
      let s = Math.floor((Date.now() - this.fasting.startTs) / 1000);
      const h = Math.floor(s / 3600); s %= 3600;
      const m = Math.floor(s / 60); s %= 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    },

    fastAction(action) {
      if (action === 'start') {
        this.fasting = { startTs: Date.now(), endTs: null };
        localStorage.setItem('gordol_fasting_v3', JSON.stringify(this.fasting));
        this.renderDietTab(document.querySelector('main.main-content'));
        this.startFastingTicker();
        toast('فستینگ شروع شد — موفق باشی! 💪');
      } else if (action === 'stop') {
        if (this.fasting) {
          this.fasting.endTs = Date.now();
          localStorage.setItem('gordol_fasting_v3', JSON.stringify(this.fasting));
          const h = ((Date.now() - this.fasting.startTs) / 3600000).toFixed(1);
          toast(`فستینگ ${faNum(h)} ساعته ثبت شد 🎉`);
        }
        this.renderDietTab(document.querySelector('main.main-content'));
      }
    },

    startFastingTicker() {
      if (this.fastingTicker) clearInterval(this.fastingTicker);
      if (!(this.fasting && this.fasting.startTs && !this.fasting.endTs)) return;
      this.fastingTicker = setInterval(() => {
        const el = document.getElementById('fasting-live-timer');
        if (el) el.textContent = faNum(this.formatFastingHMS());
        else clearInterval(this.fastingTicker);
      }, 1000);
    },

    // ================= بخش ۱۰: مربی هوش مصنوعی =================

    renderCoachTab(container) {
      container.innerHTML = `
        <div class="card" style="padding:16px; margin-bottom:12px; background:linear-gradient(135deg, rgba(156,107,255,0.15), rgba(16,185,129,0.15)); border-color:var(--accent-purple);">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="color:var(--accent-purple);">${GordolIcon('bot', 30)}</span>
              <div>
                <h4 style="font-size:1rem; font-weight:800; color:#fff;">مربی هوشمند گردول</h4>
                <p style="font-size:0.74rem; color:var(--text-muted);">با آگاهی کامل از پرونده تو — حتی عکس بفرست تا تحلیل کنه</p>
              </div>
            </div>
            <button class="btn-clear-chat" id="coach-clear">${GordolIcon('trash', 13)} پاک کردن</button>
          </div>
        </div>

        <div id="coach-chat-box" class="coach-chat-box">
          ${this.chat.length === 0 ? `
            <div class="chat-bubble-msg coach">سلام قهرمان! من مربی هوش مصنوعی گردول هستم. قد، وزن، کالری و برنامه تمرینی‌ت رو کامل در پرونده دارم. هر سؤالی درباره تغذیه، فست‌فودها، جایگزینی غذا، درد و فرم تمرین داری بپرس — یا عکس غذا و دستگاه بدنسازی بفرست تا تحلیلش کنم.</div>
          ` : this.chat.map(m => this.renderChatBubble(m)).join('')}
        </div>

        <div class="coach-input-container">
          <div id="coach-attach-chip" class="coach-attach-preview" style="display:none;">
            <img id="coach-attach-thumb" src="" alt="عکس پیوست"/>
            <span style="font-size:0.72rem; color:#fff;">عکس پیوست شد</span>
            <button class="btn-remove-attach" id="coach-remove-attach">✕</button>
          </div>
          <input type="file" id="coach-file-input" accept="image/*" style="display:none;"/>
          <div class="coach-input-bar">
            <button class="btn-attach" id="coach-attach-btn" title="ارسال عکس برای مربی">${GordolIcon('camera', 19)}</button>
            <input type="text" id="coach-user-msg" class="form-input" placeholder="سوالت رو بنویس (مثلاً پیتزا بخورم؟)..."/>
            <button class="btn-primary" style="width:auto; padding:0 18px;" id="coach-send">${GordolIcon('send', 16)}</button>
          </div>
        </div>
      `;

      const chatBox = document.getElementById('coach-chat-box');
      chatBox.scrollTop = chatBox.scrollHeight;

      document.getElementById('coach-attach-btn').addEventListener('click', () => document.getElementById('coach-file-input').click());
      document.getElementById('coach-file-input').addEventListener('change', (e) => this.handleCoachImageAttach(e));
      document.getElementById('coach-remove-attach').addEventListener('click', () => this.removeCoachAttachedImage());
      document.getElementById('coach-send').addEventListener('click', () => this.sendCoachMessage());
      document.getElementById('coach-user-msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendCoachMessage(); });
      document.getElementById('coach-clear').addEventListener('click', () => {
        this.chat = [];
        this.saveChat();
        this.renderCoachTab(container);
      });
    },

    renderChatBubble(m) {
      const imgHtml = m.img ? `<img src="data:image/jpeg;base64,${esc(m.img)}" style="width:100%; max-height:150px; object-fit:cover; border-radius:10px; margin-bottom:6px;"/>` : '';
      return `<div class="chat-bubble-msg ${m.role === 'user' ? 'user' : 'coach'}">${imgHtml}<span style="white-space:pre-wrap;">${esc(m.text)}</span></div>`;
    },

    handleCoachImageAttach(e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const max = 900;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const chip = document.getElementById('coach-attach-chip');
          const thumb = document.getElementById('coach-attach-thumb');
          if (chip && thumb) { thumb.src = dataUrl; chip.style.display = 'flex'; }
          this.coachAttachedBase64 = dataUrl.split(',')[1];
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },

    removeCoachAttachedImage() {
      this.coachAttachedBase64 = null;
      const chip = document.getElementById('coach-attach-chip');
      if (chip) chip.style.display = 'none';
    },

    buildCoachSystemPrompt() {
      const p = this.profile || this.onboardingData;
      const t = this.getDayLog(todayKey());
      const loggedCal = t.meals.reduce((s, m) => s + (m.cal || 0), 0);
      const loggedP = t.meals.reduce((s, m) => s + (m.p || 0), 0);
      const loggedC = t.meals.reduce((s, m) => s + (m.c || 0), 0);
      const loggedF = t.meals.reduce((s, m) => s + (m.f || 0), 0);
      const streak = this.calcStreak();
      const mealLines = t.meals.length
        ? t.meals.map(m => `  · [${this.mealTypeFa(m.mealType)} ${m.time || ''}] ${m.name} — ${m.cal} kcal (P${m.p}/C${m.c}/F${m.f})`).join('\n')
        : '  (هنوز چیزی ثبت نشده)';
      const exLines = (t.exercises || []).length
        ? t.exercises.map(x => {
            const e = (window.GORDOL_EXERCISES || []).find(y => y.id === x.exId);
            return `  · ${e ? e.nameFa : x.exId}${x.reps ? ' — ' + x.reps + ' تکرار/ثانیه' : ''} (${x.source === 'eye' ? 'با چشم گردول' : x.source === 'session' ? 'با جلسه تایمر' : 'دستی'})`;
          }).join('\n')
        : '  (امروز تمرینی ثبت نشده)';
      const goalDateText = p.estimatedTotalDays > 0
        ? faDateLong(new Date(new Date((p.startDate || todayKey()) + 'T00:00:00').getTime() + p.estimatedTotalDays * 86400000))
        : '—';

      return `تو «مربی ارشد گردول» هستی — یک مربی حرفه‌ای بدنسازی و تغذیه بالینی ایرانی که داخل اپ گردول کار می‌کنی. هویتت: مربی دلسوز، پرانرژی، سخت‌کوش و علمی که پرونده کامل کاربرش را دارد. همیشه به فارسی روان با لحن مربی پاسخ بده و ایموجی مناسب به کار ببر. خودت را معرفی نکن مگر بپرسند؛ در پاسخ‌ها نقش مربیِ او را حفظ کن.

═══ پرونده کاربر ═══
- جنسیت: ${p.gender === 'male' ? 'مرد' : p.gender === 'female' ? 'زن' : 'نگفته'} | سن: ${p.age} | قد: ${p.heightCm} سانتی‌متر
- وزن فعلی: ${p.weightKg} کیلو | وزن هدف: ${p.goalWeightKg} کیلو (${p.weightDirection === 'down' ? 'کاهش' : p.weightDirection === 'up' ? 'افزایش' : 'حفظ'})
- هدف اصلی: ${p.primaryGoal === 'lose_weight' ? 'کاهش وزن' : p.primaryGoal === 'gain_weight' ? 'افزایش وزن' : p.primaryGoal === 'maintain_weight' ? 'حفظ وزن' : p.primaryGoal === 'get_stronger' ? 'قوی‌تر شدن' : p.primaryGoal === 'stay_consistent' ? 'نظم تمرینی' : 'غذای سالم‌تر'} | انگیزه: ${p.motivation} | مانع قبلی: ${p.obstacle}
- اهداف روزانه: کالری ${p.targetKcal} kcal | پروتئین ${p.proteinG}g | کربوهیدرات ${p.carbsG}g | چربی ${p.fatG}g | آب ${p.waterMl}ml
- رژیم: ${p.diet} | پرهیزها: ${(Array.isArray(p.exclusions) && p.exclusions.length) ? p.exclusions.join('، ') : 'ندارد'}
- برنامه تمرین: روز ${p.currentDay} از مسیر «${p.selectedPath}» | سبک: ${p.trainingStyle === 'mastery' ? 'تسلط با چشم گردول' : 'روزانه'} | ${p.weeklyCadence} روز در هفته
- سابقه کالری‌شماری: ${p.trackingExperience === 'new' ? 'تازه‌کار' : p.trackingExperience === 'quit' ? 'قبلاً رها کرده' : 'فعال می‌شمارد'}
- تاریخ پیش‌بینی‌شده رسیدن به هدف: ${goalDateText} | استریک فعلی: ${streak} روز

═══ گزارش کامل امروز (${todayKey()}) ═══
- تمرین امروز: ${t.dayCompleted ? '✅ کامل شده (' + Math.round((t.workoutSeconds || 0) / 60) + ' دقیقه)' : '❌ هنوز کامل نشده'}
- تمرین‌های ثبت‌شده:
${exLines}
- کالری مصرفی امروز: ${loggedCal} از ${p.targetKcal} kcal (${loggedCal >= p.targetKcal ? 'سقف پر شده' : 'باقی‌مانده: ' + Math.max(0, p.targetKcal - loggedCal) + ' kcal'})
- پروتئین: ${loggedP}/${p.proteinG} گرم | کربوهیدرات: ${loggedC}/${p.carbsG} گرم | چربی: ${loggedF}/${p.fatG} گرم
- آب: ${t.waterMl}/${p.waterMl} میلی‌لیتر
- وعده‌های ثبت‌شده:
${mealLines}
- کالری سوزانده تقریبی تمرین امروز: ${Math.round((t.workoutSeconds || 0) * 0.12)} kcal

═══ دستورالعمل پاسخگویی ═══
۱. برای سوال غذایی: کالری واقع‌بینانه بگو و راهکار جا دادن در سقف ${p.targetKcal} کالریِ امروز (با احتساب ${loggedCal} مصرف‌شده) ارائه کن — هرگز سرزنش نکن.
۲. اگر عکسی فرستاده شد، مستقیم تحلیلش کن (بشقاب غذا، دستگاه، فرم بدن).
۳. سوال تمرینی را بیومکانیک‌محور جواب بده و به حرکات برنامه‌اش ارجاع بده.
۴. به وضعیت امروز او مسلطی — اگر پرسید یا مربوط شد، از گزارش بالا استفاده کن (مثلاً «چون امروز فقط ${loggedP} گرم پروتئین خوردی...»).
۵. درخواست خارج از حوزه سلامت را مؤدبانه رد کن. پاسخ‌ها خوانا و پرانرژی باشند.`;
    },

    async sendCoachMessage() {
      const input = document.getElementById('coach-user-msg');
      const msg = input.value.trim();
      const hasPhoto = !!this.coachAttachedBase64;
      if (!msg && !hasPhoto) return;
      if (!GordolAI.hasKey()) { this.openMandatoryApiModal(); return; }

      const chatBox = document.getElementById('coach-chat-box');
      const img = this.coachAttachedBase64;
      this.chat.push({ role: 'user', text: msg || '(عکس ارسال شد)', img });
      chatBox.insertAdjacentHTML('beforeend', this.renderChatBubble(this.chat[this.chat.length - 1]));
      this.removeCoachAttachedImage();
      input.value = '';
      chatBox.scrollTop = chatBox.scrollHeight;

      const loadingId = 'coach-loading-' + Date.now();
      chatBox.insertAdjacentHTML('beforeend', `<div class="chat-bubble-msg coach" id="${loadingId}">در حال فکر کردن...</div>`);
      chatBox.scrollTop = chatBox.scrollHeight;

      const history = this.chat.slice(-9, -1).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

      try {
        let reply;
        const opts = { systemPrompt: this.buildCoachSystemPrompt(), history };
        if (img) {
          reply = await GordolAI.generateWithImage(msg || 'لطفاً این تصویر را تحلیل کن.', img, opts);
        } else {
          reply = await GordolAI.generate(msg, opts);
        }
        const lEl = document.getElementById(loadingId);
        if (lEl) lEl.remove();
        if (!reply) reply = 'الان نتونستم جواب بدم؛ دوباره تلاش کن.';
        this.chat.push({ role: 'coach', text: reply });
        this.saveChat();
        chatBox.insertAdjacentHTML('beforeend', `<div class="chat-bubble-msg coach"><span style="white-space:pre-wrap;">${esc(reply)}</span></div>`);
        chatBox.scrollTop = chatBox.scrollHeight;
      } catch (e) {
        const lEl = document.getElementById(loadingId);
        if (lEl) lEl.remove();
        chatBox.insertAdjacentHTML('beforeend', `<div class="chat-bubble-msg error">${GordolIcon('triangle-alert', 15)} ${esc(e.message)}</div>`);
        chatBox.scrollTop = chatBox.scrollHeight;
      }
    },

    // ================= بخش ۱۱: وزن و روز هدف =================

    openWeightModal() {
      if (!this.profile) { toast('اول آنبوردینگ را کامل کن.', false); return; }
      const modal = document.getElementById('weight-modal');
      const p = this.profile;
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${GordolIcon('scale', 18)} ثبت وزن امروز</h3>
          <button class="btn-close" id="wt-close">×</button>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
          وزن‌کشی منظم (هفته‌ای ۱-۲ بار صبح ناشتا) دقت پیش‌بینی «روز رسیدن به هدف» را بالا می‌برد.
        </p>
        <div class="form-group">
          <label class="form-label">وزن فعلی (کیلوگرم):</label>
          <input type="number" id="wt-input" class="form-input" value="${esc(p.weightKg)}" min="35" max="250" step="0.1"/>
        </div>
        <div style="font-size:0.76rem; color:var(--text-muted); margin-bottom:12px;">
          آخرین وزن‌ها: ${((p.weightHistory || []).slice(-4).reverse().map(w => `${faNum(w.kg)}kg (${esc(faDateLong(new Date(w.date + 'T00:00:00')))})`).join(' · ')) || '—'}
        </div>
        <button class="btn-emerald" style="width:100%;" id="wt-save">ثبت و به‌روزرسانی پیش‌بینی</button>
      `;
      modal.classList.add('active');
      document.getElementById('wt-close').addEventListener('click', () => modal.classList.remove('active'));
      document.getElementById('wt-save').addEventListener('click', () => {
        const kg = parseFloat(document.getElementById('wt-input').value);
        if (!kg || kg < 30 || kg > 300) { toast('وزن نامعتبر است.', false); return; }
        p.weightKg = Math.round(kg * 10) / 10;
        p.weightHistory = p.weightHistory || [];
        p.weightHistory.push({ date: todayKey(), kg: p.weightKg });
        this.recomputeProjection();
        this.saveProfile();
        modal.classList.remove('active');
        if (this.activeTab === 'today') this.renderTodayTab(document.querySelector('main.main-content'));

        const reached = !p.goalCelebrated && (
          (p.primaryGoal === 'lose_weight' && p.weightKg <= p.goalWeightKg) ||
          (p.primaryGoal === 'gain_muscle' && p.weightKg >= p.goalWeightKg));
        if (reached) {
          p.goalCelebrated = true;
          this.saveProfile();
          this.showGoalCelebration();
        }
        else toast('وزن ثبت شد — پیش‌بینی هدف به‌روز شد ✅');
      });
    },

    showGoalCelebration() {
      const modal = document.getElementById('goal-celebration-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div style="text-align:center; padding:10px 0;">
          <div style="color:var(--accent-gold);">${GordolIcon('trophy', 56)}</div>
          <h2 style="font-size:1.4rem; font-weight:800; color:#fff; margin-top:10px;">به وزن هدف رسیدی!</h2>
          <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.8; margin-top:10px;">
            ${faNum(this.profile.goalWeightKg)} کیلوگرم — دقیقاً همون عددی که روز اول گردول کنار هم گذاشتیم!
            <br/>مربی گردول بهت افتخار می‌کنه. حالا وقتشه هدف بعدی رو انتخاب کنی 💪
          </p>
          <button class="btn-primary" style="margin-top:16px;" id="goal-celebrate-close">ادامه می‌دم</button>
        </div>
      `;
      modal.classList.add('active');
      document.getElementById('goal-celebrate-close').addEventListener('click', () => modal.classList.remove('active'));
      this.sendLocalNotification('🏆 هدف تو محقق شد!', `به وزن ${faNum(this.profile.goalWeightKg)} کیلوگرم رسیدی. گردول بهت افتخار می‌کنه!`);
    },

    // ================= بخش ۱۲: تنظیمات، بکاپ و امنیت =================

    openSettingsModal() {
      const modal = document.getElementById('settings-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${GordolIcon('settings', 18)} تنظیمات</h3>
          <button class="btn-close" id="set-close">×</button>
        </div>

        <div class="form-group">
          <label class="form-label">مدل هوش مصنوعی (Google Gemini):</label>
          <select id="set-model" class="form-select"></select>
        </div>
        <div class="form-group">
          <label class="form-label">کلید API:</label>
          <input type="password" id="set-api-key" class="form-input" dir="ltr" value="${esc(GordolAI.config.apiKey)}"/>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:14px;">
          <button class="btn-secondary" style="flex:1; font-size:0.76rem;" id="set-detect">${GordolIcon('search', 14)} شناسایی مدل‌ها</button>
          <button class="btn-secondary" style="flex:1; font-size:0.76rem;" id="set-test">${GordolIcon('zap', 14)} تست اتصال</button>
        </div>
        <div id="set-status" style="font-size:0.76rem; margin-bottom:12px; display:none;"></div>

        <hr style="border:0; border-top:1px solid var(--border-color); margin:14px 0;"/>

        <div class="form-group">
          <label class="form-label">ساعت یادآور تمرین روزانه:</label>
          <input type="time" id="set-reminder" class="form-input" value="${esc((this.profile && this.profile.reminderTime) || '18:00')}"/>
        </div>
        <button class="btn-secondary" style="font-size:0.8rem;" id="set-test-notif">${GordolIcon('bell', 15)} ارسال نوتیفیکیشن تستی</button>

        <hr style="border:0; border-top:1px solid var(--border-color); margin:14px 0;"/>

        <div class="form-group">
          <button class="btn-secondary" style="font-size:0.8rem;" id="set-weight">${GordolIcon('scale', 15)} ثبت وزن جدید</button>
        </div>

        <div style="background:var(--bg-elevated); border-radius:14px; padding:12px; margin-bottom:12px;">
          <h4 style="font-size:0.85rem; font-weight:800; color:#fff; margin-bottom:8px;">${GordolIcon('shield', 15)} داده‌های من (۱۰۰٪ روی همین دستگاه)</h4>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem;" id="set-export">${GordolIcon('download', 14)} دانلود بکاپ</button>
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem;" id="set-import">${GordolIcon('upload', 14)} بازیابی بکاپ</button>
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem; color:#ef4444; border-color:rgba(239,68,68,0.4);" id="set-wipe">${GordolIcon('trash', 14)} پاک‌سازی کامل</button>
          </div>
          <input type="file" id="set-import-file" accept="application/json" style="display:none;"/>
        </div>

        <div style="font-size:0.7rem; color:var(--text-muted); line-height:1.8;">
          🔒 <b>حریم خصوصی:</b> همه داده‌ها (پروفایل، لاگ‌ها، عکس‌ها، چت) فقط در حافظه مرورگر همین دستگاه ذخیره می‌شوند.
          کلید API فقط به سرور رسمی Google ارسال می‌شود و هیچ سرور واسطی در کار نیست.
        </div>

        <div style="display:flex; gap:10px; margin-top:16px;">
          <button class="btn-primary" id="set-save">ذخیره تنظیمات ✅</button>
        </div>
      `;
      modal.classList.add('active');

      const modelSel = document.getElementById('set-model');
      const fillModels = (models, preferred) => {
        modelSel.innerHTML = (models || ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'])
          .map(m => `<option value="${esc(m)}" ${m === preferred ? 'selected' : ''}>${esc(m)}</option>`).join('');
      };
      fillModels(null, GordolAI.config.model);

      document.getElementById('set-close').addEventListener('click', () => modal.classList.remove('active'));
      document.getElementById('set-detect').addEventListener('click', async () => {
        const key = document.getElementById('set-api-key').value.trim();
        const status = document.getElementById('set-status');
        if (!key) { toast('اول کلید را وارد کن.', false); return; }
        status.style.display = 'block'; status.style.color = '#3b82f6';
        status.textContent = 'در حال شناسایی مدل‌ها...';
        try {
          const models = await GordolAI.listModels(key);
          fillModels(models, models.find(m => m.includes('flash')) || models[0]);
          status.style.color = '#10b981';
          status.textContent = `✅ ${faNum(models.length)} مدل شناسایی شد.`;
        } catch (e) {
          status.style.color = '#ef4444';
          status.textContent = 'خطا: ' + e.message;
        }
      });
      document.getElementById('set-test').addEventListener('click', async () => {
        const key = document.getElementById('set-api-key').value.trim();
        const status = document.getElementById('set-status');
        status.style.display = 'block'; status.style.color = '#3b82f6';
        status.textContent = 'در حال تست اتصال...';
        try {
          const ok = await GordolAI.validateKey(key);
          status.style.color = ok ? '#10b981' : '#ef4444';
          status.textContent = ok ? '✅ اتصال برقرار و کلید معتبر است.' : '❌ پاسخ نامعتبر.';
        } catch (e) {
          status.style.color = '#ef4444';
          status.textContent = '❌ ' + e.message;
        }
      });
      document.getElementById('set-test-notif').addEventListener('click', () => this.sendTestNotification());
      document.getElementById('set-weight').addEventListener('click', () => { modal.classList.remove('active'); this.openWeightModal(); });

      document.getElementById('set-export').addEventListener('click', () => {
        // کلید API عمداً در بکاپ نمی‌آید (فایل بکاپ روی دیسک می‌نشیند)
        const backup = { app: 'gordol', version: 3, exportedAt: new Date().toISOString(), data: {} };
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('gordol_') && k !== 'gordol_ai_config_v3') backup.data[k] = localStorage.getItem(k);
        }
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gordol_backup_' + todayKey() + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('بکاپ دانلود شد (کلید API به دلایل امنیتی داخل بکاپ نیست)');
      });

      document.getElementById('set-import').addEventListener('click', () => document.getElementById('set-import-file').click());
      document.getElementById('set-import-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const backup = JSON.parse(ev.target.result);
            if (!backup || backup.app !== 'gordol' || !backup.data) throw new Error('فایل بکاپ نامعتبر است');
            // فهرست سفید کلیدهای شناخته‌شده + اعتبارسنجی نوع — ضد تزریق داده از فایل
            const allowed = {
              gordol_profile_v3: 'object', gordol_logs_v3: 'object', gordol_swaps_v3: 'object',
              gordol_chat_v3: 'array', gordol_fasting_v3: 'object',
              gordol_notif_asked_v3: 'raw', gordol_notif_state_v3: 'object'
            };
            let restored = 0;
            Object.keys(backup.data).forEach(k => {
              if (!(k in allowed)) return;
              const v = backup.data[k];
              if (typeof v !== 'string') return;
              if (allowed[k] === 'raw') { localStorage.setItem(k, v); restored++; return; }
              try {
                const parsed = JSON.parse(v);
                const okType = allowed[k] === 'array' ? Array.isArray(parsed) : (parsed && typeof parsed === 'object');
                if (okType) { localStorage.setItem(k, v); restored++; }
              } catch (err) { /* کلید نامعتبر نادیده گرفته می‌شود */ }
            });
            if (restored === 0) throw new Error('هیچ داده معتبری در فایل نبود');
            toast(`بازیابی ${faNum(restored)} بخش داده — اپ رفرش می‌شود.`);
            setTimeout(() => location.reload(), 900);
          } catch (err) {
            toast('خطا: ' + err.message, false);
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      });

      document.getElementById('set-wipe').addEventListener('click', () => {
        if (!confirm('همه داده‌های گردول روی این دستگاه (پروفایل، لاگ‌ها، چت و کلید API) برای همیشه پاک شود؟')) return;
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('gordol_')) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
        location.reload();
      });

      document.getElementById('set-save').addEventListener('click', () => {
        GordolAI.config.apiKey = document.getElementById('set-api-key').value.trim();
        GordolAI.config.model = document.getElementById('set-model').value;
        GordolAI.saveConfig();
        if (this.profile) {
          this.profile.reminderTime = document.getElementById('set-reminder').value || '18:00';
          this.saveProfile();
        }
        modal.classList.remove('active');
        toast('تنظیمات ذخیره شد ✅');
        this.startNotificationScheduler();
      });
    }
  };

  window.GordolApp = App;

  document.addEventListener('DOMContentLoaded', () => {
    App.init();
  });
})();

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
    return String(n).replace(/[0-9]/g, d => FA_DIGITS[+d]);
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
      try {
        const p = localStorage.getItem('gordol_profile_v3');
        if (p) this.profile = JSON.parse(p);
        const l = localStorage.getItem('gordol_logs_v3');
        if (l) this.logs = JSON.parse(l);
        const s = localStorage.getItem('gordol_swaps_v3');
        if (s) this.swaps = JSON.parse(s);
        if (!this.swaps.meals) this.swaps.meals = {};
        if (!this.swaps.exercises) this.swaps.exercises = {};
        const c = localStorage.getItem('gordol_chat_v3');
        if (c) this.chat = JSON.parse(c);
        const f = localStorage.getItem('gordol_fasting_v3');
        if (f) this.fasting = JSON.parse(f);
      } catch (e) {
        console.error('load state', e);
      }
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
          <div style="font-size:3rem;">👁️</div>
          <h3 style="font-size:1.25rem; font-weight:900; color:#fff; margin-top:6px;">به گردول خوش اومدی!</h3>
        </div>

        <div style="background:rgba(156,107,255,0.12); border:1px solid var(--accent-purple); border-radius:16px; padding:14px; margin-bottom:16px;">
          <p style="font-size:0.85rem; color:#fff; line-height:1.7;">
            گردول برای فعال شدن <b>چشم گردول</b>، <b>مربی هوشمند</b>، <b>دوربین تغذیه</b> و محاسبات بالینی به هوش مصنوعی نیاز دارد.
            کافی است یک کلید <b>رایگان</b> از Google AI Studio بسازی و اینجا وارد کنی.
          </p>
        </div>

        <div style="background:var(--bg-elevated); border-radius:14px; padding:12px 14px; margin-bottom:16px; font-size:0.8rem; color:var(--text-muted); line-height:1.8;">
          <b style="color:#fff;">🔑 گرفتن کلید رایگان در ۳۰ ثانیه:</b><br/>
          ۱. وارد <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" style="color:var(--accent-purple); text-decoration:underline;">Google AI Studio</a> شو (با اکانت گوگل).<br/>
          ۲. روی «Create API Key» بزن و کلید را کپی کن.<br/>
          ۳. کلید را همین‌جا پیست کن — تمام!
        </div>

        <div class="form-group">
          <label class="form-label">کلید API خودت (AIza...):</label>
          <input type="password" id="mand-api-key" class="form-input" dir="ltr" placeholder="AIzaSy..." autocomplete="off"/>
        </div>

        <div id="mand-api-status" style="font-size:0.82rem; margin-bottom:12px; display:none; line-height:1.6;"></div>

        <button id="btn-mand-verify" class="btn-primary">تست و فعال‌سازی هوش مصنوعی 🚀</button>

        <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:14px; padding:10px 12px; margin-top:14px; font-size:0.72rem; color:var(--text-muted); line-height:1.7;">
          🔒 <b>امنیت و حریم خصوصی:</b> کلید تو فقط روی مرورگر خودت ذخیره می‌شود و فقط به سرور رسمی گوگل ارسال می‌شود.
          هیچ سرور واسطی وجود ندارد؛ هیچ‌کس — حتی ما — به اطلاعات، عکس‌ها یا تمرین‌های تو دسترسی ندارد.
        </div>
      `;

      document.getElementById('btn-mand-verify').addEventListener('click', () => this.verifyAndSaveMandatoryApiKey());
      modal.classList.add('active');
    },

    async verifyAndSaveMandatoryApiKey() {
      const key = document.getElementById('mand-api-key').value.trim();
      const status = document.getElementById('mand-api-status');
      const btn = document.getElementById('btn-mand-verify');

      if (!key) { toast('لطفاً کلید API را وارد کنید.', false); return; }
      if (!/^AIza[0-9A-Za-z\-_]{30,}$/.test(key)) {
        status.style.display = 'block';
        status.style.color = '#ef4444';
        status.textContent = 'فرمت کلید درست به نظر نمی‌رسد. کلید گوگل با «AIza» شروع می‌شود.';
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
            <button onclick="document.getElementById('pwa-install-banner').style.display='none'">باشه</button>`;
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
          <h3 class="modal-title">🔔 یادآورهای هوشمند گردول</h3>
        </div>
        <div style="text-align:center; margin-bottom:16px;">
          <span style="font-size:3rem;">⏰</span>
          <h4 style="font-size:1.05rem; font-weight:900; margin-top:10px; color:#fff;">هیچ تمرین یا آبی رو فراموش نکن!</h4>
          <p style="font-size:0.84rem; color:var(--text-muted); margin-top:6px; line-height:1.7;">
            گردول هر روز ساعت ${esc(faNum(rt))} یادآور تمرین می‌فرستد، در طول روز برای نوشیدن آب یادت می‌گذارد
            و شب‌ها اگر وعده‌هات را ثبت نکرده باشی یادآوری می‌کند.
          </p>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn-secondary" style="width:auto; padding:0 16px;" id="notif-later-btn">بعداً</button>
          <button class="btn-emerald" style="flex:1;" id="notif-enable-btn">فعال‌سازی نوتیفیکیشن‌ها 🔔</button>
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
        toast('نوتیفیکیشن تستی ارسال شد!');
      }
    },

    // ================= بخش ۴: هدر، نوبار و روتر تب‌ها =================

    renderHeader() {
      const header = document.querySelector('header.app-header');
      if (!header) return;
      const dayNum = (this.profile && this.profile.currentDay) || 1;
      header.innerHTML = `
        <div class="brand-badge">
          <span class="logo-icon">🥜</span>
          <span>گردول</span>
        </div>
        <div class="header-actions">
          <div class="streak-pill" title="روز فعلی برنامه">
            <span>🔥</span><span>روز ${faNum(dayNum)}</span>
          </div>
          <button class="btn-icon" id="btn-open-settings" title="تنظیمات">⚙️</button>
        </div>
      `;
      document.getElementById('btn-open-settings').addEventListener('click', () => this.openSettingsModal());
    },

    renderTabNav() {
      const nav = document.querySelector('nav.bottom-nav');
      if (!nav) return;
      nav.innerHTML = `
        <div class="nav-item ${this.activeTab === 'today' ? 'active' : ''}" data-tab="today">
          <span class="nav-icon">📅</span><span>امروز</span>
        </div>
        <div class="nav-item ${this.activeTab === 'workout' ? 'active' : ''}" data-tab="workout">
          <span class="nav-icon">🔥</span><span>تمرین</span>
        </div>
        <div class="nav-center-action" id="nav-eye-btn">
          <button class="nav-center-btn" title="چشم گِردول — شمارش هوشمند با دوربین">👁️</button>
          <span class="nav-center-label">چشم گردول</span>
        </div>
        <div class="nav-item ${this.activeTab === 'diet' ? 'active' : ''}" data-tab="diet">
          <span class="nav-icon">🥗</span><span>تغذیه</span>
        </div>
        <div class="nav-item ${this.activeTab === 'coach' ? 'active' : ''}" data-tab="coach">
          <span class="nav-icon">🤖</span><span>مربی</span>
        </div>
      `;
      nav.querySelectorAll('.nav-item').forEach(n => {
        n.addEventListener('click', () => this.switchTab(n.dataset.tab));
      });
      document.getElementById('nav-eye-btn').addEventListener('click', () => this.openPoseModal(null));
    },

    switchTab(tab) {
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

    // ================= بخش ۵: آنبوردینگ (سوالات اورجینال گردول) =================

    onboardingData: {
      step: 1,
      primaryGoal: 'lose_weight',
      motivation: 'energy',
      obstacle: 'dont_continue',
      trainingStyle: 'mastery',
      trainingNow: 'sometimes',
      trainingArea: 'full',
      trainingMinutes: 20,
      weeklyCadence: 4,
      gender: 'male',
      age: 26,
      heightCm: 178,
      weightKg: 82,
      goalWeightKg: 75,
      waterCheck: '1_to_2',
      reminderTime: '18:00',
      eatingLocation: 'home',
      diet: 'balanced',
      exclusions: 'none'
    },

    startOnboarding() { this.onboardingData.step = 1; this.renderOnboardingStep(); },

    optionCard(icon, title, selected, action) {
      return `
        <div class="swap-card-item ${selected ? 'selected' : ''}" data-action="${esc(action)}">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.4rem;">${icon}</span>
            <span style="font-size:0.95rem; font-weight:800;">${esc(title)}</span>
          </div>
          <span>⬅️</span>
        </div>
      `;
    },

    renderOnboardingStep() {
      const main = document.querySelector('main.main-content');
      if (!main) return;
      const d = this.onboardingData;

      const bindActions = () => {
        main.querySelectorAll('[data-action]').forEach(el => {
          el.addEventListener('click', () => {
            const [kind, value] = el.dataset.action.split('|');
            if (kind === 'goal') { d.primaryGoal = value; d.step = 2; }
            else if (kind === 'mot') { d.motivation = value; d.step = 3; }
            else if (kind === 'obs') { d.obstacle = value; d.step = 4; }
            else if (kind === 'style') { d.trainingStyle = value; d.step = 5; }
            this.renderOnboardingStep();
          });
        });
      };

      if (d.step === 1) {
        const opts = [
          ['lose_weight', '🔥', 'وزن کم کنم و چربی‌سوزی داشته باشم'],
          ['gain_muscle', '⚡', 'عضله‌سازی و خوش‌فرم شدن بدن'],
          ['get_stronger', '🏋️', 'قوی‌تر و آماده‌تر بشم'],
          ['maintain_weight', '⚖️', 'وزنم رو حفظ کنم و فیت بمونم'],
          ['eat_better', '🥗', 'سالم‌تر غذا بخورم و نظم پیدا کنم']
        ];
        main.innerHTML = `
          <div class="card text-center" style="margin-top:15px;">
            <div style="font-size:2.8rem; margin-bottom:8px;">🎯</div>
            <h2 style="font-size:1.3rem; font-weight:900; margin-bottom:6px;">به گردول خوش اومدی!</h2>
            <p style="color:var(--text-muted); font-size:0.88rem; margin-bottom:20px;">هدف اصلی‌ت از پیوستن به گردول چیه؟</p>
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${opts.map(([id, ic, t]) => this.optionCard(ic, t, d.primaryGoal === id, 'goal|' + id)).join('')}
            </div>
          </div>`;
        bindActions();
      }

      else if (d.step === 2) {
        const opts = [
          ['energy', '🔋', 'انرژی روزانه بیشتر و سرزندگی'],
          ['confidence', '😎', 'اعتمادبه‌نفس بیشتر و حس خوب در لباس‌ها'],
          ['health', '❤️', 'رسیدگی به سلامتی و پیشگیری از بیماری‌ها'],
          ['daily_ease', '🏃', 'راحت‌تر انجام دادن کارهای روزمره و سبک‌بالی'],
          ['food_peace', '🧘', 'حس بهتر و آرامش نسبت به تغذیه و غذا']
        ];
        main.innerHTML = `
          <div class="card text-center" style="margin-top:15px;">
            <div style="font-size:2.5rem; margin-bottom:8px;">✨</div>
            <h2 style="font-size:1.25rem; font-weight:900; margin-bottom:6px;">چی بیشترین انگیزه رو بهت می‌ده؟</h2>
            <p style="color:var(--text-muted); font-size:0.86rem; margin-bottom:20px;">شناخت انگیزه به مربی هوش مصنوعی کمک می‌کنه برنامه دقیق‌تری برات بسازه.</p>
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${opts.map(([id, ic, t]) => this.optionCard(ic, t, d.motivation === id, 'mot|' + id)).join('')}
            </div>
          </div>`;
        bindActions();
      }

      else if (d.step === 3) {
        const opts = [
          ['dont_continue', '🔄', 'شروع می‌کنم ولی ادامه نمی‌دم و سرد می‌شم'],
          ['no_time', '⏳', 'وقت کم میارم و کارها بهم می‌ریزه'],
          ['dont_know', '❓', 'نمی‌دونم از کجا شروع کنم و چی بخورم'],
          ['logging_hard', '📝', 'ثبت کالری و غذاها برام خسته‌کننده بوده'],
          ['none', '💪', 'مانع خاصی ندارم، کاملاً آماده‌ام!']
        ];
        main.innerHTML = `
          <div class="card text-center" style="margin-top:15px;">
            <div style="font-size:2.5rem; margin-bottom:8px;">🚧</div>
            <h2 style="font-size:1.25rem; font-weight:900; margin-bottom:6px;">بزرگ‌ترین مانع تا امروز چی بوده؟</h2>
            <p style="color:var(--text-muted); font-size:0.86rem; margin-bottom:20px;">برنامه‌ت رو جوری می‌چینیم که این مانع نتونه متوقفت کنه.</p>
            <div style="display:flex; flex-direction:column; gap:10px;">
              ${opts.map(([id, ic, t]) => this.optionCard(ic, t, d.obstacle === id, 'obs|' + id)).join('')}
            </div>
          </div>`;
        bindActions();
      }

      else if (d.step === 4) {
        main.innerHTML = `
          <div class="card text-center" style="margin-top:15px;">
            <div style="font-size:2.5rem; margin-bottom:8px;">👁️</div>
            <h2 style="font-size:1.25rem; font-weight:900; margin-bottom:6px;">سبک تمرینی مورد علاقه‌ت چیه؟</h2>
            <p style="color:var(--text-muted); font-size:0.86rem; margin-bottom:20px;">می‌تونی با دوربین هوشمند تمرین کنی یا طبق مسیر روزانه جلو بری.</p>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div class="swap-card-item" data-action="style|mastery">
                <div style="text-align:right;">
                  <div style="font-size:1rem; font-weight:900; color:#10b981;">👁️ مسیر تسلط با چشم گردول</div>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">شمارش خودکار تکرارها با دوربین و تصحیح زوایای بدن، روی همه حرکات.</div>
                </div>
                <span>⬅️</span>
              </div>
              <div class="swap-card-item" data-action="style|daily">
                <div style="text-align:right;">
                  <div style="font-size:1rem; font-weight:900; color:var(--accent-purple);">🏃 مسیر روزانه گردول</div>
                  <div style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">برنامه‌های مدون با ویدیوهای راهنما و تایمر خودکار، بدون نیاز به دوربین.</div>
                </div>
                <span>⬅️</span>
              </div>
            </div>
          </div>`;
        bindActions();
      }

      else if (d.step === 5) {
        main.innerHTML = `
          <div class="card">
            <h3 style="font-size:1.2rem; font-weight:900; margin-bottom:16px;">⚡ سابقه و تمرکز عضلانی</h3>
            <div class="form-group">
              <label class="form-label">الان چقدر فعالیت ورزشی داری؟</label>
              <select id="inp-training-now" class="form-select">
                <option value="none">تقریباً هیچی (کم‌تحرک)</option>
                <option value="sometimes" selected>گاهی و بی‌برنامه</option>
                <option value="regular">هفته‌ای چند بار، منظم و باسابقه</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">بیشتر روی کدوم بخش بدنت می‌خوای تمرکز کنی؟</label>
              <select id="inp-training-area" class="form-select">
                <option value="full" selected>کل بدن (تناسب کلی و متوازن)</option>
                <option value="core">شکم و مرکز بدن (سیکس‌پک و پهلو)</option>
                <option value="lower">باسن و ران‌ها (فرم‌دهی پا)</option>
              </select>
            </div>
            <div style="display:flex; gap:10px; margin-top:24px;">
              <button class="btn-secondary" style="width:auto; padding:0 16px;" id="ob5-back">⬅️ قبلی</button>
              <button class="btn-primary" id="ob5-next">مرحله بعد ➡️</button>
            </div>
          </div>`;
        document.getElementById('inp-training-now').value = d.trainingNow;
        document.getElementById('inp-training-area').value = d.trainingArea;
        document.getElementById('ob5-back').addEventListener('click', () => { d.step = 4; this.renderOnboardingStep(); });
        document.getElementById('ob5-next').addEventListener('click', () => {
          d.trainingNow = document.getElementById('inp-training-now').value;
          d.trainingArea = document.getElementById('inp-training-area').value;
          d.step = 6; this.renderOnboardingStep();
        });
      }

      else if (d.step === 6) {
        main.innerHTML = `
          <div class="card">
            <h3 style="font-size:1.2rem; font-weight:900; margin-bottom:16px;">⏱️ زمان‌بندی و روزهای تمرین</h3>
            <div class="form-group">
              <label class="form-label">هر جلسه تمرین چقدر می‌تونی وقت بذاری؟</label>
              <select id="inp-minutes" class="form-select">
                <option value="10">۱۰ دقیقه (خیلی سریع و موثر)</option>
                <option value="15">۱۵ دقیقه (استاندارد روزانه)</option>
                <option value="20" selected>۲۰ دقیقه (پیشرفته چربی‌سوزی)</option>
                <option value="30">۳۰ دقیقه یا بیشتر (حرفه‌ای)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">چند روز در هفته می‌خوای تمرین کنی؟</label>
              <select id="inp-cadence" class="form-select">
                <option value="3">۳ روز در هفته (متعادل)</option>
                <option value="4" selected>۴ روز در هفته (پیشنهاد طلایی)</option>
                <option value="5">۵ روز در هفته (سریع‌ترین نتیجه)</option>
                <option value="7">هر روز (چالش بی‌وقفه)</option>
              </select>
            </div>
            <div style="display:flex; gap:10px; margin-top:24px;">
              <button class="btn-secondary" style="width:auto; padding:0 16px;" id="ob6-back">⬅️ قبلی</button>
              <button class="btn-primary" id="ob6-next">مرحله بعد ➡️</button>
            </div>
          </div>`;
        document.getElementById('inp-minutes').value = String(d.trainingMinutes);
        document.getElementById('inp-cadence').value = String(d.weeklyCadence);
        document.getElementById('ob6-back').addEventListener('click', () => { d.step = 5; this.renderOnboardingStep(); });
        document.getElementById('ob6-next').addEventListener('click', () => {
          d.trainingMinutes = parseInt(document.getElementById('inp-minutes').value, 10) || 20;
          d.weeklyCadence = parseInt(document.getElementById('inp-cadence').value, 10) || 4;
          d.step = 7; this.renderOnboardingStep();
        });
      }

      else if (d.step === 7) {
        main.innerHTML = `
          <div class="card">
            <h3 style="font-size:1.2rem; font-weight:900; margin-bottom:16px;">📏 مشخصات فیزیکی شما</h3>
            <div class="form-group">
              <label class="form-label">جنسیت:</label>
              <div style="display:flex; gap:10px;">
                <button type="button" class="btn-secondary onb-gender" data-g="male" style="flex:1; font-weight:800;">🧔 مرد</button>
                <button type="button" class="btn-secondary onb-gender" data-g="female" style="flex:1; font-weight:800;">👩 زن</button>
              </div>
            </div>
            <div class="form-group"><label class="form-label">سن شما (سال):</label><input type="number" id="inp-age" class="form-input" min="13" max="85"/></div>
            <div class="form-group"><label class="form-label">قد شما (سانتی‌متر):</label><input type="number" id="inp-height" class="form-input" min="120" max="230"/></div>
            <div class="form-group"><label class="form-label">وزن فعلی (کیلوگرم):</label><input type="number" id="inp-weight" class="form-input" min="35" max="250"/></div>
            <div class="form-group"><label class="form-label">وزن هدف شما (کیلوگرم):</label><input type="number" id="inp-goal-weight" class="form-input" min="35" max="250"/></div>
            <div style="display:flex; gap:10px; margin-top:24px;">
              <button class="btn-secondary" style="width:auto; padding:0 16px;" id="ob7-back">⬅️ قبلی</button>
              <button class="btn-primary" id="ob7-next">مرحله بعد ➡️</button>
            </div>
          </div>`;
        const markGender = () => main.querySelectorAll('.onb-gender').forEach(b => {
          b.style.borderColor = b.dataset.g === d.gender ? 'var(--accent-purple)' : 'var(--border-color)';
        });
        markGender();
        main.querySelectorAll('.onb-gender').forEach(b => b.addEventListener('click', () => { d.gender = b.dataset.g; markGender(); }));
        document.getElementById('inp-age').value = d.age;
        document.getElementById('inp-height').value = d.heightCm;
        document.getElementById('inp-weight').value = d.weightKg;
        document.getElementById('inp-goal-weight').value = d.goalWeightKg;
        document.getElementById('ob7-back').addEventListener('click', () => { d.step = 6; this.renderOnboardingStep(); });
        document.getElementById('ob7-next').addEventListener('click', () => {
          d.age = parseInt(document.getElementById('inp-age').value, 10) || 26;
          d.heightCm = parseFloat(document.getElementById('inp-height').value) || 178;
          d.weightKg = parseFloat(document.getElementById('inp-weight').value) || 80;
          d.goalWeightKg = parseFloat(document.getElementById('inp-goal-weight').value) || 75;
          d.step = 8; this.renderOnboardingStep();
        });
      }

      else if (d.step === 8) {
        main.innerHTML = `
          <div class="card">
            <h3 style="font-size:1.2rem; font-weight:900; margin-bottom:16px;">💧 آب و زمان یادآور روزانه</h3>
            <div class="form-group">
              <label class="form-label">معمولاً در طول روز چقدر آب می‌نوشی؟</label>
              <select id="inp-water-check" class="form-select">
                <option value="<1">کمتر از ۱ لیتر (کم‌آبی)</option>
                <option value="1_to_2">۱ تا ۲ لیتر (متوسط)</option>
                <option value="2_to_3">۲ تا ۳ لیتر (خوب و مناسب)</option>
                <option value=">3">بیشتر از ۳ لیتر (عالی و هیدراته)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">بهترین زمان یادآور تمرین برای شما:</label>
              <input type="time" id="inp-reminder-time" class="form-input"/>
            </div>
            <div style="display:flex; gap:10px; margin-top:24px;">
              <button class="btn-secondary" style="width:auto; padding:0 16px;" id="ob8-back">⬅️ قبلی</button>
              <button class="btn-primary" id="ob8-next">مرحله بعد ➡️</button>
            </div>
          </div>`;
        document.getElementById('inp-water-check').value = d.waterCheck;
        document.getElementById('inp-reminder-time').value = d.reminderTime;
        document.getElementById('ob8-back').addEventListener('click', () => { d.step = 7; this.renderOnboardingStep(); });
        document.getElementById('ob8-next').addEventListener('click', () => {
          d.waterCheck = document.getElementById('inp-water-check').value;
          d.reminderTime = document.getElementById('inp-reminder-time').value || '18:00';
          d.step = 9; this.renderOnboardingStep();
        });
      }

      else if (d.step === 9) {
        main.innerHTML = `
          <div class="card">
            <h3 style="font-size:1.2rem; font-weight:900; margin-bottom:16px;">🥗 عادات و الگوی غذایی</h3>
            <div class="form-group">
              <label class="form-label">بیشتر وعده‌هات رو چطور تامین می‌کنی؟</label>
              <select id="inp-eating-loc" class="form-select">
                <option value="home">در خانه آشپزی می‌کنم</option>
                <option value="delivery">غذا سفارش می‌دم</option>
                <option value="outside">بیرون یا در محل کار غذا می‌خورم</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">الگوی رژیم غذایی دلخواه شما:</label>
              <select id="inp-diet-type" class="form-select">
                <option value="balanced">متعادل (سفره مرسوم ایرانی)</option>
                <option value="high_protein">پروتئین بالا (ورزشی و فرم‌دهی)</option>
                <option value="vegetarian">گیاه‌خواری (بدون گوشت)</option>
                <option value="keto">کتوژنیک (کربوهیدرات خیلی پایین)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">محدودیت یا پرهیز سلامتی:</label>
              <select id="inp-exclusions" class="form-select">
                <option value="none">بدون پرهیز خاص</option>
                <option value="no-dairy">عدم تحمل لاکتوز (بدون شیر/لبنیات)</option>
                <option value="gluten-free">بدون گلوتن (حساس به گندم)</option>
                <option value="diabetes">دیابت یا قند خون بالا</option>
              </select>
            </div>
            <div style="display:flex; gap:10px; margin-top:24px;">
              <button class="btn-secondary" style="width:auto; padding:0 16px;" id="ob9-back">⬅️ قبلی</button>
              <button class="btn-emerald" style="flex:1;" id="ob9-finish">محاسبه و دریافت برنامه من 🚀</button>
            </div>
          </div>`;
        document.getElementById('inp-eating-loc').value = d.eatingLocation;
        document.getElementById('inp-diet-type').value = d.diet;
        document.getElementById('inp-exclusions').value = d.exclusions;
        document.getElementById('ob9-back').addEventListener('click', () => { d.step = 8; this.renderOnboardingStep(); });
        document.getElementById('ob9-finish').addEventListener('click', () => this.finishOnboarding());
      }
    },

    finishOnboarding() {
      const d = this.onboardingData;
      d.eatingLocation = document.getElementById('inp-eating-loc').value;
      d.diet = document.getElementById('inp-diet-type').value;
      d.exclusions = document.getElementById('inp-exclusions').value;

      // فرمول بالینی Mifflin-St Jeor
      let bmr = (10 * d.weightKg) + (6.25 * d.heightCm) - (5 * d.age);
      bmr += d.gender === 'male' ? 5 : -161;

      let actFactor = 1.2;
      if (d.weeklyCadence >= 3 && d.weeklyCadence <= 4) actFactor = 1.4;
      else if (d.weeklyCadence >= 5) actFactor = 1.6;

      const tdee = Math.round(bmr * actFactor);
      let targetKcal = tdee;
      const deltaKg = Math.abs(d.weightKg - d.goalWeightKg);
      let weeklyRateKg = 0.7;

      if (d.primaryGoal === 'lose_weight' || d.goalWeightKg < d.weightKg) {
        targetKcal = Math.max(1350, tdee - 500);
        weeklyRateKg = d.weeklyCadence >= 4 ? 0.75 : 0.6;
      } else if (d.primaryGoal === 'gain_muscle' || d.goalWeightKg > d.weightKg) {
        targetKcal = tdee + 350;
        weeklyRateKg = 0.35;
      }

      const targetWeeks = Math.max(4, Math.ceil(deltaKg / weeklyRateKg));
      const estimatedTotalDays = targetWeeks * 7;

      const proteinG = Math.round(d.weightKg * 2.0);
      const fatG = Math.round((targetKcal * 0.25) / 9);
      const carbsG = Math.max(30, Math.round((targetKcal - (proteinG * 4) - (fatG * 9)) / 4));

      let waterMl = Math.round(d.weightKg * 35);
      if (d.trainingMinutes >= 20) waterMl += 500;
      if (d.waterCheck === '<1') waterMl = Math.max(waterMl, 2500);

      // مسیر تمرینی هوشمند
      let selectedPath;
      if (d.trainingNow === 'none' && d.trainingArea === 'full') selectedPath = 'starter-path';
      else if (d.trainingArea === 'core') selectedPath = 'core-path';
      else if (d.trainingArea === 'lower') selectedPath = 'glute-path';
      else if (d.primaryGoal === 'gain_muscle') selectedPath = 'fullbody-path';
      else selectedPath = 'fatburn-path';

      this.profile = {
        primaryGoal: d.primaryGoal, motivation: d.motivation, obstacle: d.obstacle,
        trainingStyle: d.trainingStyle, trainingNow: d.trainingNow, trainingArea: d.trainingArea,
        trainingMinutes: d.trainingMinutes, weeklyCadence: d.weeklyCadence,
        gender: d.gender, age: d.age, heightCm: d.heightCm, weightKg: d.weightKg, goalWeightKg: d.goalWeightKg,
        waterCheck: d.waterCheck, reminderTime: d.reminderTime,
        eatingLocation: d.eatingLocation, diet: d.diet, exclusions: d.exclusions,
        bmr: Math.round(bmr), tdee, targetKcal, proteinG, carbsG, fatG, waterMl,
        selectedPath, currentDay: 1,
        startDate: todayKey(),
        deltaKg, weeklyRateKg, targetWeeks, estimatedTotalDays,
        weightHistory: [{ date: todayKey(), kg: d.weightKg }]
      };

      this.saveProfile();
      this.renderHeader();
      this.initNotificationSystem();
      this.switchTab('today');
      toast('پروفایل تو ساخته شد؛ برنامه شخصی‌ات آماده است! 🎉');
    },

    // محاسبه مجدد پیش‌بینی هدف (پس از تغییر وزن یا بازتنظیم AI)
    recomputeProjection() {
      const p = this.profile;
      if (!p) return;
      p.deltaKg = Math.abs(p.weightKg - p.goalWeightKg);
      let rate;
      if (p.primaryGoal === 'lose_weight' || p.goalWeightKg < p.weightKg) rate = p.weeklyCadence >= 4 ? 0.75 : 0.6;
      else if (p.primaryGoal === 'gain_muscle' || p.goalWeightKg > p.weightKg) rate = 0.35;
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
            <span>🎯 روز رسیدن به هدف</span>
            <span style="font-size:0.72rem; background:rgba(16,185,129,0.2); color:#10b981; padding:2px 8px; border-radius:6px;">محاسبه علمی</span>
          </div>
          <div class="proj-goal-date">📅 حدود <b>${esc(goalDateText)}</b> به وزن هدف (${faNum(p.goalWeightKg)} کیلو) می‌رسی</div>
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
            ⚠️ پیشرفت روز فقط با تکمیل تمرین ثبت می‌شود — وزن‌کشی منظم دقت پیش‌بینی را بالاتر می‌برد.
          </p>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
          <div class="card eye-shortcut" style="padding:14px; margin-bottom:0; cursor:pointer;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:1.6rem;">👁️</span>
              <span style="font-size:0.7rem; background:rgba(16,185,129,0.2); color:#10b981; padding:2px 8px; border-radius:8px; font-weight:800;">زنده AI</span>
            </div>
            <div style="margin-top:10px;">
              <h4 style="font-size:0.95rem; font-weight:900; color:#fff;">چشم گِردول</h4>
              <p style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">شمارش تکرار و کنترل فرم با دوربین، برای همه حرکات</p>
            </div>
          </div>
          <div class="card food-shortcut" style="padding:14px; margin-bottom:0; cursor:pointer;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:1.6rem;">📸</span>
              <span style="font-size:0.7rem; background:rgba(245,158,11,0.2); color:#f59e0b; padding:2px 8px; border-radius:8px; font-weight:800;">Vision AI</span>
            </div>
            <div style="margin-top:10px;">
              <h4 style="font-size:0.95rem; font-weight:900; color:#fff;">دوربین تغذیه</h4>
              <p style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">عکس یا متن غذا → کالری و ماکرو دقیق</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>🔥 کالری و ماکروهای امروز</span>
            <span style="font-size:0.85rem; color:var(--accent-purple); font-weight:800;">${faNum(loggedCal)} / ${faNum(p.targetKcal)} kcal</span>
          </div>
          <div style="height:10px; background:var(--bg-elevated); border-radius:5px; overflow:hidden; margin:12px 0;">
            <div style="height:100%; width:${calPercent}%; background:linear-gradient(90deg, var(--accent-purple), var(--accent-coral)); border-radius:5px; transition:width 0.3s;"></div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:10px;">
            <span class="macro-tag prot">🥩 پروتئین: ${faNum(loggedP)}/${faNum(p.proteinG)}g</span>
            <span class="macro-tag carb">🌾 کربوهیدرات: ${faNum(p.carbsG)}g</span>
            <span class="macro-tag fat">🥑 چربی: ${faNum(p.fatG)}g</span>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn-secondary" style="flex:1; font-size:0.8rem;" id="btn-food-photo">📸 عکس غذا</button>
            <button class="btn-secondary" style="flex:1; font-size:0.8rem;" id="btn-food-text">✍️ متن غذا</button>
            <button class="btn-secondary" style="width:auto; padding:6px 12px; font-size:0.8rem;" id="btn-ai-retune">🤖 بازتنظیم</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>💧 مصرف آب روزانه</span>
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
            <span>🏋️ تمرین اختصاصی روز ${faNum(p.currentDay)}</span>
            <span style="font-size:0.75rem; color:var(--text-muted);">${t.dayCompleted ? '✅ ثبت شده' : 'در انتظار انجام'}</span>
          </div>
          <p style="color:var(--text-muted); font-size:0.84rem; margin-bottom:12px;">
            مدت: ${faNum(p.trainingMinutes)} دقیقه | تمرکز: ${p.trainingArea === 'core' ? 'شکم و پهلو' : (p.trainingArea === 'lower' ? 'باسن و پا' : 'کل بدن')} | سبک: ${p.trainingStyle === 'mastery' ? 'چشم گردول 👁️' : 'مسیر روزانه 🏃'}
          </p>
          <button class="btn-primary" id="btn-go-workout">ورود به تمرینات روز ${faNum(p.currentDay)} 🔥</button>
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
        const res = await GordolAI.generateJSON(prompt, ['targetKcal', 'proteinG', 'carbsG', 'fatG', 'waterMl', 'note']);
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
          <h3 style="font-size:1.1rem; font-weight:900; color:#fff;">${esc(plan.titleFa)} — روز ${faNum(p.currentDay)}</h3>
          <p style="font-size:0.82rem; color:var(--text-muted); margin-top:4px;">${esc(template.name)} · ${esc(plan.subtitle)}</p>
          <div style="display:flex; gap:8px; margin-top:12px; font-size:0.78rem; font-weight:700;">
            <span class="macro-tag">⏱️ ${faNum(p.trainingMinutes)} دقیقه</span>
            <span class="macro-tag">🔄 ${faNum(chapter.rounds)} راند</span>
            <span class="macro-tag">💪 ${faNum(template.training.length)} حرکت اصلی</span>
          </div>
        </div>

        <button class="btn-emerald" style="width:100%; padding:14px; font-size:1rem;" id="btn-start-session">
          ▶️ شروع جلسه تمرین با تایمر
        </button>
        <p style="text-align:center; font-size:0.72rem; color:var(--text-muted); margin:8px 0 16px;">
          ویدیو + تایمر + بوق + استراحت خودکار — مثل مربی واقعی کنارت هستیم
        </p>

        <h4 style="font-size:0.92rem; font-weight:900; margin:8px 0 10px; color:var(--accent-purple);">۱. گرم کردن (${faNum(template.warmup.length)} حرکت)</h4>
        <div style="display:flex; flex-direction:column; gap:10px;" id="list-warmup"></div>
        <h4 style="font-size:0.92rem; font-weight:900; margin:20px 0 10px; color:var(--accent-coral);">۲. تمرین اصلی (${faNum(template.training.length)} حرکت)</h4>
        <div style="display:flex; flex-direction:column; gap:10px;" id="list-training"></div>
        <h4 style="font-size:0.92rem; font-weight:900; margin:20px 0 10px; color:var(--accent-emerald);">۳. سرد کردن و کشش (${faNum(template.cooldown.length)} حرکت)</h4>
        <div style="display:flex; flex-direction:column; gap:10px;" id="list-cooldown"></div>

        <div style="margin-top:24px; padding-bottom:20px;">
          <button class="btn-secondary" style="width:100%; padding:12px;" id="btn-manual-complete">
            ✅ امروز را بیرون از اپ تمرین کردم — ثبت دستی
          </button>
        </div>
      `;

      const renderList = (listEl, ids) => {
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
                  <h5 style="font-size:0.9rem; font-weight:900; color:#fff;">${esc(e.nameFa)}</h5>
                  ${this.swaps.exercises[rawId] ? '<span style="font-size:0.62rem; background:var(--accent-purple); color:#fff; padding:1px 6px; border-radius:6px;">جایگزین</span>' : ''}
                  ${done ? '<span style="font-size:0.62rem; background:rgba(16,185,129,0.25); color:#10b981; padding:1px 6px; border-radius:6px;">✔ انجام شد</span>' : ''}
                </div>
                <div style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">
                  ${esc(e.targetFa || 'عضلات هدف')} | ${e.measure === 'SECONDS' ? faNum(e.suggestedSeconds || 30) + ' ثانیه' : faNum(e.suggestedReps || 12) + ' تکرار'}
                </div>
              </div>
              <div style="display:flex; gap:5px; flex-shrink:0;">
                <button class="btn-secondary mini" data-act="video" title="ویدیو و نکات">▶️</button>
                <button class="btn-emerald mini" data-act="eye" title="چشم گردول">👁️</button>
                <button class="btn-secondary mini" data-act="swap" title="جایگزینی">🔄</button>
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
      this.sendLocalNotification('🏆 یک روز دیگر به هدف نزدیک‌تر شدی!', `روز ${faNum(p.currentDay - 1)} کامل شد. استریک تو ادامه دارد 🔥`);
      toast(`آفرین قهرمان! روز ${faNum(p.currentDay - 1)} ثبت شد 💪`);
      this.switchTab('workout');
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
        startedAt: Date.now(), workedTotal: 0
      };

      const modal = document.getElementById('session-player-modal');
      modal.querySelector('.modal-card').style.maxWidth = '480px';
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title" id="sp-title">آماده‌سازی جلسه...</h3>
          <button class="btn-close" id="sp-close">×</button>
        </div>
        <div class="sp-video-box">
          <video id="sp-video" autoplay loop muted playsinline></video>
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
          <button class="btn-secondary" style="flex:1;" id="sp-pause">⏸ مکث</button>
          <button class="btn-secondary" style="flex:1;" id="sp-skip">رد کردن ⏭</button>
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
        document.getElementById('sp-pause').textContent = sp.paused ? '▶ ادامه' : '⏸ مکث';
      });
      document.getElementById('sp-skip').addEventListener('click', () => this.advanceSessionItem());

      this.advanceSessionItem();
    },

    advanceSessionItem() {
      const sp = this.sessionPlayer;
      if (!sp) return;
      sp.idx++;
      if (sp.idx >= sp.items.length) { this.endSessionPlayer(true); return; }
      const item = sp.items[sp.idx];
      sp.remaining = item.sec;
      if (item.kind === 'work') sp.workedTotal += item.sec;

      const ex = item.exId ? (window.GORDOL_EXERCISES || []).find(e => e.id === (this.swaps.exercises[item.exId] || item.exId)) : null;

      document.getElementById('sp-title').textContent = ex ? ex.nameFa : (item.phase || 'استراحت');
      document.getElementById('sp-phase').textContent = item.kind === 'rest' ? 'استراحت' : item.phase;
      document.getElementById('sp-phase').className = 'sp-phase-badge' + (item.kind === 'rest' ? ' rest' : '');

      const nextItem = sp.items[sp.idx + 1];
      const nextEx = nextItem && nextItem.exId ? (window.GORDOL_EXERCISES || []).find(e => e.id === (this.swaps.exercises[nextItem.exId] || nextItem.exId)) : null;
      document.getElementById('sp-next').innerHTML = nextItem
        ? `بعدی: ${nextItem.kind === 'rest' ? 'استراحت ' + faNum(nextItem.sec) + ' ثانیه‌ای' : esc(nextEx ? nextEx.nameFa : '')} <span style="opacity:0.7;">(راند ${faNum(nextItem.round)})</span>`
        : '🎉 آخرین حرکت — تمومش کن!';

      const video = document.getElementById('sp-video');
      if (video) {
        if (ex && ex.videoUrl) {
          video.style.display = '';
          const expected = ex.videoUrl;
          if (!video.getAttribute('src') || !video.getAttribute('src').endsWith(expected)) {
            video.setAttribute('src', expected);
            video.load();
          }
          video.play().catch(() => {});
        } else {
          video.style.display = 'none';
        }
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
        doneItems.forEach(id => { seen[id] = true; });
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
          <span class="macro-tag">📊 ${ex.difficulty === 'BEGINNER' ? 'مبتدی' : (ex.difficulty === 'NOVICE' ? 'متوسط' : 'پیشرفته')}</span>
          <span class="macro-tag">${ex.measure === 'SECONDS' ? '⏱️ ' + faNum(ex.suggestedSeconds || 30) + ' ثانیه' : '🔁 ' + faNum(ex.suggestedReps || 12) + ' تکرار'}</span>
        </div>
        ${ex.summaryFa ? `<div style="background:rgba(156,107,255,0.1); border-radius:14px; padding:10px 12px; margin-bottom:12px; font-size:0.8rem; color:#fff; line-height:1.6;">${esc(ex.summaryFa)}</div>` : ''}
        <div class="ex-details-section">
          ${(ex.stepsFa || []).length ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title steps"><span>📋</span><span>مراحل اجرای صحیح:</span></div>
              <ol class="ex-list">${ex.stepsFa.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
            </div>` : ''}
          ${(ex.cuesFa || []).length ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title cues"><span>💡</span><span>نکات کلیدی مربی گردول:</span></div>
              <ul class="ex-list">${ex.cuesFa.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
            </div>` : ''}
          ${(ex.mistakesFa || []).length ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title mistakes"><span>⚠️</span><span>اشتباهات رایج:</span></div>
              <ul class="ex-list">${ex.mistakesFa.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
            </div>` : ''}
          ${ex.cautionFa ? `
            <div class="ex-detail-block">
              <div class="ex-detail-title caution"><span>🛑</span><span>هشدار پزشکی:</span></div>
              <p style="font-size:0.78rem; color:#fca5a5; line-height:1.6;">${esc(ex.cautionFa)}</p>
            </div>` : ''}
        </div>
        <div style="display:flex; gap:8px; margin-top:14px;">
          <button class="btn-emerald" style="flex:1;" id="exv-eye">👁️ تمرین با چشم گردول</button>
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
        <button class="btn-primary" style="margin-bottom:14px; padding:10px;" id="swap-ai-btn">🤖 پیشنهاد هوشمند جایگزین با AI</button>
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
        btn.textContent = '⏳ در حال دریافت پیشنهاد مربی...';
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
              <div style="font-size:0.85rem; font-weight:900; color:#10b981;">👁️ پیشنهاد مربی: ${esc(pick.nameFa)}</div>
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
        btn.textContent = '🤖 پیشنهاد هوشمند جایگزین با AI';
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
          <h3 class="modal-title">👁️ چشم گِردول</h3>
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
              <div style="font-size:2.4rem; animation:pulse-ai 1.2s infinite;">👁️</div>
              <div style="font-size:0.85rem; font-weight:800; color:#fff; margin-top:8px;">در حال بارگذاری موتور بینایی ماشین...</div>
              <div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">فقط بار اول — پردازش کاملاً روی دستگاه خودت انجام می‌شود</div>
            </div>
          </div>
        </div>

        <div id="pose-goal-hint" style="font-size:0.76rem; color:var(--text-muted); text-align:center; margin:6px 0;"></div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
          <button class="btn-secondary" style="width:auto; padding:8px 14px; font-size:0.8rem;" id="pose-flip">🔄 چرخش دوربین</button>
          <button class="btn-emerald" style="width:auto; padding:9px 20px; font-size:0.85rem;" id="pose-finish">ثبت و اتمام 💪</button>
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
      document.getElementById('pose-goal-hint').textContent =
        (ex.nameFa || this.poseExId) + ' — ' + (detector.mech === 'hold'
          ? 'حالت نشست: ثانیه‌شمار فعال است، فرم بدن را حفظ کن'
          : 'هدف: ' + faNum(ex.suggestedReps || 12) + ' تکرار');
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
      const t = this.getDayLog(todayKey());
      const meals = (window.GORDOL_MEALS && window.GORDOL_MEALS.dailyMeals) || [];
      const grocery = window.GORDOL_GROCERY || [];

      container.innerHTML = `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:14px; background:linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15)); border-color:rgba(245,158,11,0.4);">
          <div>
            <h4 style="font-size:0.95rem; font-weight:900; color:#fff;">📸 اسکن بشقاب غذا با AI</h4>
            <p style="font-size:0.74rem; color:var(--text-muted); margin-top:2px;">عکس بگیر یا غذا رو تایپ کن — کالری و ماکرو خودکار حساب می‌شه</p>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button class="btn-amber" style="width:auto; padding:6px 12px; font-size:0.78rem;" id="diet-scan-photo">عکس 📷</button>
            <button class="btn-secondary" style="width:auto; padding:5px 12px; font-size:0.74rem;" id="diet-scan-text">متن ✍️</button>
          </div>
        </div>

        <div class="card">
          <div class="card-title"><span>🔥 ثبت‌شده‌های امروز</span>
            <span style="font-size:0.85rem; color:var(--accent-purple); font-weight:800;">
              ${faNum(t.meals.reduce((s, m) => s + (m.cal || 0), 0))} / ${faNum(p.targetKcal)} kcal
            </span>
          </div>
          <div id="today-meals-list" style="display:flex; flex-direction:column; gap:8px;">
            ${t.meals.length === 0 ? '<p style="font-size:0.8rem; color:var(--text-muted);">هنوز چیزی ثبت نشده — اولین وعده‌ت رو اسکن یا ثبت کن 🍽️</p>' : ''}
          </div>
        </div>

        ${meals.map(m => this.renderMealCard(m, t)).join('')}

        ${this.renderFastingCard()}

        <div class="card">
          <div class="card-title"><span>🛒 لیست خرید هفتگی گردول</span></div>
          ${grocery.map(g => `
            <div style="margin-bottom:12px;">
              <div style="font-size:0.85rem; font-weight:900; color:var(--accent-purple); margin-bottom:6px;">${esc(g.cat)}</div>
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
        name: meal.name, desc: meal.current, cal: meal.cal, p: meal.p, c: meal.c || 0, f: meal.f || 0
      };
      const emoji = MEAL_EMOJI[meal.id] || '🍽️';
      const loggedCount = todayLog.meals.filter(m => m.mealType === meal.id).length;
      return `
        <div class="meal-card-rich">
          <div class="meal-card-banner" style="background:${MEAL_GRADIENT[meal.id] || 'var(--bg-elevated)'}; display:flex; align-items:center; justify-content:center;">
            <span style="font-size:3.4rem;">${emoji}</span>
            <div class="meal-badge-time">⏰ ${esc(meal.time)}</div>
            ${loggedCount ? `<div class="meal-badge-time" style="top:10px; left:10px; right:auto; background:rgba(16,185,129,0.85); color:#0c0d14;">✓ ${faNum(loggedCount)} ثبت</div>` : ''}
          </div>
          <div class="meal-card-body">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h4 style="font-size:0.98rem; font-weight:900; color:#fff;">${esc(active.name)}</h4>
              <span style="font-size:0.8rem; font-weight:800; color:var(--accent-gold);">🔥 ${faNum(active.cal)} kcal</span>
            </div>
            <p style="font-size:0.78rem; color:var(--text-muted); margin-top:6px; line-height:1.6;">${esc(active.desc)}</p>
            <div class="macro-row">
              <span class="macro-tag prot">🥩 ${faNum(active.p)}g پروتئین</span>
              <span class="macro-tag carb">🌾 ${faNum(active.c)}g کربوهیدرات</span>
              <span class="macro-tag fat">🥑 ${faNum(active.f)}g چربی</span>
            </div>
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="btn-secondary" style="flex:1; padding:7px; font-size:0.76rem;" data-meal-swap="${esc(meal.id)}">🔄 جایگزینی</button>
              <button class="btn-amber" style="width:auto; padding:7px 12px; font-size:0.76rem;" data-meal-scan="${esc(meal.id)}">📸 ثبت عکس این وعده</button>
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
          <button class="btn-primary" style="padding:9px; font-size:0.8rem;" id="swapmeal-ai-btn">🤖 پیشنهاد AI</button>
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
                <span style="font-size:1.6rem;">${MEAL_EMOJI[mealId] || '🍽️'}</span>
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
          const prompt = `برای وعده «${meal.name}» کاربر (کالری هدف روزانه ${p.targetKcal}، رژیم ${p.diet}، پرهیز: ${p.exclusions}) یک جایگزین ایرانی سالم پیشنهاد بده با کالری حدود ${meal.cal} و پروتئین حدود ${meal.p} گرم.
فقط JSON با کلیدها برگردان: name (نام فارسی کوتاه), desc (مواد دقیق با مقادیر), cal (عدد), p (عدد), c (عدد), f (عدد).`;
          const res = await GordolAI.generateJSON(prompt, ['name', 'desc', 'cal', 'p', 'c', 'f']);
          const box = document.getElementById('swapmeal-ai-result');
          box.style.display = 'block';
          box.innerHTML = `
            <div class="swap-card-item selected" style="border-color:#10b981;">
              <div>
                <div style="font-size:0.88rem; font-weight:800; color:#10b981;">👁️ پیشنهاد AI: ${esc(res.name)}</div>
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
        btn.textContent = '🤖 پیشنهاد AI';
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
          <h3 class="modal-title">📸 دوربین تغذیه هوشمند</h3>
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
              <div style="font-size:2.2rem; animation:pulse-ai 1.2s infinite;">📸</div>
              <div style="font-size:0.82rem; font-weight:800; color:#fff; margin-top:8px;">در حال تحلیل بشقاب غذا...</div>
            </div>
          </div>
        </div>
        <input type="file" id="food-file-input" accept="image/*" style="display:none;"/>
        <div style="display:flex; gap:8px; margin:12px 0;">
          <button class="btn-secondary" style="flex:1; font-size:0.78rem;" id="food-capture">📸 گرفتن عکس</button>
          <button class="btn-secondary" style="flex:1; font-size:0.78rem;" id="food-upload">📁 از گالری</button>
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
        <button id="btn-analyze-food" class="btn-amber" style="width:100%;">⚡ تحلیل کالری و ماکرو با AI</button>
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
        const res = await GordolAI.generateJSON(prompt, ['foodName', 'calories', 'protein', 'carbs', 'fat', 'healthScore', 'coachTip']);
        this.scannedFoodResult = res;
        this.renderScannedFoodResult(res);
        btn.textContent = '⚡ تحلیل مجدد';
      } catch (e) {
        toast('خطا در تحلیل: ' + e.message, false);
        btn.textContent = '⚡ تلاش مجدد';
      }
      btn.disabled = false;
      loading.style.display = 'none';
    },

    renderScannedFoodResult(r) {
      const card = document.getElementById('food-scan-result-card');
      card.style.display = 'block';
      card.innerHTML = `
        <h4 style="font-size:0.98rem; font-weight:900; color:#fff; margin-bottom:6px;">🍽️ ${esc(r.foodName)}</h4>
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
          <h3 class="modal-title">✍️ ثبت غذا با متن</h3>
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
        <button class="btn-amber" style="width:100%;" id="food-text-analyze">⚡ تحلیل با هوش مصنوعی</button>
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
          const res = await GordolAI.generateJSON(prompt, ['foodName', 'calories', 'protein', 'carbs', 'fat', 'healthScore', 'coachTip']);
          const box = document.getElementById('food-text-result');
          box.style.display = 'block';
          box.innerHTML = `
            <div class="card" style="margin-bottom:10px;">
              <h4 style="font-size:0.95rem; font-weight:900; color:#fff;">🍽️ ${esc(res.foodName)}</h4>
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
          toast('خطا: ' + e.message, false);
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
        const stage = elapsedH < 4 ? '🔵 فاز گلیکوژن: بدن از قند ذخیره‌شده استفاده می‌کند'
          : elapsedH < 8 ? '🟡 فاز سوخت‌وساز: گلیکوژن رو به پایان است'
          : elapsedH < 12 ? '🟠 فاز چربی‌سوزی: بدن وارد سوزاندن چربی شده!'
          : '🟣 فاز اتوفاژی: سلول‌ها در حال بازیافت و تعمیر هستند';
        inner = `
          <div style="text-align:center;">
            <div style="font-size:1.6rem; font-weight:900; color:#9c6bff;" id="fasting-live-timer">${faNum(this.formatFastingHMS())}</div>
            <div style="font-size:0.74rem; color:var(--text-muted); margin-top:4px;">از هدف ${faNum(16)} ساعته</div>
            <p style="font-size:0.78rem; color:#fff; margin-top:8px; line-height:1.6;">${stage}</p>
            <button class="btn-secondary" style="margin-top:10px;" data-fast-action="stop">پایان فستینگ ⏹</button>
          </div>`;
      } else {
        inner = `
          <p style="font-size:0.78rem; color:var(--text-muted); line-height:1.6;">
            فستینگ متناوب ۱۶:۸ — روزه‌داری با پنجره غذایی ۸ ساعته. تایمر زنده با تشریح مراحل بیولوژیک بدن.
          </p>
          <button class="btn-primary" style="margin-top:10px;" data-fast-action="start">شروع فستینگ ۱۶ ساعته ⏱️</button>`;
      }
      return `
        <div class="card">
          <div class="card-title"><span>⏳ ردیاب فستینگ (۱۶:۸)</span></div>
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
              <span style="font-size:2.2rem;">🤖</span>
              <div>
                <h4 style="font-size:1rem; font-weight:900; color:#fff;">مربی هوشمند گردول</h4>
                <p style="font-size:0.74rem; color:var(--text-muted);">با آگاهی کامل از پرونده تو — حتی عکس بفرست تا تحلیل کنه</p>
              </div>
            </div>
            <button class="btn-clear-chat" id="coach-clear">پاک کردن 🗑</button>
          </div>
        </div>

        <div id="coach-chat-box" class="coach-chat-box">
          ${this.chat.length === 0 ? `
            <div class="chat-bubble-msg coach">سلام قهرمان! من مربی هوش مصنوعی گردول هستم. قد، وزن، کالری و برنامه تمرینی‌ت رو کامل در پرونده دارم. هر سؤالی درباره تغذیه، فست‌فودها، جایگزینی غذا، درد و فرم تمرین داری بپرس — یا عکس غذا و دستگاه بدنسازی بفرست تا تحلیلش کنم! 💪</div>
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
            <button class="btn-attach" id="coach-attach-btn" title="ارسال عکس برای مربی">📷</button>
            <input type="text" id="coach-user-msg" class="form-input" placeholder="سوالت رو بنویس (مثلاً پیتزا بخورم؟)..."/>
            <button class="btn-primary" style="width:auto; padding:0 18px;" id="coach-send">ارسال</button>
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
      const streak = this.calcStreak();
      return `تو «مربی ارشد گردول» هستی: دلسوز، پرانرژی، متخصص بدنسازی و تغذیه بالینی. همیشه به فارسی روان با لحن مربی پاسخ بده و از ایموجی مناسب استفاده کن.
پرونده کاربر:
- جنسیت: ${p.gender === 'male' ? 'مرد' : 'زن'} | سن: ${p.age} | قد: ${p.heightCm} سانتی‌متر | وزن: ${p.weightKg} کیلو | وزن هدف: ${p.goalWeightKg} کیلو
- کالری روزانه مجاز: ${p.targetKcal} kcal | پروتئین هدف: ${p.proteinG} گرم | آب هدف: ${p.waterMl} میلی‌لیتر
- امروز ${faNum(loggedCal)} کالری ثبت کرده. استریک تمرین: ${streak} روز. روز فعلی برنامه: ${p.currentDay} (${p.selectedPath})
- رژیم: ${p.diet} | پرهیزها: ${p.exclusions}
دستورالعمل‌ها:
۱. برای سوال غذایی (مثل پیتزا، استیک، برنج): کالری واقع‌بینانه بگو و راهکار مدیریت در سقف ${p.targetKcal} کالری ارائه کن — هرگز سرزنش نکن.
۲. اگر عکسی فرستاده شد، مستقیم تحلیلش کن (بشقاب غذا، دستگاه، فرم بدن).
۳. برای سوال تمرینی، دقیق و بیومکانیک‌محور جواب بده و در صورت لزوم به حرکات موجود برنامه ارجاع بده.
۴. پاسخ‌ها خوانا، پرانرژی و علمی باشند. درخواست‌های خارج از حوزه سلامت را مؤدبانه رد کن.`;
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
      chatBox.insertAdjacentHTML('beforeend', `<div class="chat-bubble-msg coach" id="${loadingId}">در حال فکر کردن با هوش مصنوعی گردول... 🤔</div>`);
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
        chatBox.insertAdjacentHTML('beforeend', `<div class="chat-bubble-msg error">⚠️ ${esc(e.message)}</div>`);
        chatBox.scrollTop = chatBox.scrollHeight;
      }
    },

    // ================= بخش ۱۱: وزن و روز هدف =================

    openWeightModal() {
      const modal = document.getElementById('weight-modal');
      const p = this.profile;
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">⚖️ ثبت وزن امروز</h3>
          <button class="btn-close" id="wt-close">×</button>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
          وزن‌کشی منظم (هفته‌ای ۱-۲ بار صبح ناشتا) دقت پیش‌بینی «روز رسیدن به هدف» را بالا می‌برد.
        </p>
        <div class="form-group">
          <label class="form-label">وزن فعلی (کیلوگرم):</label>
          <input type="number" id="wt-input" class="form-input" value="${p.weightKg}" min="35" max="250" step="0.1"/>
        </div>
        <div style="font-size:0.76rem; color:var(--text-muted); margin-bottom:12px;">
          آخرین وزن‌ها: ${((p.weightHistory || []).slice(-4).reverse().map(w => `${faNum(w.kg)}kg (${esc(faDateLong(new Date(w.date + 'T00:00:00')))})`).join(' · ')) || '—'}
        </div>
        <button class="btn-emerald" style="width:100%;" id="wt-save">ثبت و به‌روزرسانی پیش‌بینی 🎯</button>
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

        const reached = (p.primaryGoal === 'lose_weight' && p.weightKg <= p.goalWeightKg) ||
                        (p.primaryGoal === 'gain_muscle' && p.weightKg >= p.goalWeightKg);
        if (reached) this.showGoalCelebration();
        else toast('وزن ثبت شد — پیش‌بینی هدف به‌روز شد ✅');
      });
    },

    showGoalCelebration() {
      const modal = document.getElementById('goal-celebration-modal');
      modal.querySelector('.modal-card').innerHTML = `
        <div style="text-align:center; padding:10px 0;">
          <div style="font-size:4rem;">🏆</div>
          <h2 style="font-size:1.4rem; font-weight:900; color:#fff; margin-top:10px;">به وزن هدف رسیدی!</h2>
          <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.8; margin-top:10px;">
            ${faNum(this.profile.goalWeightKg)} کیلوگرم — دقیقاً همون عددی که روز اول گردول کنار هم گذاشتیم!
            <br/>مربی گردول بهت افتخار می‌کنه. حالا وقتشه هدف بعدی رو انتخاب کنی 💪
          </p>
          <button class="btn-primary" style="margin-top:16px;" id="goal-celebrate-close">ادامه می‌دم 🔥</button>
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
          <h3 class="modal-title">⚙️ تنظیمات</h3>
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
          <button class="btn-secondary" style="flex:1; font-size:0.76rem;" id="set-detect">🔍 شناسایی مدل‌ها</button>
          <button class="btn-secondary" style="flex:1; font-size:0.76rem;" id="set-test">⚡ تست اتصال</button>
        </div>
        <div id="set-status" style="font-size:0.76rem; margin-bottom:12px; display:none;"></div>

        <hr style="border:0; border-top:1px solid var(--border-color); margin:14px 0;"/>

        <div class="form-group">
          <label class="form-label">ساعت یادآور تمرین روزانه:</label>
          <input type="time" id="set-reminder" class="form-input" value="${esc((this.profile && this.profile.reminderTime) || '18:00')}"/>
        </div>
        <button class="btn-secondary" style="font-size:0.8rem;" id="set-test-notif">🔔 ارسال نوتیفیکیشن تستی</button>

        <hr style="border:0; border-top:1px solid var(--border-color); margin:14px 0;"/>

        <div class="form-group">
          <button class="btn-secondary" style="font-size:0.8rem;" id="set-weight">⚖️ ثبت وزن جدید</button>
        </div>

        <div style="background:var(--bg-elevated); border-radius:14px; padding:12px; margin-bottom:12px;">
          <h4 style="font-size:0.85rem; font-weight:900; color:#fff; margin-bottom:8px;">💾 داده‌های من (۱۰۰٪ روی همین دستگاه)</h4>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem;" id="set-export">📥 دانلود بکاپ</button>
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem;" id="set-import">📤 بازیابی بکاپ</button>
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem; color:#ef4444; border-color:rgba(239,68,68,0.4);" id="set-wipe">🗑 پاک‌سازی کامل</button>
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
        modelSel.innerHTML = (models || ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'])
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
        const backup = { app: 'gordol', version: 3, exportedAt: new Date().toISOString(), data: {} };
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('gordol_')) backup.data[k] = localStorage.getItem(k);
        }
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gordol_backup_' + todayKey() + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('بکاپ کامل دانلود شد 📥');
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
            Object.keys(backup.data).forEach(k => {
              if (k.startsWith('gordol_') && typeof backup.data[k] === 'string') localStorage.setItem(k, backup.data[k]);
            });
            toast('بازیابی کامل شد — اپ رفرش می‌شود.');
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

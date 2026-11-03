// ==========================================================================
// حالت قدرتی گردول — برنامه ۵ روزه اورجینال (ست × دامنه تکرار × استراحت)
// + هفته‌بندی ۲۴ هفته‌ای، تقویم شمسی با روز استراحت پنجشنبه/جمعه، تیک ست‌به‌ست
// منطق هفته و تقویم عیناً از کد گردول پلاس v3 بازسازی شده است.
// ==========================================================================

(function () {
  'use strict';

  const Strength = {

    // ---------------- وضعیت ----------------

    state() {
      const app = window.GordolApp;
      if (!app.profile.strength) {
        app.profile.strength = { week: 1, weekAnchor: window.GordolUtil.todayKey(), sessionsDone: 0, doneSets: {} };
        app.saveProfile();
      }
      return app.profile.strength;
    },

    // روز هفته به وقت تهران (عین منطق v3)
    tehranDay() {
      try {
        const tehran = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }));
        return tehran.getDay(); // یکشنبه=0 ... شنبه=6
      } catch (e) {
        return new Date().getDay();
      }
    },

    isRestDay(jsDay) {
      return (window.GORDOL_STRENGTH.restDays || [4, 5]).includes(jsDay);
    },

    // اطلاعات امروز: تمرین یا استراحت
    todayInfo() {
      const S = window.GORDOL_STRENGTH;
      const jsDay = this.tehranDay();
      const planDay = S.calendarMap[jsDay];
      if (this.isRestDay(jsDay)) {
        return { type: 'rest', title: S.restTitles[jsDay] || 'استراحت و ریکاوری', jsDay };
      }
      const day = S.days.find(d => d.day === planDay) || S.days[0];
      return { type: 'workout', day, jsDay };
    },

    // پیشرفت هفته
    weekInfo() {
      const st = this.state();
      return { week: st.week, total: window.GORDOL_STRENGTH.totalWeeks, sessionsDone: st.sessionsDone, totalSessions: window.GORDOL_STRENGTH.sessionsPerWeek };
    },

    setKey(dayNum, exId, setIdx) {
      return 'w' + this.state().week + '_d' + dayNum + '_' + exId + '_s' + setIdx;
    },

    isSetDone(dayNum, exId, setIdx) {
      return !!this.state().doneSets[this.setKey(dayNum, exId, setIdx)];
    },

    toggleSet(dayNum, exId, setIdx) {
      const st = this.state();
      const k = this.setKey(dayNum, exId, setIdx);
      if (st.doneSets[k]) delete st.doneSets[k];
      else st.doneSets[k] = true;
      window.GordolApp.saveProfile();
      return !st.doneSets[k] === false; // حالت جدید: true اگر الان تیک خورده
    },

    exerciseDoneSets(day, exId) {
      const item = day.main.find(x => x.id === exId);
      if (!item) return 0;
      let n = 0;
      for (let i = 0; i < item.setsCount; i++) if (this.isSetDone(day.day, exId, i)) n++;
      return n;
    },

    isExerciseDone(day, exId) {
      const item = day.main.find(x => x.id === exId);
      return item ? this.exerciseDoneSets(day, exId) >= item.setsCount : false;
    },

    isDayComplete(day) {
      return day.main.every(x => this.isExerciseDone(day, x.id));
    },

    daySessionLogged(dayNum) {
      const st = this.state();
      return !!st.doneSets['__session_d' + dayNum + '_w' + st.week];
    },

    // ثبت جلسه کامل‌شده (استریک و لاگ روز — بدون دست زدن به currentDay مسیر مداری)
    logSession(day) {
      const app = window.GordolApp;
      const st = this.state();
      if (st.doneSets['__session_d' + day.day + '_w' + st.week]) return false;
      st.doneSets['__session_d' + day.day + '_w' + st.week] = true;
      st.sessionsDone = Math.min(window.GORDOL_STRENGTH.sessionsPerWeek, st.sessionsDone + 1);
      const t = app.getDayLog(window.GordolUtil.todayKey());
      if (!t.dayCompleted) {
        t.dayCompleted = true;
        t.workoutSeconds = Math.round(day.main.reduce((s, x) => s + x.setsCount, 0) * 75); // تخمین: هر ست ~۷۵ث با استراحت
      }
      day.main.forEach(x => {
        if (!t.exercises.some(e => e.exId === x.id)) t.exercises.push({ exId: x.id, reps: 0, source: 'strength' });
      });
      app.saveLogs();
      app.saveProfile();
      return true;
    },

    // پیشروی هفته: ۵ جلسه کامل → تأیید ورود به هفته بعد (عین v3)
    // خروجی true یعنی هفته جلو رفت (تا بعد از رندر ثبت جلسه، دوباره رندر شود)
    maybeWeekAdvance() {
      const st = this.state();
      const total = window.GORDOL_STRENGTH.sessionsPerWeek;
      if (st.sessionsDone >= total && st.week < window.GORDOL_STRENGTH.totalWeeks) {
        if (confirm('تبریک! تمام ' + total + ' جلسه هفته ' + st.week + ' را کامل کردی. وارد هفته ' + (st.week + 1) + ' شوی؟ (اوردلود و فرم‌دهی جدید فعال می‌شود)')) {
          this.advanceWeek();
          return true;
        }
      }
      return false;
    },

    advanceWeek() {
      const st = this.state();
      st.week++;
      st.sessionsDone = 0;
      st.weekAnchor = window.GordolUtil.todayKey();
      // هرس کلیدهای هفته‌های گذشته
      Object.keys(st.doneSets).forEach(k => {
        if (k.indexOf('_w') > -1) {
          const w = parseInt(k.split('_w')[1], 10);
          if (w < st.week) delete st.doneSets[k];
        }
      });
      window.GordolApp.saveProfile();
      window.GordolApp.sendLocalNotification('به هفته ' + window.GordolUtil.faNum(st.week) + ' خوش آمدی!', 'اوردلود و فرم‌دهی جدید فعال شد. آماده چالش جدید باش.');
      return st.week;
    },

    // اگر ۷ روز از شروع هفته گذشته باشد، هفته جلو می‌رود (عین v3)
    checkWeekRoll() {
      const st = this.state();
      if (!st.weekAnchor) return;
      const anchor = new Date(st.weekAnchor + 'T00:00:00');
      const days = Math.floor((Date.now() - anchor.getTime()) / 86400000);
      if (days >= 7 && st.week < window.GORDOL_STRENGTH.totalWeeks) {
        this.advanceWeek();
        window.GordolApp.toast('هفته جدید ' + window.GordolUtil.faNum(st.week) + ' آغاز شد! آماده چالش جدید باش.');
      }
    },

    setMode(mode) {
      const app = window.GordolApp;
      app.profile.workoutMode = mode;
      app.saveProfile();
      if (mode === 'strength') this.checkWeekRoll();
      app.renderWorkoutTab(document.querySelector('main.main-content'));
    },

    selectedDay: null, // روز انتخابی دستی (پیش‌فرض: امروز تقویم)

    // ---------------- رندر ----------------

    render(container) {
      const app = window.GordolApp;
      this.checkWeekRoll();
      const info = this.todayInfo();
      const wk = this.weekInfo();
      const selDay = this.selectedDay || (info.type === 'workout' ? info.day : null);
      const fa = window.GordolUtil.faNum;

      // بنر تقویم امروز
      let banner;
      if (info.type === 'rest') {
        banner = `
          <div class="card strength-rest-banner">
            ${GordolIcon('moon', 22)}
            <div>
              <b>امروز: ${window.GordolUtil.esc(info.title)}</b>
              <div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">برنامه تمرینی فردا یا روز دلخواه را از پایین انتخاب کن</div>
            </div>
          </div>`;
      } else {
        banner = `
          <div class="card strength-today-banner">
            ${GordolIcon('calendar', 20)}
            <div>
              <b>امروز در تقویم: ${window.GordolUtil.esc(info.day.title)}</b>
              <div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">${window.GordolUtil.esc(info.day.badge)} · ${window.GordolUtil.esc(info.day.duration)}</div>
            </div>
          </div>`;
      }

      container.innerHTML = `
        <div class="card strength-mode-card">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div>
              <h3 style="font-size:1.05rem; font-weight:800; color:#fff;">${GordolIcon('dumbbell', 18)} برنامه قدرتی هفتگی</h3>
              <div style="font-size:0.76rem; color:var(--text-muted); margin-top:3px;">هفته ${fa(wk.week)} از ${fa(wk.total)} · جلسه ${fa(wk.sessionsDone)} از ${fa(wk.totalSessions)}</div>
            </div>
            <button class="btn-secondary" style="width:auto; padding:7px 12px; font-size:0.74rem;" id="btn-mode-circuit">${GordolIcon('timer', 14)} حالت مداری</button>
          </div>
          <div class="strength-week-bar"><div style="width:${Math.round((wk.sessionsDone / wk.totalSessions) * 100)}%"></div></div>
        </div>

        ${banner}

        <div class="strength-day-row">
          ${window.GORDOL_STRENGTH.days.map(d => `
            <button class="strength-day-btn ${selDay && selDay.day === d.day ? 'active' : ''} ${this.isDayComplete(d) ? 'done' : ''}" data-day="${d.day}">
              ${fa(d.day)}
            </button>`).join('')}
        </div>

        ${selDay ? this.renderDay(selDay) : '<div class="card" style="text-align:center; color:var(--text-muted); font-size:0.85rem;">امروز روز استراحته — یکی از روزهای تمرین را از بالا انتخاب کن</div>'}
      `;

      // رویدادها
      document.getElementById('btn-mode-circuit').addEventListener('click', () => this.setMode('circuit'));
      container.querySelectorAll('[data-day]').forEach(b => {
        b.addEventListener('click', () => {
          this.selectedDay = window.GORDOL_STRENGTH.days.find(d => d.day === parseInt(b.dataset.day, 10));
          this.render(container);
        });
      });
      container.querySelectorAll('[data-set]').forEach(b => {
        b.addEventListener('click', () => {
          const [dayNum, exId, setIdx] = b.dataset.set.split('|');
          this.toggleSet(parseInt(dayNum, 10), exId, parseInt(setIdx, 10));
          this.render(container);
        });
      });
      container.querySelectorAll('[data-rest-timer]').forEach(b => {
        b.addEventListener('click', () => this.startRestTimer(b, parseInt(b.dataset.restTimer, 10)));
      });
      const guidedBtn = document.getElementById('btn-guided-start');
      if (guidedBtn) guidedBtn.addEventListener('click', () => this.startGuidedSession(selDay));
      const finishBtn = document.getElementById('btn-strength-finish');
      if (finishBtn) finishBtn.addEventListener('click', () => {
        if (this.logSession(selDay)) {
          app.sendLocalNotification('جلسه قدرتی امروز ثبت شد!', selDay.title + ' کامل شد. آفرین قهرمان!');
          app.toast('جلسه تمرین ثبت شد! استریک تو ادامه دارد.');
          this.render(container); // همیشه ابتدا وضعیت «ثبت شده» را نشان بده
          // ورود به هفته بعد فقط بعد از رندر ثبت جلسه؛ در صورت پیشروی، نمای تازه رندر می‌شود
          if (this.maybeWeekAdvance()) this.render(container);
        } else {
          app.toast('این جلسه قبلاً ثبت شده است.', false);
        }
      });
      // بارگذاری تامبنیل‌ها
      if (window.GordolThumbs && selDay) {
        container.querySelectorAll('[data-thumb]').forEach(el => {
          window.GordolThumbs.get(el.dataset.thumb, (dataUrl) => {
            if (dataUrl) {
              el.style.backgroundImage = 'url(' + dataUrl + ')';
              el.classList.add('has-thumb');
            }
          });
        });
      }
    },

    renderDay(day) {
      const app = window.GordolApp;
      const fa = window.GordolUtil.faNum;
      const ex = (id) => (window.GORDOL_EXERCISES || []).find(e => e.id === id) || { id, nameFa: id, videoUrl: 'videos/' + id + '.mp4' };

      const phase = (title, color, items, kind) => `
        <h4 style="font-size:0.9rem; font-weight:800; margin:16px 0 10px; color:${color};">${window.GordolUtil.esc(title)}</h4>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${items.map(x => {
            const e = ex(x.id);
            const doneSets = kind === 'main' ? this.exerciseDoneSets(day, x.id) : 0;
            const setsTotal = kind === 'main' ? x.setsCount : (String(x.sets || '').match(/\d/) ? parseInt(String(x.sets).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)), 10) : 2);
            const isDone = kind === 'main' ? this.isExerciseDone(day, x.id) : false;
            return `
              <div class="card strength-ex-card ${isDone ? 'done' : ''}">
                <div style="display:flex; gap:10px; align-items:flex-start;">
                  <div class="ex-thumb" data-thumb="${window.GordolUtil.esc(x.id)}" data-act="video">${GordolIcon('play', 16)}</div>
                  <div style="flex:1; min-width:0;">
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                      <h5 style="font-size:0.88rem; font-weight:800; color:#fff;">${window.GordolUtil.esc(e.nameFa)}</h5>
                      ${isDone ? '<span style="font-size:0.62rem; background:rgba(16,185,129,0.25); color:#10b981; padding:1px 6px; border-radius:6px;">کامل شد</span>' : ''}
                      ${e.perSide ? '<span style="font-size:0.62rem; background:rgba(156,107,255,0.2); color:#c9b3ff; padding:1px 6px; border-radius:6px;">هر طرف</span>' : ''}
                    </div>
                    <div style="font-size:0.74rem; color:var(--text-muted); margin-top:3px;">${window.GordolUtil.esc(x.reps || '')}${x.restSec ? ' · استراحت ' + fa(x.restSec) + ' ثانیه' : ''}</div>
                    ${kind === 'main' ? `
                      <div style="display:flex; gap:6px; margin-top:8px; align-items:center; flex-wrap:wrap;">
                        <span style="font-size:0.7rem; color:var(--text-muted);">ست‌ها:</span>
                        ${Array.from({ length: setsTotal }, (_, i) => `
                          <button class="set-pill ${this.isSetDone(day.day, x.id, i) ? 'done' : ''}" data-set="${day.day}|${x.id}|${i}">${fa(i + 1)}</button>`).join('')}
                        <button class="rest-chip" data-rest-timer="${x.restSec || 45}">${GordolIcon('timer', 12)} ${fa(x.restSec || 45)}ث</button>
                      </div>` : ''}
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>`;

      const allMainDone = this.isDayComplete(day);
      const logged = this.daySessionLogged(day.day);

      return `
        <div class="card" style="background:linear-gradient(135deg, rgba(16,185,129,0.12), rgba(6,182,212,0.1)); border-color:rgba(16,185,129,0.4); margin-bottom:14px;">
          <h3 style="font-size:1rem; font-weight:800; color:#fff;">${window.GordolUtil.esc(day.title)}</h3>
          <div style="font-size:0.76rem; color:var(--text-muted); margin-top:3px;">${window.GordolUtil.esc(day.badge)} · ${window.GordolUtil.esc(day.duration)}</div>
        </div>
        <div style="margin:14px 0 4px;">
          <button class="btn-primary" style="width:100%; padding:13px;" id="btn-guided-start">${GordolIcon('play', 17)} شروع جلسه هدایت‌شده (ترتیبی با تایمر)</button>
        </div>
        ${phase('۱. گرم کردن و روان‌سازی', 'var(--accent-purple)', day.warmup, 'warmup')}
        ${phase('۲. تمرینات اصلی قدرتی', 'var(--accent-coral)', day.main, 'main')}
        ${phase('۳. سرد کردن و کشش', 'var(--accent-emerald)', day.cooldown, 'cooldown')}
        <div style="margin:10px 0 10px;">
          <button class="btn-emerald" style="width:100%; padding:13px;" id="btn-strength-finish" ${logged ? 'disabled' : ''}>
            ${GordolIcon('check-circle', 16)} ${logged ? 'این جلسه ثبت شده است' : 'ثبت اتمام جلسه ' + fa(day.day) + ' (استریک +۱)'}
          </button>
          ${allMainDone && !logged ? '<p style="text-align:center; font-size:0.74rem; color:#10b981; margin-top:8px; font-weight:700;">همه ست‌ها کامل شد — جلسه آماده ثبت است!</p>' : ''}
        </div>
      `;
    },

    // تایمر استراحت درجا روی چیپ
    startRestTimer(chip, seconds) {
      if (chip.dataset.running) return;
      chip.dataset.running = '1';
      let left = seconds;
      const original = chip.innerHTML;
      window.GordolApp.playBeep(660, 0.12);
      const tick = () => {
        if (left <= 0) {
          clearInterval(iv);
          delete chip.dataset.running;
          chip.innerHTML = original;
          window.GordolApp.playBeep(880, 0.2);
          window.GordolApp.toast('استراحت تمام شد — ست بعدی!');
          return;
        }
        chip.textContent = window.GordolUtil.faNum(left) + ' ثانیه';
        left--;
      };
      tick();
      const iv = setInterval(tick, 1000);
    },

  // ---------------- پلیر جلسه هدایت‌شده ترتیبی (درخواست کاربر) ----------------
  // جریان: گرم کردن → حرکت ۱ (همه ست‌ها با استراحت بین‌شان و تایمر خود حرکت) → حرکت ۲ → ... → سرد کردن → پایان دور (تکرار یا ثبت)

  player: null, // {day, steps, i, round, phase, workLeft, restLeft, timerId, paused, onTimerDone}

  startGuidedSession(day) {
    if (window.GordolApp.acquireWakeLock) window.GordolApp.acquireWakeLock(); // صفحه گوشی خاموش نشود
    this.player = { day, steps: this.buildSteps(day), i: 0, round: 1, phase: 'work', workLeft: 0, restLeft: 0, timerId: null, paused: false, onTimerDone: null };
    const modal = document.getElementById('session-player-modal');
    modal.querySelector('.modal-card').style.maxWidth = '480px';
    this.renderPlayer();
    modal.classList.add('active');
    this.playerTimerStart(); // اگر گام اول تایمری باشد شروع می‌شود
  },

  // تبدیل روز برنامه به گام‌های ترتیبی پلیر
  buildSteps(day) {
    const steps = [];
    const parseSec = (txt) => {
      if (!txt || String(txt).indexOf('ثانیه') === -1) return null;
      const fa = '۰۱۲۳۴۵۶۷۸۹';
      const m = String(txt).replace(/[۰-۹]/g, d => fa.indexOf(d)).match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    };
    (day.warmup || []).forEach(x => {
      const sec = parseSec(x.reps) || 30;
      steps.push({ kind: 'warmup', item: x, exId: x.id, sec, timed: true, setIndex: 0, setTotal: 1, restSec: x.restSec || 30 });
    });
    day.main.forEach(item => {
      const ex = (window.GORDOL_EXERCISES || []).find(e => e.id === item.id) || {};
      const timed = ex.measure === 'SECONDS';
      for (let s = 0; s < item.setsCount; s++) {
        steps.push({
          kind: 'main', item, exId: item.id,
          sec: timed ? (ex.suggestedSeconds || parseSec(item.reps) || 30) : null,
          timed, setIndex: s, setTotal: item.setsCount,
          restSec: item.restSec || 45, perSide: !!ex.perSide
        });
      }
    });
    (day.cooldown || []).forEach(x => {
      const sec = parseSec(x.reps) || 30;
      steps.push({ kind: 'cooldown', item: x, exId: x.id, sec, timed: true, setIndex: 0, setTotal: 1, restSec: x.restSec || 20 });
    });
    return steps;
  },

  playerStep() {
    const pl = this.player;
    return pl ? pl.steps[pl.i] : null;
  },

  renderPlayer() {
    const pl = this.player;
    if (!pl) return;
    const fa = window.GordolUtil.faNum;
    const step = pl.steps[pl.i];
    const modal = document.getElementById('session-player-modal');

    // پایان دور
    if (pl.phase === 'done') {
      modal.querySelector('.modal-card').innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">${GordolIcon('check-circle', 20)} یک دور کامل شد! 🔥</h3>
          <button class="btn-close" id="gsp-close">×</button>
        </div>
        <div style="text-align:center; padding:14px 0;">
          <div style="color:var(--accent-emerald);">${GordolIcon('trophy', 52)}</div>
          <p style="font-size:0.86rem; color:var(--text-muted); margin-top:10px; line-height:1.9;">گرم کردن، ${fa(pl.day.main.length)} حرکت اصلی با همه ست‌ها و سرد کردن انجام شد.</p>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn-primary" style="flex:1;" id="gsp-next-round">${GordolIcon('refresh', 16)} دور بعد (${fa(pl.round + 1)})</button>
          <button class="btn-emerald" style="flex:1;" id="gsp-finish">${GordolIcon('check-circle', 16)} ثبت پایان جلسه</button>
        </div>
        <button class="btn-secondary" style="width:100%; margin-top:10px; font-size:0.76rem; color:#ef4444; border-color:rgba(239,68,68,0.3);" id="gsp-end">بلى، و ثبت جلسه</button>
      `;
      const bind0 = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
      bind0('gsp-close', () => this.closePlayer());
      bind0('gsp-next-round', () => { pl.round++; pl.i = 0; pl.phase = 'work'; this.renderPlayer(); this.playerTimerStart(); });
      bind0('gsp-finish', () => this.playerFinish());
      bind0('gsp-end', () => this.playerFinish());
      return;
    }

    const ex = (window.GORDOL_EXERCISES || []).find(e => e.id === step.exId) || { id: step.exId, nameFa: step.exId, videoUrl: 'videos/' + step.exId + '.mp4' };
    const kindLabel = step.kind === 'warmup' ? 'گرم کردن' : (step.kind === 'cooldown' ? 'سرد کردن و کشش' : 'تمرین اصلی');
    const counter = step.kind === 'main'
      ? `ست ${fa(step.setIndex + 1)} از ${fa(step.setTotal)} · دور ${fa(pl.round)}`
      : `${kindLabel} · دور ${fa(pl.round)}`;
    const actionText = step.timed
      ? (pl.phase === 'work' ? 'اجرا کن — تایمر روشنه!' : 'استراحت — نفس بگیر')
      : (pl.phase === 'work' ? window.GordolUtil.esc(step.item.reps || 'اجرا کن و دکمه را بزن') : 'استراحت — نفس بگیر');

    modal.querySelector('.modal-card').innerHTML = `
      <div class="modal-header">
        <div>
          <h3 class="modal-title">${window.GordolUtil.esc(ex.nameFa)}</h3>
          <div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">${window.GordolUtil.esc(counter)} · حرکت ${fa(pl.i + 1)} از ${fa(pl.steps.length)}</div>
        </div>
        <button class="btn-close" id="gsp-close">×</button>
      </div>
      <div class="sp-video-box">
        <video id="gsp-video" autoplay loop muted playsinline></video>
        <div class="sp-phase-badge ${pl.phase === 'rest' ? 'rest' : ''}" id="gsp-phase">${pl.phase === 'rest' ? 'استراحت' : kindLabel}</div>
      </div>
      <div style="display:flex; align-items:center; justify-content:center; margin:14px 0;">
        <div class="sp-timer-wrap">
          <svg viewBox="0 0 120 120" class="sp-timer-svg">
            <circle cx="60" cy="60" r="54" class="sp-timer-bg"/>
            <circle cx="60" cy="60" r="54" class="sp-timer-fg" id="gsp-circle"/>
          </svg>
          <div class="sp-timer-num" id="gsp-timer-num">—</div>
        </div>
      </div>
      <div style="text-align:center; min-height:44px;">
        <div style="font-size:0.95rem; font-weight:800; color:#fff;">${actionText}</div>
        ${step.perSide ? '<div style="font-size:0.74rem; color:#c9b3ff; margin-top:3px;">هر طرف جداگانه اجرا شود</div>' : ' '}
      </div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        ${pl.phase === 'work' && !step.timed && step.kind === 'main' ? `<button class="btn-emerald" style="flex:1;" id="gsp-tick">${GordolIcon('check', 16)} ست انجام شد</button>` : ' '}
        ${pl.phase === 'work' && step.timed ? `<button class="btn-secondary" style="flex:1;" id="gsp-skip">رد کردن ${GordolIcon('skip', 14)}</button>` : ' '}
        ${pl.phase === 'rest' ? `<button class="btn-secondary" style="flex:1;" id="gsp-pause">${GordolIcon('pause', 15)} مکث</button>` : ' '}
        ${pl.phase === 'rest' ? `<button class="btn-secondary" style="flex:1;" id="gsp-skip">رد استراحت ${GordolIcon('skip', 14)}</button>` : ' '}
      </div>
      <button class="btn-secondary" style="width:100%; margin-top:10px; font-size:0.76rem; color:#ef4444; border-color:rgba(239,68,68,0.3);" id="gsp-end">پایان و ثبت جلسه</button>
    `;

    const video = document.getElementById('gsp-video');
    if (video) {
      if ((video.getAttribute('src') || '').indexOf(ex.videoUrl) === -1) {
        video.setAttribute('src', ex.videoUrl);
        video.load();
      }
      video.play().catch(() => {});
      if (window.GordolThumbs) window.GordolThumbs.attachPoster(step.exId, video);
      window.GordolApp.attachVideoOverlay(video);
    }

    const num = document.getElementById('gsp-timer-num');
    const circle = document.getElementById('gsp-circle');
    if (pl.phase === 'work' && step.timed) {
      if (num) num.textContent = fa(Math.max(0, pl.workLeft));
      this.drawCircle(pl.workLeft, step.sec);
    } else if (pl.phase === 'rest') {
      if (num) num.textContent = fa(Math.max(0, pl.restLeft));
      this.drawCircle(pl.restLeft, step.restSec);
    } else if (pl.phase === 'work') {
      if (num) num.textContent = fa(step.setIndex + 1) + '/' + fa(step.setTotal);
      if (circle) { circle.style.strokeDasharray = 2 * Math.PI * 54; circle.style.strokeDashoffset = 0; }
    }

    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('gsp-close', () => this.closePlayer());
    bind('gsp-tick', () => this.playerTickManual());
    bind('gsp-skip', () => this.playerSkip());
    bind('gsp-pause', () => {
      pl.paused = !pl.paused;
      const b = document.getElementById('gsp-pause');
      if (b) b.innerHTML = pl.paused ? GordolIcon('play', 15) + ' ادامه' : GordolIcon('pause', 15) + ' مکث';
    });
    bind('gsp-finish', () => this.playerFinish());
    bind('gsp-end', () => this.playerFinish());
  },

  drawCircle(left, total) {
    const circle = document.getElementById('gsp-circle');
    const num = document.getElementById('gsp-timer-num');
    const fa = window.GordolUtil.faNum;
    if (num) num.textContent = fa(Math.max(0, left));
    if (circle) {
      const c = 2 * Math.PI * 54;
      circle.style.strokeDasharray = c;
      circle.style.strokeDashoffset = c * (1 - Math.max(0, left) / Math.max(1, total));
    }
  },

  // تایمر عمومی پلیر — فاز work (تایمری/دستی) و rest را مدیریت می‌کند
  playerTimerStart() {
    const pl = this.player;
    if (!pl) return;
    const step = pl.steps[pl.i];
    if (pl.phase === 'work' && step.timed) {
      pl.workLeft = step.sec;
      this.drawCircle(pl.workLeft, step.sec); // نمایش فوری مقدار اولیه (بدون یک ثانیه «۰»)
      this.runCountdown(pl.workLeft, step.sec, () => {
        window.GordolApp.playBeep(880, 0.2);
        if (step.kind === 'main') this.markSetDone(pl.day.day, step.item.id, step.setIndex); // ست تایمری خودکار تیک می‌خورد
        this.playerGoRest();
      });
    }
  },

  runCountdown(from, total, onDone) {
    const pl = this.player;
    if (pl.timerId) clearInterval(pl.timerId);
    pl.paused = false;
    pl.onTimerDone = onDone;
    pl.timerId = setInterval(() => {
      if (pl.paused) return;
      if (pl.phase === 'work') { pl.workLeft--; this.drawCircle(pl.workLeft, total); }
      else { pl.restLeft--; this.drawCircle(pl.restLeft, total); }
      const left = pl.phase === 'work' ? pl.workLeft : pl.restLeft;
      if (left <= 3 && left > 0) window.GordolApp.playBeep(660, 0.08);
      if (left <= 0) {
        clearInterval(pl.timerId);
        pl.timerId = null;
        window.GordolApp.playBeep(880, 0.2);
        const fn = pl.onTimerDone;
        pl.onTimerDone = null;
        if (fn) fn();
      }
    }, 1000);
  },

  markSetDone(dayNum, exId, setIdx) {
    if (!this.isSetDone(dayNum, exId, setIdx)) this.toggleSet(dayNum, exId, setIdx);
  },

  playerTickManual() {
    const pl = this.player;
    const step = pl.steps[pl.i];
    window.GordolApp.playBeep(880, 0.15);
    if (step.kind === 'main') this.markSetDone(pl.day.day, step.item.id, step.setIndex);
    this.playerGoRest();
  },

  // بعد از هر گام تمرین: استراحت (به‌جز آخرین گام کل جلسه)
  playerGoRest() {
    const pl = this.player;
    const step = pl.steps[pl.i];
    const isLast = pl.i >= pl.steps.length - 1;
    if (isLast) { pl.phase = 'done'; this.renderPlayer(); return; }
    pl.phase = 'rest';
    pl.restLeft = step.restSec || 45;
    this.renderPlayer();
    this.runCountdown(pl.restLeft, step.restSec, () => { pl.i++; pl.phase = 'work'; this.renderPlayer(); this.playerTimerStart(); });
  },

  playerSkip() {
    const pl = this.player;
    if (pl.phase === 'rest') {
      if (pl.timerId) { clearInterval(pl.timerId); pl.timerId = null; }
      const fn = pl.onTimerDone;
      pl.onTimerDone = null;
      pl.i++; pl.phase = 'work';
      this.renderPlayer();
      this.playerTimerStart();
    } else {
      // رد کردن گام تمرین (بدون تیک) → استراحت و ادامه
      if (pl.timerId) { clearInterval(pl.timerId); pl.timerId = null; }
      this.playerGoRest();
    }
  },

  playerFinish() {
    if (window.GordolApp.releaseWakeLock) window.GordolApp.releaseWakeLock();
    const pl = this.player;
    if (pl.timerId) { clearInterval(pl.timerId); pl.timerId = null; }
    const day = pl.day;
    this.player = null;
    document.getElementById('session-player-modal').classList.remove('active');
    const logged = this.logSession(day);
    if (logged) {
      window.GordolApp.sendLocalNotification('جلسه قدرتی امروز ثبت شد!', day.title + ' کامل شد. آفرین قهرمان!');
      window.GordolApp.toast('جلسه ثبت شد — استریک تو ادامه دارد!');
    } else {
      window.GordolApp.toast('این جلسه قبلاً ثبت شده است.', false);
    }
    this.render(document.querySelector('main.main-content'));
  },

  closePlayer() {
    if (window.GordolApp.releaseWakeLock) window.GordolApp.releaseWakeLock();
    const pl = this.player;
    if (pl && pl.timerId) { clearInterval(pl.timerId); pl.timerId = null; }
    this.player = null;
    document.getElementById('session-player-modal').classList.remove('active');
    window.GordolApp.toast('جلسه نیمه‌کاره رها شد — تیک‌ها سر جایشان هستند.', false);
  },

  };

  window.GordolStrength = Strength;
})();

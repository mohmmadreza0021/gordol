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
        ${phase('۱. گرم کردن و روان‌سازی', 'var(--accent-purple)', day.warmup, 'warmup')}
        ${phase('۲. تمرینات اصلی قدرتی', 'var(--accent-coral)', day.main, 'main')}
        ${phase('۳. سرد کردن و کشش', 'var(--accent-emerald)', day.cooldown, 'cooldown')}
        <div style="margin:20px 0 10px;">
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
    }
  };

  window.GordolStrength = Strength;
})();

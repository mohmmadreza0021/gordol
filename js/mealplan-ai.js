// ==========================================================================
// برنامه هفتگی هوشمند گردول — تولید ۷ روز برنامه غذایی اختصاصی با AI کاربر
// (اسکلت آماده — پیاده‌سازی کامل توسط ایجنت توسعه در ادامه تکمیل می‌شود)
// ==========================================================================

(function () {
  'use strict';

  const LS_KEY = 'gordol_mealplan_v1';
  const MEAL_ORDER = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner'];
  const MEAL_FA = { breakfast: 'صبحانه', snack1: 'میان‌وعده صبح', lunch: 'ناهار', snack2: 'میان‌وعده عصر', dinner: 'شام' };
  const DAY_FA = ['روز ۱', 'روز ۲', 'روز ۳', 'روز ۴', 'روز ۵', 'روز ۶', 'روز ۷'];
  const EMOJI = { breakfast: '🍳', snack1: '🍎', lunch: '🍲', snack2: '🥜', dinner: '🥗' };

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { return null; }
  }
  function save(plan) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(plan)); } catch (e) {}
  }

  window.GordolMealPlan = {
    getWeek() { return load(); },

    clear() { localStorage.removeItem(LS_KEY); },

    // تولید برنامه ۷ روزه با AI کاربر
    async generate() {
      // تلاش مجدد خودکار: پاسخ‌های بزرگ AI گاهی ناقص می‌آیند
      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { return await this._generateOnce(); }
        catch (e) { lastErr = e; if (attempt < 2) await new Promise(r => setTimeout(r, 1500)); }
      }
      throw new Error((lastErr && lastErr.message ? lastErr.message : 'تولید ناموفق') + ' — دوباره تلاش کن.');
    },

    async _generateOnce() {
      const app = window.GordolApp;
      const p = app.profile;
      if (!p) throw new Error('اول آنبوردینگ را کامل کن.');
      if (!window.GordolAI.hasKey()) { app.openMandatoryApiModal(); throw new Error('کلید API فعال نیست.'); }

      const prompt = [
        'تو سرآشپز و متخصص تغذیه بالینی ایرانیِ اپ گردول هستی.',
        'یک برنامه غذایی کامل ۷ روزه برای کاربر بساز:',
        '- کالری هدف روزانه: ' + p.targetKcal + ' kcal | پروتئین: ' + p.proteinG + ' گرم',
        '- رژیم: ' + p.diet + ' | پرهیزها: ' + ((Array.isArray(p.exclusions) && p.exclusions.length) ? p.exclusions.join('، ') : 'ندارد') +
          (p.bodyProfile && p.bodyProfile.injuriesText ? '' : ''),
        '- هر روز دقیقاً ۵ وعده با این mealType ها به همین ترتیب: breakfast, snack1, lunch, snack2, dinner',
        '- غذاهای واقعی و اصیل ایرانی با مقادیر دقیق (مثلاً «۱۸۰ گرم سینه مرغ گریل»)، تنوع روزانه، و مجموع کالری هر روز نزدیک به هدف.',
        'فقط JSON برگردان با ساختار: {"days":[{"meals":[{"mealType":"breakfast","name":"...","desc":"...","cal":520,"p":42,"c":52,"f":14}, ...]}, ...]} — دقیقاً ۷ روز و ۵ وعده در هر روز.'
      ].join('\n');

      const res = await window.GordolAI.generateJSON(prompt, ['days'], { numericKeys: [], generationConfig: { temperature: 0.6, maxOutputTokens: 8192 } });
      const days = res.days;
      if (!Array.isArray(days) || days.length !== 7) throw new Error('برنامه ناقص تولید شد — دوباره تلاش کن.');
      // اعتبارسنجی هر وعده
      days.forEach((d, di) => {
        if (!Array.isArray(d.meals)) throw new Error('روز ' + (di + 1) + ' ناقص است.');
        if (d.meals.length !== 5) throw new Error('روز ' + (di + 1) + ' باید ۵ وعده داشته باشد.');
        d.meals.forEach(m => {
          if (!MEAL_ORDER.includes(m.mealType)) throw new Error('وعده نامعتبر در روز ' + (di + 1));
          m.name = String(m.name || ''); m.desc = String(m.desc || '');
          ['cal', 'p', 'c', 'f'].forEach(k => { m[k] = Math.round(Number(m[k]) || 0); });
        });
        // مرتب‌سازی وعده‌ها به ترتیب استاندارد
        d.meals.sort((a, b) => MEAL_ORDER.indexOf(a.mealType) - MEAL_ORDER.indexOf(b.mealType));
      });

      const plan = { days, generatedAt: new Date().toISOString(), targetKcal: p.targetKcal };
      save(plan);
      return plan;
    },

    // رندر برنامه در کانتینر تب تغذیه
    render(container) {
      const plan = load();
      const app = window.GordolApp;
      if (!container) return;
      if (!plan) { container.innerHTML = '<p style="font-size:0.78rem; color:var(--text-muted);">هنوز برنامه‌ای تولید نشده.</p>'; return; }
      const fa = window.GordolUtil.faNum;
      const esc = window.GordolUtil.esc;

      container.innerHTML = plan.days.map((d, di) => {
        const dayCal = d.meals.reduce((s, m) => s + (m.cal || 0), 0);
        return `
          <div style="border:1px solid var(--border-color); border-radius:14px; padding:10px 12px; margin-bottom:8px; background:var(--bg-elevated);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <b style="font-size:0.85rem; color:#fff;">${esc(DAY_FA[di])}</b>
              <span style="font-size:0.74rem; color:#f59e0b; font-weight:800;">🔥 ${fa(dayCal)} kcal</span>
            </div>
            ${d.meals.map(m => `
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-top:1px solid var(--border-color);">
                <div style="min-width:0;">
                  <div style="font-size:0.78rem; font-weight:800; color:#fff;">${EMOJI[m.mealType] || '🍽️'} ${esc(m.name)}</div>
                  <div style="font-size:0.68rem; color:var(--text-muted); margin-top:1px;">${esc(m.desc)}</div>
                </div>
                <button class="btn-secondary mini" data-wp-log="${di}|${m.mealType}" title="ثبت این وعده در امروز">${GordolIcon('plus', 13)}</button>
              </div>`).join('')}
          </div>`;
      }).join('') + `
        <p style="font-size:0.68rem; color:var(--text-dim); text-align:center; margin-top:6px;">
          تولید شده در ${esc(new Intl.DateTimeFormat('fa-IR').format(new Date(plan.generatedAt)))} — با «تولید دوباره» می‌توانی تنوع جدید بگیری.
        </p>`;

      container.querySelectorAll('[data-wp-log]').forEach(btn => {
        btn.addEventListener('click', () => {
          const [di, mealType] = btn.dataset.wpLog.split('|');
          const meal = plan.days[+di].meals.find(m => m.mealType === mealType);
          if (!meal) return;
          app.logMeal(mealType, meal.name, meal.cal, meal.p, meal.c, meal.f);
          btn.textContent = '✓';
          btn.disabled = true;
          app.toast('«' + meal.name + '» در ' + app.mealTypeFa(mealType) + ' امروز ثبت شد ✅');
        });
      });
    }
  };
})();

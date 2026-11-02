// ==========================================================================
// کلاینت امن هوش مصنوعی گردول (Gordol AI Client)
// اصول امنیتی:
//  - کلید API فقط در حافظه مرورگر کاربر ذخیره می‌شود (localStorage دستگاه خود کاربر)
//  - کلید فقط و فقط به اندپوینت رسمی Google Generative Language ارسال می‌شود
//  - هیچ سرور واسط، هیچ تحلیلی، هیچ لاگی وجود ندارد
//  - خروجی مدل هرگز مستقیم در DOM تزریق نمی‌شود (escape اجباری در UI)
// ==========================================================================

(function () {
  'use strict';

  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const DEFAULT_MODEL = 'gemini-2.0-flash';
  const TIMEOUT_MS = 45000;

  const GordolAI = {
    config: { apiKey: '', model: DEFAULT_MODEL },

    loadConfig() {
      try {
        const raw = localStorage.getItem('gordol_ai_config_v3');
        if (raw) {
          const c = JSON.parse(raw);
          if (c && typeof c.apiKey === 'string') {
            this.config = { apiKey: c.apiKey, model: c.model || DEFAULT_MODEL };
          }
        }
      } catch (e) { /* config خراب — نادیده بگیر */ }
      return this.config;
    },

    saveConfig() {
      try {
        localStorage.setItem('gordol_ai_config_v3', JSON.stringify(this.config));
      } catch (e) { /* حافظه پر است */ }
    },

    hasKey() {
      return !!(this.config.apiKey && this.config.apiKey.trim().length > 20);
    },

    async validateKey(key) {
      const url = `${API_BASE}/models/${DEFAULT_MODEL}:generateContent`;
      const res = await this._fetch(url, {
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 5 }
      }, key);
      return !!(res && res.candidates && res.candidates.length);
    },

    async listModels(key) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        // کلید در هدر ارسال می‌شود تا در URL (لاگ واسط‌ها) ظاهر نشود
        const url = `${API_BASE}/models?pageSize=100`;
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'x-goog-api-key': key } });
        if (!res.ok) throw new Error('خطای دسترسی به فهرست مدل‌ها (' + res.status + ')');
        const data = await res.json();
        return (data.models || [])
          .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && !/embedding|aqa|image|audio|tts|live/i.test(m.name))
          .map(m => m.name.replace('models/', ''));
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('زمان دریافت فهرست مدل‌ها تمام شد');
        throw e;
      } finally {
        clearTimeout(t);
      }
    },

    // درخواست متنی ساده — خروجی: متن پاسخ
    async generate(prompt, opts) {
      const o = opts || {};
      const url = `${API_BASE}/models/${this.config.model || DEFAULT_MODEL}:generateContent`;
      const body = {
        contents: o.history ? o.history.concat([{ role: 'user', parts: [{ text: prompt }] }]) : [{ parts: [{ text: prompt }] }],
        generationConfig: Object.assign({ temperature: 0.7, maxOutputTokens: 1600 }, o.generationConfig || {})
      };
      if (o.systemPrompt) body.systemInstruction = { parts: [{ text: o.systemPrompt }] };
      const res = await this._fetch(url, body, this.config.apiKey);
      const cand = res && res.candidates && res.candidates[0];
      const text = cand && cand.content && cand.content.parts
        ? cand.content.parts.map(p => p.text || '').join('')
        : '';
      return text;
    },

    // درخواست با تصویر (بینایی ماشین)
    async generateWithImage(prompt, base64Jpeg, opts) {
      const o = opts || {};
      const url = `${API_BASE}/models/${this.config.model || DEFAULT_MODEL}:generateContent`;
      const parts = [{ text: prompt }];
      if (base64Jpeg) parts.push({ inline_data: { mime_type: 'image/jpeg', data: base64Jpeg } });
      const body = {
        contents: o.history ? o.history.concat([{ role: 'user', parts }]) : [{ parts }],
        generationConfig: Object.assign({ temperature: 0.5, maxOutputTokens: 1600 }, o.generationConfig || {})
      };
      if (o.systemPrompt) body.systemInstruction = { parts: [{ text: o.systemPrompt }] };
      const res = await this._fetch(url, body, this.config.apiKey);
      const cand = res && res.candidates && res.candidates[0];
      return cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
    },

    // درخواست JSON ساخت‌یافته — با استخراج مقاوم، اعتبارسنجی کلیدها و اجبار نوع عددی
    async generateJSON(prompt, requiredKeys, opts) {
      const o = opts || {};
      const jsonInstruction =
        `${prompt}\n\n[قانون خروجی — حیاتی]: پاسخ را فقط و فقط به صورت یک شیء JSON معتبر بنویس. ` +
        `بدون هیچ متن اضافه، بدون markdown، بدون بک‌تیک. ` +
        `کلیدهای الزامی: ${(requiredKeys || []).join(', ')}.` +
        (o.numericKeys && o.numericKeys.length ? ` مقادیر کلیدهای ${o.numericKeys.join(', ')} حتماً باید عدد باشند (نه متن).` : '');
      let text = await this.generate(jsonInstruction, Object.assign({ generationConfig: { temperature: 0.4 } }, o));
      const parsed = this.extractJSON(text, requiredKeys, o.numericKeys);
      return parsed;
    },

    extractJSON(text, requiredKeys, numericKeys) {
      if (!text) throw new Error('پاسخ خالی از مدل');
      let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const m = t.match(/\{[\s\S]*\}/);
      if (m) t = m[0];
      let obj;
      try { obj = JSON.parse(t); } catch (e) {
        throw new Error('مدل پاسخ JSON معتبر نداد');
      }
      const missing = (requiredKeys || []).filter(k => obj[k] === undefined || obj[k] === null);
      if (missing.length) throw new Error('پاسخ مدل ناقص بود (کلیدهای: ' + missing.join(', ') + ')');
      // اجبار نوع عددی — ضد تزریق از طریق فیلدهای «عددی»
      (numericKeys || []).forEach(k => {
        const n = Number(obj[k]);
        if (!Number.isFinite(n)) throw new Error('مقدار عددی نامعتبر از مدل (' + k + ')');
        obj[k] = n;
      });
      return obj;
    },

    async _fetch(url, body, apiKey) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // کلید فقط در هدر — هرگز در URL نمی‌آید
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
      } catch (e) {
        clearTimeout(t);
        if (e.name === 'AbortError') throw new Error('پاسخ هوش مصنوعی بیش از حد طول کشید');
        throw new Error('اتصال به سرور هوش مصنوعی برقرار نشد (اینترنت یا کلید را بررسی کن)');
      }
      clearTimeout(t);
      let data;
      try { data = await res.json(); } catch (e) {
        throw new Error('پاسخ نامعتبر از سرور گوگل (' + res.status + ')');
      }
      if (data.error) {
        const msg = data.error.message || 'خطای ناشناخته سرویس';
        if (res.status === 400 && /API key not valid/i.test(msg)) throw new Error('کلید API نامعتبر است');
        if (res.status === 429) throw new Error('محدودیت نرخ درخواست — چند لحظه بعد دوباره تلاش کن');
        throw new Error(msg);
      }
      return data;
    }
  };

  window.GordolAI = GordolAI;
})();

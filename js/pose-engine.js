// ==========================================================================
// چشم گِردول — موتور واقعی بینایی ماشین بدن (Real Pose Vision Engine)
// بر پایه Google MediaPipe Pose Landmarker (اجرا کامل روی دستگاه کاربر)
// هیچ فریمی از دوربین هرگز آپلود یا ذخیره نمی‌شود — پردازش فقط در RAM مرورگر.
//
// مکانیزم‌های شمارش:
//   A) ماشین حالت زاویه‌ای (Angle FSM) — شنا، اسکوات، لانج، کرانچ، پل باسن، هینج، بارفیکس...
//   B) شمارنده چرخه اندام (Limb Cycle) — مونتین‌کلایمبر، زانو بلند، پاشنه به باسن، ددباگ...
//   C) شمارنده دامنه تطبیقی (Adaptive Amplitude) — حرکات چرخشی/کاردیو و فال‌بک عمومی
//   D) تایمر نشست (Hold Timer) — پلانک، وال‌سیت و کشش‌ها با کنترل تراز بدن
// ==========================================================================

(function () {
  'use strict';

  // ------------------------- اندیس لندمارک‌های MediaPipe Pose -------------------------
  const LM = {
    NOSE: 0,
    L_EYE: 2, R_EYE: 5,
    L_EAR: 7, R_EAR: 8,
    L_SHOULDER: 11, R_SHOULDER: 12,
    L_ELBOW: 13, R_ELBOW: 14,
    L_WRIST: 15, R_WRIST: 16,
    L_HIP: 23, R_HIP: 24,
    L_KNEE: 25, R_KNEE: 26,
    L_ANKLE: 27, R_ANKLE: 28,
    L_HEEL: 29, R_HEEL: 30,
    L_FOOT: 31, R_FOOT: 32
  };

  const POSE_CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28],
    [27, 31], [28, 32], [27, 29], [28, 30]
  ];

  // ------------------------- ریاضیات زاویه و کمکی‌ها -------------------------

  function angleAt(a, b, c) {
    // زاویه در رأس b بین بردارهای b→a و b→c (درجه)
    const v1x = a.x - b.x, v1y = a.y - b.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const d = (v1x * v2x + v1y * v2y) * (v1x * v2x + v1y * v2y);
    const m1 = v1x * v1x + v1y * v1y, m2 = v2x * v2x + v2y * v2y;
    if (m1 === 0 || m2 === 0) return 180;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / Math.sqrt(m1 * m2)));
    return Math.acos(cos) * (180 / Math.PI);
  }

  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function visible(lms, idxs, minVis) {
    for (const i of idxs) {
      const p = lms[i];
      if (!p || (p.visibility !== undefined && p.visibility < (minVis || 0.45))) return false;
    }
    return true;
  }

  // میانگین زاویه سمت‌های در دسترس (هر طرفی که بهتر دیده می‌شود)
  function bestAngle(lms, a, b, c, sides) {
    // sides: [[idxA_L, idxA_R],[idxB_L, idxB_R],[idxC_L, idxC_R]]
    let sum = 0, n = 0;
    const trySide = (set) => {
      if (set.every(v => v >= 0) && visible(lms, set, 0.35)) {
        sum += angleAt(lms[set[0]], lms[set[1]], lms[set[2]]);
        n++;
      }
    };
    trySide([a[0], b[0], c[0]]);
    trySide([a[1], b[1], c[1]]);
    return n ? sum / n : null;
  }

  // ------------------------- موتور اصلی چشم گردول -------------------------

  const GordolEye = {
    landmarker: null,
    loading: false,
    loaded: false,
    loadError: null,

    async ensureLoaded() {
      if (this.loaded) return true;
      if (!this.loadPromise) {
        this.loadPromise = this._doLoad().catch((e) => { this.loadPromise = null; throw e; });
      }
      return this.loadPromise;
    },

    async _doLoad() {
      this.loading = true;
      this.loadError = null;
      try {
        // مسیر نسبت به document base حل می‌شود تا در زیرپوشه GitHub Pages هم کار کند
        const bundleUrl = new URL('assets/mediapipe/vision_bundle.mjs', document.baseURI).href;
        const vision = await import(bundleUrl);
        const fileset = await vision.FilesetResolver.forVisionTasks('./assets/mediapipe/wasm/');
        this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: './assets/mediapipe/pose_landmarker_lite.task', delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        this.loaded = true;
      } catch (e) {
        console.error('[GordolEye] load failed', e);
        this.loadError = (e && (e.message || e.name)) ? (e.message || e.name) : String(e);
      } finally {
        this.loading = false;
      }
      return this.loaded;
    },

    // ------------------------- نگاشت ۱۴۱ حرکت به خانواده‌ها -------------------------

    // هر ورودی: mechanism + پارامترها. s = شانه, e = آرنج, w = مچ, h = لگن, k = زانو, a = مچ پا, n = نوک پا
    resolveDetector(exId) {
      const id = (exId || '').toLowerCase();
      const R = null;
      const pushup = (opts) => Object.assign({ mech: 'angle', group: 'pushup', joint: 'elbow', downLe: 105, upGe: 155, hipCheck: true }, opts || {});
      const squat = (opts) => Object.assign({ mech: 'angle', group: 'squat', joint: 'knee', downLe: 115, upGe: 162, torsoCheck: false }, opts || {});
      const lunge = (opts) => Object.assign({ mech: 'angle', group: 'lunge', joint: 'kneeMin', downLe: 112, upGe: 158, torsoCheck: true }, opts || {});
      const crunch = (opts) => Object.assign({ mech: 'angle', group: 'crunch', joint: 'torsoHip', downGe: 138, upLe: 112 }, opts || {});
      const legraise = (opts) => Object.assign({ mech: 'angle', group: 'legraise', joint: 'hipLeg', downGe: 163, upLe: 118 }, opts || {});
      const bridge = (opts) => Object.assign({ mech: 'angle', group: 'bridge', joint: 'hipBridge', downLe: 125, upGe: 152 }, opts || {});
      const hinge = (opts) => Object.assign({ mech: 'angle', group: 'hinge', joint: 'torsoHip', downLe: 115, upGe: 152 }, opts || {});
      const drive = (landmark, opts) => Object.assign({ mech: 'limb', group: 'drive', landmark, near: 0.42, far: 0.62, alternate: true }, opts || {});
      const amp = (landmark, opts) => Object.assign({ mech: 'amp', group: 'amp', landmark, minAmp: 0.035 }, opts || {});
      const hold = (opts) => Object.assign({ mech: 'hold', group: 'plank', align: 'spine' }, opts || {});
      const stretch = () => ({ mech: 'hold', group: 'stretch', align: 'none' });

      if (id.includes('pike-push-up')) return pushup({ hipCheck: false, group: 'pikepushup' });
      if (id.includes('pike-shoulder')) return amp('shoulder', { group: 'amp', minAmp: 0.015 });
      if (id.includes('push-up') || id.includes('pushup') || id === 'sphinx-press-up') return pushup(id === 'sphinx-press-up' ? { downLe: 100, upGe: 150 } : {});
      if (id.includes('dip')) return pushup({ hipCheck: false, group: 'dip' });
      if (id.includes('pull-up')) return pushup({ hipCheck: false, group: 'pullup', downLe: 60, upGe: 150, invert: true });

      if (id.includes('wall-sit')) return hold({ group: 'wallsit', align: 'wallsit', bandLo: 85, bandHi: 115 });
      if (id.includes('squat')) {
        if (id.includes('pulse')) return squat({ downLe: 142, upGe: 165, torsoCheck: false });
        if (id.includes('wall-assisted')) return squat({ torsoCheck: false });
        return squat();
      }
      if (id.includes('lunge') || id.includes('split-squat') || id.includes('step-up') || id.includes('step-toe') || id.includes('step-down') || id.includes('box-jump') || id.includes('long-jump')) return lunge();
      if (id.includes('hip-hinge') || id.includes('good-morning') || id.includes('romanian-deadlift')) return hinge();

      if (id.includes('glute-bridge') || id.includes('hip-thrust')) return bridge();

      if (id.includes('crunch') || id.includes('sit-up') || id.includes('russian-twist') || id.includes('windshield') || id.includes('reach-and-catch')) {
        if (id.includes('russian-twist') || id.includes('windshield')) return amp('shoulder', { group: 'twist', minAmp: 0.03, axis: 'x' });
        return crunch();
      }

      if (id.includes('leg-raise') || id.includes('leg-lift') || id.includes('knee-raise') ||
          id.includes('leg-lowering') || id.includes('flutter') || id.includes('scissor')) {
        if (id.includes('flutter') || id.includes('scissor')) return amp('ankle', { group: 'amp', minAmp: 0.03 });
        return legraise();
      }
      // نگه‌داشتن زانو آویزان = تایمر نشست (بدون کنترل ستون فقرات)
      if (id.includes('knee-hold')) return hold({ group: 'plank', align: 'none' });
      if (id.includes('clamshell') || id.includes('side-lying-leg-raise')) return amp('knee', { group: 'amp', minAmp: 0.03 });

      if (id.includes('plank')) {
        if (id.includes('knee-drive') || id.includes('walkout') || id.includes('hand-jacks') || id.includes('foot-taps') || id.includes('reach-through')) return drive(LM.L_KNEE, { group: 'plankdrive' });
        if (id.includes('arm-reach')) return drive(LM.L_WRIST, { group: 'amp-limb', near: 0.35, far: 0.55, alternate: true });
        return hold({ group: 'plank', align: 'spine' });
      }
      if (id.includes('side-plank-hip-dip')) return amp('hip', { group: 'amp', minAmp: 0.03 });

      if (id.includes('mountain-climber')) return drive(LM.L_KNEE, { group: 'plankdrive' });

      if (id.includes('jumping-jacks') || id.includes('seal-jacks') || id.includes('step-jacks') || id.includes('in-and-out-hops')) return amp('wrist', { group: 'jack', minAmp: 0.05, axis: 'y', overhead: true });
      if (id.includes('burpee')) return amp('shoulder', { group: 'amp', minAmp: 0.12 });
      if (id.includes('high-knee') || id.includes('march') || id.includes('quick-feet') || id.includes('running') || id.includes('knee-lift') || id.includes('standing-knee')) return drive(LM.L_KNEE, { group: 'standdrive', near: 0.30, far: 0.55 });
      if (id.includes('butt-kick') || id.includes('heel-reach')) return drive(LM.L_HEEL, { group: 'standdrive', near: 0.30, far: 0.55 });

      if (id.includes('calf-raise')) return amp('heel', { group: 'amp', minAmp: 0.015 });
      if (id.includes('shoulder-shrug')) return amp('shoulder', { group: 'amp', minAmp: 0.015 });
      if (id.includes('bird-dog') || id.includes('dead-bug')) return drive(LM.L_WRIST, { group: 'amp-limb', near: 0.35, far: 0.6, alternate: true });
      if (id.includes('superman')) return amp('wrist', { group: 'amp', minAmp: 0.03 });
      if (id.includes('row')) return amp('wrist', { group: 'amp', minAmp: 0.04 });
      if (id.includes('wall-angel')) return amp('wrist', { group: 'amp', minAmp: 0.04 });
      if (id.includes('inchworm') || id.includes('walkout')) return amp('shoulder', { group: 'amp', minAmp: 0.1 });
      if (id.includes('thoracic-rotation') || id.includes('swiss')) return amp('wrist', { group: 'amp', minAmp: 0.04 });
      if (id.includes('neck')) return amp('nose', { group: 'amp', minAmp: 0.025, axis: 'x' });

      if (id.includes('stretch') || id.includes('pose') || id.includes('reach') || id.includes('bend') || id.includes('fold') ||
          id.includes('twist') === false && (id.includes('roll-down'))) return stretch();
      if (id.includes('superman')) return hold({ align: 'none' });
      if (id.includes('angel') || id.includes('wall')) return stretch();

      // فال‌بک عمومی: شمارنده دامنه روی مرکز شانه‌ها
      return amp('shoulder', { group: 'amp' });
    },

    // ------------------------- ساخت جلسه ردیابی (Session) -------------------------

    createSession(detector, onEvent) {
      const S = {
        detector,
        state: 'up',
        reps: 0,
        holdMs: 0,
        startedAt: performance.now(),
        lastFrameAt: 0,
        smoothed: {},            // EMA مقادیر متریک
        amp: { min: null, max: null, dir: 0 }, // دامنه تطبیقی
        limb: [false, false],    // وضعیت چرخه هر اندام (چپ/راست)
        warnings: {},
        lastWarningAt: 0,
        activeWarning: null,
        formOk: true,
        angles: {},
        lastDepthCueAt: 0,
        emit: onEvent || function () {}
      };
      return S;
    },

    // پردازش یک فریم — خروجی: وضعیت کامل برای UI
    step(session, lms, facingUser) {
      const d = session.detector;
      const now = performance.now();
      const dt = session.lastFrameAt ? Math.min(200, now - session.lastFrameAt) : 33; // سقف dt برای جلوگیری از جهش پس از بک‌گراند شدن تب
      session.lastFrameAt = now;

      const out = {
        reps: session.reps,
        holdSec: Math.floor(session.holdMs / 1000),
        phase: session.state,
        angles: session.angles,
        warning: session.activeWarning,
        formOk: session.formOk,
        personVisible: false,
        done: false
      };

      if (!lms || !visible(lms, [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER], 0.3)) {
        session.activeWarning = 'کل بدنت توی کادر باشه تا چشم گردول بتونه حرکت رو ببینه 👀';
        session.formOk = false;
        out.warning = session.activeWarning;
        return out;
      }
      out.personVisible = true;

      const mirror = facingUser ? -1 : 1;
      const get = (i) => lms[i];
      const cx = (i) => mirror * lms[i].x; // مختصات برای متریک‌های افقی

      const ema = (key, val, alpha) => {
        const a = alpha || 0.35;
        session.smoothed[key] = session.smoothed[key] === undefined ? val : (a * val + (1 - a) * session.smoothed[key]);
        return session.smoothed[key];
      };

      const warn = (key, msg) => {
        if (!session.warnings[key] || now - session.warnings[key] > 2500) {
          session.warnings[key] = now;
          session.activeWarning = msg;
          session.lastWarningAt = now;
        }
      };

      const clearWarn = (key) => { delete session.warnings[key]; };

      let counted = false;

      // ---------------- مکانیزم A: ماشین حالت زاویه‌ای ----------------
      if (d.mech === 'angle') {
        let val = null;
        const key = d.joint;

        if (key === 'elbow') val = bestAngle(lms, [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_ELBOW, LM.R_ELBOW], [LM.L_WRIST, LM.R_WRIST]);
        else if (key === 'knee' || key === 'kneeMin') {
          const l = visible(lms, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], 0.35) ? angleAt(lms[LM.L_HIP], lms[LM.L_KNEE], lms[LM.L_ANKLE]) : null;
          const r = visible(lms, [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE], 0.35) ? angleAt(lms[LM.R_HIP], lms[LM.R_KNEE], lms[LM.R_ANKLE]) : null;
          val = key === 'kneeMin'
            ? (l !== null && r !== null ? Math.min(l, r) : (l !== null ? l : r))
            : (l !== null && r !== null ? (l + r) / 2 : (l !== null ? l : r));
        }
        else if (key === 'torsoHip') val = bestAngle(lms, [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP], [LM.L_KNEE, LM.R_KNEE]);
        else if (key === 'hipLeg') val = bestAngle(lms, [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP], [LM.L_ANKLE, LM.R_ANKLE]);
        else if (key === 'hipBridge') val = bestAngle(lms, [LM.L_SHOULDER, LM.R_SHOULDER], [LM.L_HIP, LM.R_HIP], [LM.L_KNEE, LM.R_KNEE]);

        if (val === null) {
          session.activeWarning = 'اندام‌های حرکت کاملاً در کادر دیده نمی‌شن';
          out.warning = session.activeWarning;
          return out;
        }

        val = ema(key, val, 0.4);
        session.angles[key] = Math.round(val);
        session.formOk = true;
        clearWarn(key + '-vis');

        // کنترل فرم اختصاصی
        if (d.hipCheck && (d.group === 'pushup' || d.group === 'plank')) {
          const sh = mid(lms[LM.L_SHOULDER], lms[LM.R_SHOULDER]);
          const hp = mid(lms[LM.L_HIP], lms[LM.R_HIP]);
          const kn = mid(lms[LM.L_KNEE], lms[LM.R_KNEE]);
          const spineAngle = angleAt(sh, hp, kn);
          const shoulderY = sh.y, hipY = hp.y;
          if (spineAngle < 158 && hipY > Math.min(shoulderY, kn.y) + 0.02) {
            session.formOk = false;
            warn('sag', 'کمرت افتاده! شکم و لگن رو منقبض کن 🚨');
          } else if (spineAngle < 158) {
            session.formOk = false;
            warn('pike', 'باسنت بالاست! بدنت رو همسطح خط صاف کن');
          } else {
            clearWarn('sag'); clearWarn('pike');
          }
        }
        if (d.torsoCheck && (d.group === 'squat' || d.group === 'lunge')) {
          const torso = angleAt(lms[LM.L_SHOULDER], lms[LM.L_HIP], lms[LM.L_KNEE]);
          const torsoR = angleAt(lms[LM.R_SHOULDER], lms[LM.R_HIP], lms[LM.R_KNEE]);
          const t = Math.min(torso, torsoR);
          if (t < 118) {
            session.formOk = false;
            warn('torso', 'تنه رو صاف‌تر نگه دار، به جلو خم نشو ⚠️');
          } else clearWarn('torso');
        }

        // ماشین حالت
        const invert = !!d.invert;
        const downVal = d.downLe !== undefined ? d.downLe : null;   // ورود به فاز پایین
        const upVal = d.upGe !== undefined ? d.upGe : null;          // بازگشت به بالا
        const upLe = d.upLe !== undefined ? d.upLe : null;           // حرکاتی که «بالا» زاویه کمتر است (کرانچ/بلندکردن پا)
        const downGe = d.downGe !== undefined ? d.downGe : null;

        let goDown = false, goUp = false;
        if (downVal !== null && upVal !== null) { goDown = val <= downVal; goUp = val >= upVal; }
        else if (upLe !== null && downGe !== null) { goDown = val >= downGe; goUp = val <= upLe; }

        if (session.state === 'up' && goDown) {
          session.state = 'down';
          if (d.group === 'squat' || d.group === 'lunge') session.activeWarning = 'عمق خوبه! حالا با قدرت بالا بیا 💪';
          if (d.group === 'bridge' || d.group === 'legraise' || d.group === 'crunch') session.activeWarning = null;
        } else if (session.state === 'down' && goUp) {
          session.state = 'up';
          session.reps++;
          counted = true;
          session.activeWarning = null;
        } else if (session.state === 'up' && !goDown) {
          // راهنمای عمق — هر ۳ ثانیه یک بار
          if (now - session.lastDepthCueAt > 3000 && now - session.startedAt > 2500) {
            session.lastDepthCueAt = now;
            if (downVal !== null && val > downVal + 18) session.activeWarning = 'بیشتر پایین برو تا چشم گردول تکرار کامل رو بشماره 👁️';
            else if (downGe !== null && val < downGe - 18) session.activeWarning = 'بیشتر باز شو تا چشم گردول دامنه کامل رو ببینه 👁️';
          }
        }
      }

      // ---------------- مکانیزم B: شمارنده چرخه اندام ----------------
      else if (d.mech === 'limb') {
        const li = d.landmark;
        const pairs = [[li, LM.L_HIP], [li + 1, LM.R_HIP]];
        let anyDrive = false;
        pairs.forEach((pr, i) => {
          const [end, root] = pr;
          if (!visible(lms, [end, root], 0.3)) return;
          const ratio = Math.abs(lms[end].y - lms[root].y) / Math.max(0.08, Math.abs(mid(lms[LM.L_SHOULDER], lms[LM.R_SHOULDER]).y - lms[root].y));
          const near = d.near, far = d.far;
          if (ratio < near && !session.limb[i]) {
            session.limb[i] = true; // اندام رانده شد
            anyDrive = true;
          } else if (ratio > far && session.limb[i]) {
            session.limb[i] = false;
            if (d.alternate) {
              const other = 1 - i;
              if (session.limb[other]) { /* یکی دیگه هنوز برنگشته — قبول نکن */ }
              else {
                session.reps++;
                counted = true;
                anyDrive = false;
              }
            } else {
              session.reps++;
              counted = true;
            }
          }
        });
        session.formOk = true;
        if (d.group === 'plankdrive') {
          const sh = mid(lms[LM.L_SHOULDER], lms[LM.R_SHOULDER]);
          const hp = mid(lms[LM.L_HIP], lms[LM.R_HIP]);
          const spine = angleAt(sh, hp, mid(lms[LM.L_KNEE], lms[LM.R_KNEE]));
          if (spine < 158) {
            session.formOk = false;
            warn('sag', 'پلانت باز شده! لگن همسطح شونه باشه 🚨');
          } else clearWarn('sag');
        }
      }

      // ---------------- مکانیزم C: دامنه تطبیقی عمومی ----------------
      else if (d.mech === 'amp') {
        const axis = d.axis || 'y';
        let sig = null;
        if (d.landmark === 'shoulder') sig = mid(lms[LM.L_SHOULDER], lms[LM.R_SHOULDER])[axis];
        else if (d.landmark === 'wrist') sig = Math.min(lms[LM.L_WRIST][axis], lms[LM.R_WRIST][axis]);
        else if (d.landmark === 'hip') sig = mid(lms[LM.L_HIP], lms[LM.R_HIP])[axis];
        else if (d.landmark === 'ankle') sig = Math.min(lms[LM.L_ANKLE][axis], lms[LM.R_ANKLE][axis]);
        else if (d.landmark === 'knee') sig = Math.min(lms[LM.L_KNEE][axis], lms[LM.R_KNEE][axis]);
        else if (d.landmark === 'heel') sig = Math.min(lms[LM.L_HEEL][axis], lms[LM.R_HEEL][axis]);
        else if (d.landmark === 'nose') sig = cx(LM.NOSE);

        if (sig === null) {
          session.activeWarning = 'اندام حرکت دیده نمی‌شه';
          out.warning = session.activeWarning;
          return out;
        }

        const s = ema('amp', sig, 0.45);

        // کالیبراسیون غلتکی ۵ ثانیه‌ای
        if (session.amp.min === null) { session.amp.min = s; session.amp.max = s; }
        session.amp.min = Math.min(session.amp.min, s);
        session.amp.max = Math.max(session.amp.max, s);
        if (now - session.startedAt > 5000) {
          // انقباض بازه به سمت مقدار جاری تا دنبال حرکت کند
          const span = session.amp.max - session.amp.min;
          const decay = Math.max(0, span) * 0.004;
          session.amp.min += decay; session.amp.max -= decay;
        }
        const span = session.amp.max - session.amp.min;
        if (span > (d.minAmp || 0.035)) {
          const lo = session.amp.min + span * 0.33;
          const hi = session.amp.min + span * 0.67;
          if (s < lo && session.state === 'up') { session.state = 'down'; }
          else if (s > hi && session.state === 'down') {
            session.state = 'up';
            session.reps++;
            counted = true;
            session.activeWarning = null;
          } else if (s > hi && session.state === 'up') {
            // اگر دامنه خیلی کوچک بود راهنما بده
            if (now - session.lastDepthCueAt > 3500) {
              session.lastDepthCueAt = now;
              session.activeWarning = 'دامنه حرکت رو بیشتر کن تا شمرده بشه 👁️';
            }
          }
        }
        session.formOk = true;
      }

      // ---------------- مکانیزم D: تایمر نشست ----------------
      else if (d.mech === 'hold') {
        let inPosition = true;
        if (d.group === 'wallsit') {
          const knee = bestAngle(lms, [LM.L_HIP, LM.R_HIP], [LM.L_KNEE, LM.R_KNEE], [LM.L_ANKLE, LM.R_ANKLE]);
          if (knee !== null) {
            session.angles.knee = Math.round(knee);
            if (knee > d.bandHi) { inPosition = false; session.formOk = false; warn('deep', 'پایین‌تر برو! زانو ۹۰ درجه باشه'); }
            else if (knee < d.bandLo) { inPosition = false; session.formOk = false; warn('shallow', 'کمی بالا بیا، زانو ۹۰ درجه'); }
            else { clearWarn('deep'); clearWarn('shallow'); session.formOk = true; }
          }
        } else if (d.align === 'spine') {
          const sh = mid(lms[LM.L_SHOULDER], lms[LM.R_SHOULDER]);
          const hp = mid(lms[LM.L_HIP], lms[LM.R_HIP]);
          const kn = mid(lms[LM.L_KNEE], lms[LM.R_KNEE]);
          const spine = angleAt(sh, hp, kn);
          session.angles.spine = Math.round(spine);
          if (spine < 158 && hp.y > Math.min(sh.y, kn.y) + 0.02) {
            inPosition = false;
            session.formOk = false;
            warn('sag', 'کمرت افتاده! بدن خط صاف باشه 🚨');
          } else if (spine < 158) {
            inPosition = false;
            session.formOk = false;
            warn('pike', 'باسنت بالاست! خط بدن رو صاف کن');
          } else { clearWarn('sag'); clearWarn('pike'); session.formOk = true; }
        }
        if (inPosition) {
          session.holdMs += dt;
          session.formOk = true;
          session.activeWarning = null;
        }
      }

      if (counted) {
        out.justCounted = true;
        session.activeWarning = d.group === 'amp' || d.group === 'drive' ? null : 'آفرین! تکرار ثبت شد ✅';
      }
      out.reps = session.reps;
      out.holdSec = Math.floor(session.holdMs / 1000);
      out.phase = session.state;
      out.warning = session.activeWarning;
      out.formOk = session.formOk;
      return out;
    }
  };

  window.GordolEye = GordolEye;
  window.GORDOL_POSE_CONNECTIONS = POSE_CONNECTIONS;
  window.GORDOL_POSE_LM = LM;
})();

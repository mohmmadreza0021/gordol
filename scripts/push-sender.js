// ==========================================================================
// فرستنده یادآورهای گردول — اجرا در GitHub Actions (هر ۱۵ دقیقه)
// اصول امنیتی:
//  - فقط شناسه بی‌نام subscription + پرچم‌های بله/خیر خوانده می‌شود
//  - هیچ داده شخصی (وزن، غذا، نام) در دیتابیس وجود ندارد و این اسکریپت هم
//    چیزی جز نوتیف به خود کاربر ارسال نمی‌کند
//  - کلیدهای VAPID و سرویس‌اکانت فایربیس فقط از GitHub Secrets می‌آیند
// محیط لازم: FIREBASE_DB_URL, FIREBASE_SERVICE_ACCOUNT (JSON کامل), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// اجرا: node scripts/push-sender.js  (پکیج‌های firebase-admin و web-push نصب شده‌اند)
// ==========================================================================

'use strict';

const webpush = require('web-push');
const admin = require('firebase-admin');

const DB_URL = process.env.FIREBASE_DB_URL;
if (!DB_URL || !process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.error('Missing env secrets'); process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
// سازگار با firebase-admin v13 (admin.credential.cert) و v14+ (admin.cert)
const makeCred = () => (admin.credential && admin.credential.cert)
  ? admin.credential.cert(serviceAccount)
  : admin.cert(serviceAccount);
admin.initializeApp({ credential: makeCred(), databaseURL: DB_URL });
const db = admin.database();

webpush.setVapidDetails('mailto:gordol-reminders@users.noreply.github.com',
  process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

// زمان تهران (بدون DST از ۲۰۲۲؛ همیشه UTC+3:30)
function tehranNow() {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

const MEAL_TEXTS = {
  workout: ['🏋️ وقت تمرین امروز گردول است!', 'چند دقیقه بیشتر وقت نمی‌برد — همین حالا شروع کن 💪'],
  water: ['💧 وقت نوشیدن آب است!', 'یک لیوان آب بنوش تا به هدف آب امروزت برسی.'],
  breakfast: ['🍳 وقت صبحانه مقوی', 'پروتئین خالص برای شروع روز — وعده‌ات را در اپ ثبت کن.'],
  snack1: ['🍏 میان‌وعده صبح و مهار قند', 'میان‌وعده امروزت را میل کن و ثبتش کن.'],
  lunch: ['🥗 وقت ناهار', 'ناهار امروزت را میل کن و در اپ گردول ثبتش کن.'],
  snack2: ['🥜 سوخت قبل تمرین', 'میان‌وعده عصرانه را میل کن تا انرژی جلسه تمرین داشته باشی.'],
  dinner: ['🥗 شام رو ثبت کردی؟', 'شام را میل کن و در اپ ثبتش کن.'],
  streak: ['🔥 استریک‌ات در خطره!', 'زنجیره روزهای پشت‌سرهم تو را نبند — امروز را کامل کن!'],
  sleep: ['🌙 خواب و ثبت استریک', 'خواب ۷ تا ۸ ساعته کلید چربی‌سوزی پایدار است. شب‌خوش!']
};

(async () => {
  const { date, hm } = tehranNow();
  const nowMin = toMin(hm);
  const sentRef = db.ref('pushSent');

  // پنجره سررسید ۷۵ دقیقه‌ای — کرون رایگان گیت‌هاب گاهی چند ساعت تأخیر/حذف دارد؛
  // نشانگر pushSent از ارسال تکراری جلوگیری می‌کند، پس پنجره باز بی‌ضرر است
  const DUE_WINDOW = 75;

  const usersSnap = await db.ref('pushUsers').once('value');
  const users = usersSnap.val() || {};
  const ids = Object.keys(users);
  if (!ids.length) { console.log('no subscribers'); process.exit(0); }
  console.log(`subscribers: ${ids.length}, tehran ${date} ${hm}`);

  const sentSnap = await sentRef.child(date).once('value');
  const sentToday = sentSnap.val() || {};

  let sent = 0, skipped = 0, dead = 0;
  for (const id of ids) {
    const rec = users[id];
    if (!rec || !rec.sub || !rec.sub.endpoint) continue;
    const s = rec.sched || {};
    const st = (rec.state && rec.state.date === date) ? rec.state : {};
    const mySent = sentToday[id] || {};

    // اسلات‌های اختصاصی کاربر
    const slots = [
      ['workout', s.workout || '18:00'],
      ...((s.water || ['10:00', '13:00', '16:00', '19:00']).map(w => ['water-' + w, w])),
      ['breakfast', s.breakfast || '08:00'], ['snack1', s.snack1 || '11:00'],
      ['lunch', s.lunch || '14:00'], ['snack2', s.snack2 || '17:30'],
      ['dinner', s.dinner || '21:00'], ['streak', s.streak || '20:00'], ['sleep', s.sleep || '23:00']
    ];

    for (const [key, time] of slots) {
      if (mySent[key]) { skipped++; continue; }
      const d = nowMin - toMin(time);
      if (d < 0 || d > DUE_WINDOW) continue;

      // سرکوب هوشمند با پرچم‌های بی‌نام (فقط اگر state امروز باشد)
      if (key === 'workout' && st.workoutDone) { skipped++; continue; }
      if (key.startsWith('water') && typeof st.waterMl === 'number' && typeof st.waterGoal === 'number' && st.waterMl >= st.waterGoal) { skipped++; continue; }
      if (['breakfast', 'snack1', 'lunch', 'snack2', 'dinner'].includes(key) && Array.isArray(st.meals) && st.meals.includes(key)) { skipped++; continue; }
      if (key === 'streak' && st.dayCompleted) { skipped++; continue; }

      const txt = key.startsWith('water') ? MEAL_TEXTS.water : (MEAL_TEXTS[key] || ['🔔 گردول', 'یادآور امروز']);
      try {
        await webpush.sendNotification(rec.sub, JSON.stringify({
          title: txt[0], body: txt[1], tag: 'gordol-' + key + '-' + date
        }), { TTL: 3600 });
        await sentRef.child(`${date}/${id}/${key}`).set(true);
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.ref(`pushUsers/${id}`).remove(); // subscription مرده
          dead++;
        } else {
          console.warn(`send fail ${id}/${key}: ${e.statusCode || ''} ${e.message}`);
        }
      }
      break; // حداکثر یک نوتیف در هر اجرا برای هر کاربر
    }
  }

  // پاک‌سازی نشانگرهای ارسال قدیمی (نگه‌داری ۲ روز)
  const allSent = await sentRef.once('value');
  for (const d of Object.keys(allSent.val() || {})) {
    if (d < tehranNow().date) await sentRef.child(d).remove();
  }
  console.log(`done: sent=${sent} skipped=${skipped} dead=${dead}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

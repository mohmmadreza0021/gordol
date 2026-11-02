// برنامه قدرتی ۵ روزه اورجینال گردول پلاس (ست × دامنه تکرار × استراحت) + تقویم هفتگی
window.GORDOL_STRENGTH = {
  "totalWeeks": 24,
  "sessionsPerWeek": 5,
  "restDays": [
    4,
    5
  ],
  "restTitles": {
    "4": "استراحت فعال (پیاده‌روی و کشش سبک)",
    "5": "استراحت کامل و ریکاوری هفتگی"
  },
  "calendarMap": {
    "0": 2,
    "1": 3,
    "2": 4,
    "3": 5,
    "4": 5,
    "5": 1,
    "6": 1
  },
  "days": [
    {
      "day": 1,
      "title": "روز ۱: بالا‌تنه و سینه (Push Focus)",
      "duration": "۴۵ دقیقه",
      "badge": "سینه، سرشانه و پشت بازو",
      "warmup": [
        {
          "id": "shoulder-rolls",
          "sets": "۲ ست",
          "reps": "۱۰ تکرار",
          "restSec": 30
        },
        {
          "id": "forward-arm-circles",
          "sets": "۲ ست",
          "reps": "۱۰ تکرار",
          "restSec": 30
        }
      ],
      "main": [
        {
          "id": "knee-push-up",
          "setsCount": 3,
          "reps": "۸ تا ۱۲ تکرار",
          "restSec": 60
        },
        {
          "id": "incline-push-up",
          "setsCount": 3,
          "reps": "۱۰ تا ۱۲ تکرار",
          "restSec": 60
        },
        {
          "id": "box-dip-knees-bent",
          "setsCount": 3,
          "reps": "۸ تا ۱۰ تکرار",
          "restSec": 60
        },
        {
          "id": "forearm-plank",
          "setsCount": 3,
          "reps": "۳۰ ثانیه مکث",
          "restSec": 45
        }
      ],
      "cooldown": [
        {
          "id": "pole-lat-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه",
          "restSec": 20
        },
        {
          "id": "backward-arm-circles",
          "sets": "۲ ست",
          "reps": "۱۰ تکرار",
          "restSec": 20
        }
      ]
    },
    {
      "day": 2,
      "title": "روز ۲: پایین‌تنه و پا (کم‌فشار به زانو)",
      "duration": "۴۵ دقیقه",
      "badge": "چهارسر، باسن و همسترینگ",
      "warmup": [
        {
          "id": "walk-in-place",
          "sets": "۱ ست",
          "reps": "۶۰ ثانیه",
          "restSec": 30
        },
        {
          "id": "heel-slide",
          "sets": "۲ ست",
          "reps": "۱۰ تکرار هر پا",
          "restSec": 30
        }
      ],
      "main": [
        {
          "id": "wall-assisted-squat",
          "setsCount": 3,
          "reps": "۱۲ تکرار",
          "restSec": 60
        },
        {
          "id": "glute-bridge",
          "setsCount": 3,
          "reps": "۱۵ تکرار",
          "restSec": 45
        },
        {
          "id": "alternating-reverse-lunge",
          "setsCount": 3,
          "reps": "۱۰ تکرار هر پا",
          "restSec": 60
        },
        {
          "id": "side-plank-hold",
          "setsCount": 3,
          "reps": "۲۰ ثانیه هر طرف",
          "restSec": 45
        }
      ],
      "cooldown": [
        {
          "id": "standing-quad-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه هر پا",
          "restSec": 20
        },
        {
          "id": "pole-lat-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه",
          "restSec": 20
        }
      ]
    },
    {
      "day": 3,
      "title": "روز ۳: پشت، فیله و اصلاح پاسچر (Pull & Posture)",
      "duration": "۴۰ دقیقه",
      "badge": "پشت، فیله کمر و کتف",
      "warmup": [
        {
          "id": "shoulder-rolls",
          "sets": "۲ ست",
          "reps": "۱۵ تکرار",
          "restSec": 30
        },
        {
          "id": "forward-arm-circles",
          "sets": "۲ ست",
          "reps": "۱۰ تکرار",
          "restSec": 30
        }
      ],
      "main": [
        {
          "id": "superman",
          "setsCount": 3,
          "reps": "۱۲ تکرار",
          "restSec": 45
        },
        {
          "id": "inchworm",
          "setsCount": 3,
          "reps": "۶ تا ۸ تکرار",
          "restSec": 60
        },
        {
          "id": "superman-pull",
          "setsCount": 3,
          "reps": "۱۰ تکرار",
          "restSec": 45
        },
        {
          "id": "incline-push-up",
          "setsCount": 3,
          "reps": "۱۰ تکرار",
          "restSec": 60
        }
      ],
      "cooldown": [
        {
          "id": "pole-lat-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه",
          "restSec": 20
        },
        {
          "id": "heel-slide",
          "sets": "۱ ست",
          "reps": "۶۰ ثانیه",
          "restSec": 20
        }
      ]
    },
    {
      "day": 4,
      "title": "روز ۴: میان‌تنه و شکم بدون فشار به گردن",
      "duration": "۴۰ دقیقه",
      "badge": "شکم، عضلات مورب و عمقی",
      "warmup": [
        {
          "id": "walk-in-place",
          "sets": "۱ ست",
          "reps": "۶۰ ثانیه",
          "restSec": 30
        },
        {
          "id": "backward-arm-circles",
          "sets": "۲ ست",
          "reps": "۱۰ تکرار",
          "restSec": 30
        }
      ],
      "main": [
        {
          "id": "forearm-plank",
          "setsCount": 4,
          "reps": "۳۰ تا ۳۵ ثانیه",
          "restSec": 45
        },
        {
          "id": "heels-elevated-glute-bridge",
          "setsCount": 3,
          "reps": "۱۲ تکرار",
          "restSec": 45
        },
        {
          "id": "side-plank-hip-dip",
          "setsCount": 3,
          "reps": "۱۰ تکرار هر طرف",
          "restSec": 45
        },
        {
          "id": "plank-arm-reach",
          "setsCount": 3,
          "reps": "۸ تکرار هر دست",
          "restSec": 45
        }
      ],
      "cooldown": [
        {
          "id": "standing-quad-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه",
          "restSec": 20
        },
        {
          "id": "pole-lat-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه",
          "restSec": 20
        }
      ]
    },
    {
      "day": 5,
      "title": "روز ۵: فول بادی متابولیک کم‌برخورد",
      "duration": "۵۰ دقیقه",
      "badge": "کل بدن و استقامت عضلانی",
      "warmup": [
        {
          "id": "walk-in-place",
          "sets": "۱ ست",
          "reps": "۶۰ ثانیه",
          "restSec": 30
        },
        {
          "id": "shoulder-rolls",
          "sets": "۲ ست",
          "reps": "۱۰ تکرار",
          "restSec": 30
        }
      ],
      "main": [
        {
          "id": "pulse-squat",
          "setsCount": 3,
          "reps": "۱۲ تکرار",
          "restSec": 60
        },
        {
          "id": "knee-push-up-close-hands",
          "setsCount": 3,
          "reps": "۸ تا ۱۰ تکرار",
          "restSec": 60
        },
        {
          "id": "slalom-mountain-climber",
          "setsCount": 3,
          "reps": "۲۰ تکرار",
          "restSec": 45
        },
        {
          "id": "push-up",
          "setsCount": 2,
          "reps": "تا ناتوانی (۵-۷ تکرار)",
          "restSec": 90
        }
      ],
      "cooldown": [
        {
          "id": "standing-quad-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه هر طرف",
          "restSec": 20
        },
        {
          "id": "pole-lat-stretch",
          "sets": "۲ ست",
          "reps": "۳۰ ثانیه",
          "restSec": 20
        }
      ]
    }
  ]
};

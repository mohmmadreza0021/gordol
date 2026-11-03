// ==========================================================================
// کتابخانه عکس غذا — تطبیق هوشمند نام غذای فارسی به عکس لوکال
// هیچ درخواست خارجی؛ همه عکس‌ها روی همان دامنه میزبانی می‌شوند
// ==========================================================================

(function () {
  'use strict';

  const LIB = {
    kebab: 'assets/food/lib-kebab.jpg',
    rice: 'assets/food/lib-rice.jpg',
    stew: 'assets/food/lib-stew.jpg',
    fish: 'assets/food/lib-fish.jpg',
    pasta: 'assets/food/lib-pasta.jpg',
    pizza: 'assets/food/lib-pizza.jpg',
    burger: 'assets/food/lib-burger.jpg',
    chicken: 'assets/food/lib-chicken.jpg',
    salad: 'assets/food/1512621776951-a57141f2eefd.jpg',
    soup: 'assets/food/1547592166-23ac45744acd.jpg',
    eggs: 'assets/food/1525351484163-7529414344d8.jpg',
    fruit: 'assets/food/lib-fruit.jpg',
    yogurt: 'assets/food/1488477181946-6428a0291777.jpg',
    nuts: 'assets/food/1599599810769-bcde5a160d32.jpg',
    dessert: 'assets/food/lib-dessert.jpg',
    toast: 'assets/food/snack2-toast.jpg',
    shake: 'assets/food/1553530666-ba11a7da3888.jpg',
    apple: 'assets/food/1568702846914-96b305d2aaeb.jpg'
  };

  // قوانین تطبیق — ترتیب مهم است (اختصاصی‌ترین اول)
  const RULES = [
    [/پیتزا/, 'pizza'],
    [/برگر|همبرگر|ساندویچ|هات.?داگ|چیزبرگر/, 'burger'],
    [/پاستا|ماکارونی|لازانیا|اسپاگتی/, 'pasta'],
    [/کباب|جوجه|شیشلیک|چنجه|باقلاپلو با گوشت/, 'kebab'],
    [/ماهی|میگو|سالمون|تن ماهی|قزل.?آلا|میگو/, 'fish'],
    [/برنج|پلو|چلو|کته|ته.?چین|زعفرانی/, 'rice'],
    [/خورشت|قورمه|قرمه|قیمه|فسنجان|خوراک|دیز|کال جوش|آبگوشت/, 'stew'],
    [/سوپ|آش |عدسی|حلیم|آش.?رشته/, 'soup'],
    [/سالاد|کاهو|شیرازی|سزار|فصل/, 'salad'],
    [/املت|نیمرو|تخم.?مرغ|کوکو/, 'eggs'],
    [/ماست|پنیر|شیر |لبنیات|دوغ|کشک|یونانی|ایسلندی/, 'yogurt'],
    [/خرما|گردو|بادام|پسته|آجیل|توت|عسل/, 'nuts'],
    [/شیرینی|کیک|دسر|بستنی|شکلات|هل/, 'dessert'],
    [/نان|سنگک|توست|تُست|کروسان|بربری|تافتون/, 'toast'],
    [/شیک|پروتئین|وی|کم.?کرب/, 'shake'],
    [/سیب(?!ه)|پرتقال|هندوانه|طالبی|انگور|کیوی|موز|پونه/, 'apple'],
    [/مرغ|فیله|گوساله|گوشت|بوقلمون|استیک/, 'chicken'],
    [/میوه|سبزی|بروکلی/, 'fruit']
  ];

  window.GordolFoodPhotos = {
    lib: LIB,
    default: LIB.soup,

    // تطبیق نام غذای فارسی به نزدیک‌ترین عکس کتابخانه
    for(name) {
      const t = String(name || '');
      if (!t) return this.default;
      for (const [re, key] of RULES) {
        if (re.test(t)) return LIB[key] || this.default;
      }
      return this.default;
    }
  };
})();

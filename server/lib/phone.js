const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC = '٠١٢٣٤٥٦٧٨٩';

/** تبدیل ارقام فارسی و عربی به لاتین */
export function normalizeDigits(input) {
  return String(input ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN.indexOf(ch);
    return String(p >= 0 ? p : ARABIC.indexOf(ch));
  });
}

/** شمارهٔ موبایل ایران را به قالب 09xxxxxxxxx برمی‌گرداند؛ نامعتبر = null */
export function normalizePhone(input) {
  let s = normalizeDigits(input).replace(/[\s\-().]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  else if (s.startsWith('0098')) s = '0' + s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = '0' + s.slice(2);
  else if (/^9\d{9}$/.test(s)) s = '0' + s;
  return /^09\d{9}$/.test(s) ? s : null;
}

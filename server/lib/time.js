// همهٔ نوبت‌ها به‌صورت «تاریخ میلادی ISO + دقیقه از نیمه‌شب» و به وقت محلی کسب‌وکار ذخیره می‌شوند.
// ایران ساعت تابستانی ندارد، پس تفاضل دقیقه‌ها همیشه درست است.

export const pad = (n) => String(n).padStart(2, '0');

export function minToHHMM(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function hhmmToMin(str) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(str ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isISODate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** شنبه = ۰ ... جمعه = ۶ */
export function weekdayOf(iso) {
  const js = new Date(`${iso}T00:00:00Z`).getUTCDay(); // یکشنبه = ۰
  return (js + 1) % 7;
}

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** تاریخ و دقیقهٔ فعلی به وقت محلی کسب‌وکار */
export function localNow(instant, tz) {
  const parts = Object.fromEntries(formatterFor(tz).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** دقیقه‌های سپری‌شده از مبدأ دلخواه؛ فقط برای مقایسه و تفاضل */
export function epochMinutes(iso, minutes) {
  return Date.parse(`${iso}T00:00:00Z`) / 60000 + minutes;
}

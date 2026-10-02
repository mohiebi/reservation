import { toJalaali, toGregorian, jalaaliMonthLength, isValidJalaaliDate } from 'jalaali-js';
import { toISO, weekdayOf, isISODate } from './time.js';

export const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export const WEEKDAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const faDigits = (value) => String(value).replace(/\d/g, (d) => FA_DIGITS[d]);

export function isoToJalali(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return toJalaali(y, m, d);
}

export function jalaliToIso(jy, jm, jd) {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return toISO(gy, gm, gd);
}

/** مثلاً «۹ مهر ۱۴۰۵» */
export function formatJalali(iso) {
  const { jy, jm, jd } = isoToJalali(iso);
  return faDigits(`${jd} ${MONTH_NAMES[jm - 1]} ${jy}`);
}

/** مثلاً «۱۴۰۵/۰۷/۰۹» */
export function formatJalaliNumeric(iso) {
  const { jy, jm, jd } = isoToJalali(iso);
  return faDigits(`${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`);
}

export const weekdayName = (iso) => WEEKDAY_NAMES[weekdayOf(iso)];

/** ساختار یک ماه شمسی برای رسم تقویم */
export function monthGrid(jy, jm) {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !isValidJalaaliDate(jy, jm, 1)) return null;
  const length = jalaaliMonthLength(jy, jm);
  const days = [];
  for (let jd = 1; jd <= length; jd++) {
    const date = jalaliToIso(jy, jm, jd);
    days.push({ date, jd, weekday: weekdayOf(date) });
  }
  const prev = jm === 1 ? { jy: jy - 1, jm: 12 } : { jy, jm: jm - 1 };
  const next = jm === 12 ? { jy: jy + 1, jm: 1 } : { jy, jm: jm + 1 };
  return { jy, jm, monthName: MONTH_NAMES[jm - 1], firstWeekday: days[0].weekday, days, prev, next };
}

export function describeDate(iso) {
  if (!isISODate(iso)) return { dateLabel: '', weekdayLabel: '' };
  return { dateLabel: formatJalali(iso), weekdayLabel: weekdayName(iso) };
}

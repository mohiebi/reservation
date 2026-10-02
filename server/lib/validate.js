import { badRequest } from './errors.js';
import { normalizeDigits, normalizePhone } from './phone.js';
import { hhmmToMin, isISODate } from './time.js';

export function text(value, label, { min = 0, max = 200, required = false } = {}) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if ((required || min > 0) && s.length === 0) throw badRequest(`${label} را وارد کنید.`);
  if (s.length < min) throw badRequest(`${label} باید حداقل ${min} حرف باشد.`);
  if (s.length > max) throw badRequest(`${label} حداکثر ${max} حرف می‌تواند باشد.`);
  return s;
}

/** مثل text ولی خط جدید را حفظ می‌کند (برای توضیحات و یادداشت) */
export function multiline(value, label, { max = 1000 } = {}) {
  const s = String(value ?? '').replace(/\r\n/g, '\n').trim();
  if (s.length > max) throw badRequest(`${label} حداکثر ${max} حرف می‌تواند باشد.`);
  return s;
}

export function int(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const n = Number(normalizeDigits(value));
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label} معتبر نیست.`);
  return n;
}

export function date(value, label = 'تاریخ') {
  if (!isISODate(value)) throw badRequest(`${label} معتبر نیست.`);
  return value;
}

export function time(value, label = 'ساعت') {
  const m = hhmmToMin(value);
  if (m === null) throw badRequest(`${label} معتبر نیست.`);
  return m;
}

export function phone(value) {
  const p = normalizePhone(value);
  if (!p) throw badRequest('شمارهٔ موبایل معتبر نیست (مثال: 09123456789).');
  return p;
}

export function bool(value) {
  return value === true || value === 1 || value === 'true' || value === '1';
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw badRequest(`${label} معتبر نیست.`);
  return value;
}

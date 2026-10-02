// ابزارهای مشترک صفحهٔ رزرو و پنل مدیریت. هیچ داده‌ای با innerHTML وارد صفحه نمی‌شود (جلوگیری از XSS).

export const $ = (selector, root = document) => root.querySelector(selector);

/** ساخت عنصر DOM: h('div', { class: 'a', onclick }, 'متن', child, [children]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let deferredValue;
  for (const [key, val] of Object.entries(props ?? {})) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'for') el.htmlFor = val;
    else if (key === 'dataset') Object.assign(el.dataset, val);
    else if (key === 'value') deferredValue = val; // برای select باید بعد از افزودن option ها تنظیم شود
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key in el && typeof val !== 'object') el[key] = val;
    else el.setAttribute(key, val === true ? '' : val);
  }
  append(el, children);
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const ICONS = {
  right: '<path d="m9 6 6 6-6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] ?? ''; // فقط رشته‌های ثابت بالا
  return svg;
}

// ---------- قالب‌بندی ----------

export const fa = (value) => String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export const money = (n) => (n > 0 ? `${new Intl.NumberFormat('fa-IR').format(n)} تومان` : 'رایگان');

export function durationLabel(min) {
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  if (!hours) return `${fa(rest)} دقیقه`;
  return rest ? `${fa(hours)} ساعت و ${fa(rest)} دقیقه` : `${fa(hours)} ساعت`;
}

const longFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const isoToDate = (iso) => new Date(`${iso}T00:00:00Z`);
export const jalaliLong = (iso) => longFmt.format(isoToDate(iso)).replace(',', '،');
export const jalaliShort = (iso) => shortFmt.format(isoToDate(iso));

export function addDaysISO(iso, n) {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const time = (hhmm) => fa(hhmm);

export const STATUS_LABEL = {
  pending_payment: 'در انتظار پرداخت',
  confirmed: 'تأیید شده',
  completed: 'انجام شد',
  cancelled: 'لغو شده',
  no_show: 'عدم حضور',
};
export const statusBadge = (status) => h('span', { class: `badge ${status}` }, STATUS_LABEL[status] ?? status);

// ---------- شبکه ----------

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path.startsWith('/api/admin/') && !/\/(login|session)$/.test(path)) {
    window.dispatchEvent(new Event('session-expired')); // پنل مدیریت به صفحهٔ ورود برمی‌گردد
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'خطای ناشناخته رخ داد.');
  return data;
}

/** ارقام فارسی/عربی را لاتین می‌کند (برای فیلدهای عددی و شماره تلفن) */
export const latin = (s) => String(s ?? '').replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06f0).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660);

/** فیلد عددی که ارقام فارسی را هم می‌پذیرد؛ مقدار عددی در خاصیت num */
export function numberInput(value = 0, attrs = {}) {
  const input = h('input', { class: 'input', type: 'text', inputmode: 'numeric', dir: 'ltr', value: String(value), ...attrs });
  Object.defineProperty(input, 'num', { get: () => Number(latin(input.value).replace(/[^\d]/g, '') || 0) });
  return input;
}

// ---------- رابط ----------

export function toast(message, kind = '') {
  let box = $('#toasts');
  if (!box) {
    box = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: `toast ${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, message);
  box.append(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3500);
}

let fieldId = 0;
/** برچسب + کنترل + توضیح کوتاه */
export function field(label, control, hint) {
  const id = control.id || `f${++fieldId}`;
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint && h('div', { class: 'hint' }, hint));
}

export function openDialog({ title, body, footer, wide = false, onClose }) {
  const dlg = h(
    'dialog',
    { class: `dlg${wide ? ' wide' : ''}`, 'aria-label': title },
    h('div', { class: 'dlg-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'بستن', onclick: () => dlg.close() }, icon('x'))),
    h('div', { class: 'dlg-body' }, body),
    footer && h('div', { class: 'dlg-foot' }, footer),
  );
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmDialog(message, { confirmText = 'تأیید', danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const dlg = openDialog({
      title: 'تأیید',
      body: h('p', {}, message),
      footer: [
        h('button', { class: `btn ${danger ? 'solid-danger' : 'primary'}`, type: 'button', onclick: () => { answer = true; dlg.close(); } }, confirmText),
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف'),
      ],
      onClose: () => resolve(answer),
    });
  });
}

/** اجرای یک عملیات async با غیرفعال کردن دکمه و نمایش خطا */
export async function guarded(button, fn) {
  button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    button.disabled = false;
  }
}

export function applyBrand(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const root = document.documentElement.style;
  root.setProperty('--brand', hex);
  root.setProperty('--brand-contrast', luminance > 0.4 ? '#10201c' : '#ffffff');
}

/**
 * انتخابگر ساعت ۲۴ ساعته با ارقام فارسی (فیلد type=time مرورگر بسته به زبان سیستم ۱۲ ساعته می‌شود).
 * value: «HH:MM» یا رشتهٔ خالی وقتی انتخاب نشده.
 */
export function timeSelect({ value = '', step = 5, label = 'ساعت', onChange } = {}) {
  const pad = (n) => String(n).padStart(2, '0');
  const [vh = '', vm = ''] = value ? value.split(':') : [];
  const minutes = new Set(Array.from({ length: Math.ceil(60 / step) }, (_, i) => pad(i * step)));
  if (vm) minutes.add(vm); // دقیقهٔ ذخیره‌شده‌ای که مضرب گام نیست از دست نرود
  const opt = (v) => h('option', { value: v }, v === '' ? '--' : fa(v));
  const hh = h('select', { class: 'input', 'aria-label': `${label} (ساعت)` }, opt(''), Array.from({ length: 24 }, (_, i) => opt(pad(i))));
  const mm = h('select', { class: 'input', 'aria-label': `${label} (دقیقه)` }, opt(''), [...minutes].sort().map(opt));
  hh.value = vh;
  mm.value = vm;
  const api = {
    el: h('span', { class: 'time-select', dir: 'ltr' }, hh, h('b', {}, ':'), mm),
    get value() {
      return hh.value && mm.value ? `${hh.value}:${mm.value}` : '';
    },
    set value(v) {
      const [a = '', b = ''] = v ? v.split(':') : [];
      if (b && ![...mm.options].some((o) => o.value === b)) mm.append(opt(b));
      hh.value = a;
      mm.value = b;
    },
  };
  const changed = () => {
    if (hh.value && !mm.value) mm.value = '00';
    onChange?.(api.value);
  };
  hh.addEventListener('change', changed);
  mm.addEventListener('change', changed);
  return api;
}

export function showSpinner(container) {
  container.replaceChildren(h('div', { class: 'spinner', role: 'status', 'aria-label': 'در حال بارگذاری' }));
}

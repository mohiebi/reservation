// تنظیمات به‌صورت key/value در دیتابیس ذخیره می‌شوند. نوع هر کلید از روی مقدار پیش‌فرضش مشخص است.

export const DEFAULTS = {
  business_name: 'کسب‌وکار من',
  business_phone: '',
  business_address: '',
  business_about: '',
  brand_color: '#0f766e',
  timezone: 'Asia/Tehran',

  slot_step_min: 30,
  min_notice_min: 60,
  max_days_ahead: 30,
  cancel_before_hours: 12,
  max_active_per_phone: 3,
  cancel_policy: '',

  payment_mode: 'none', // none | deposit | full
  deposit_percent: 30,
  hold_min: 15,
  payment_gateway: 'mock', // mock | zarinpal
  zarinpal_merchant_id: '',
  zarinpal_sandbox: false,

  sms_enabled: false,
  sms_provider: 'console', // console | kavenegar
  kavenegar_api_key: '',
  kavenegar_sender: '',
  reminder_hours: 24, // ۰ = بدون یادآوری
  sms_tpl_confirm: 'سلام {name}، نوبت شما برای {service} در {business} ثبت شد.\n{weekday} {date} ساعت {time}\nکد پیگیری: {code}\n{link}',
  sms_tpl_reminder: 'سلام {name}، یادآوری نوبت {service} در {business}:\n{weekday} {date} ساعت {time}\n{link}',
  sms_tpl_cancel: 'سلام {name}، نوبت {service} شما در {business} ({date} ساعت {time}) لغو شد.',
  sms_tpl_otp: 'کد تأیید لغو نوبت در {business}: {code}\nاین کد را در اختیار دیگران قرار ندهید.',
};

/** این کلیدها هرگز به مرورگر برگردانده نمی‌شوند */
export const SECRET_KEYS = new Set(['zarinpal_merchant_id', 'kavenegar_api_key']);

const ENUMS = {
  payment_mode: ['none', 'deposit', 'full'],
  payment_gateway: ['mock', 'zarinpal'],
  sms_provider: ['console', 'kavenegar'],
};

const RANGES = {
  slot_step_min: [5, 240],
  min_notice_min: [0, 60 * 24 * 30],
  max_days_ahead: [1, 365],
  cancel_before_hours: [0, 24 * 30],
  max_active_per_phone: [1, 50],
  deposit_percent: [1, 100],
  hold_min: [5, 120],
  reminder_hours: [0, 24 * 14],
};

export function getSettings(db) {
  const out = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    if (row.key in DEFAULTS) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        /* مقدار خراب را نادیده می‌گیریم و پیش‌فرض می‌ماند */
      }
    }
  }
  return out;
}

/** مقدار ورودی را بر اساس نوع پیش‌فرض اعتبارسنجی می‌کند؛ در صورت خطا پیام فارسی می‌اندازد. */
function coerce(key, value) {
  const def = DEFAULTS[key];
  if (typeof def === 'boolean') return value === true || value === 'true' || value === 1;
  if (typeof def === 'number') {
    const n = Number(value);
    const [min, max] = RANGES[key] ?? [0, Number.MAX_SAFE_INTEGER];
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`مقدار «${key}» باید عددی بین ${min} و ${max} باشد.`);
    return n;
  }
  const str = String(value ?? '').trim();
  if (ENUMS[key] && !ENUMS[key].includes(str)) throw new Error(`مقدار «${key}» معتبر نیست.`);
  if (key === 'brand_color' && !/^#[0-9a-fA-F]{6}$/.test(str)) throw new Error('رنگ برند باید به شکل #RRGGBB باشد.');
  if (key === 'timezone') {
    try {
      new Intl.DateTimeFormat('en', { timeZone: str });
    } catch {
      throw new Error('منطقهٔ زمانی معتبر نیست.');
    }
  }
  if (str.length > 2000) throw new Error(`مقدار «${key}» بیش از حد طولانی است.`);
  return str;
}

/** فقط کلیدهای شناخته‌شده ذخیره می‌شوند. کلیدهای محرمانهٔ خالی نادیده گرفته می‌شوند (یعنی «تغییر نده»). */
export function updateSettings(db, patch) {
  const save = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const errors = [];
  const accepted = {};
  for (const [key, raw] of Object.entries(patch ?? {})) {
    if (!(key in DEFAULTS)) continue;
    if (SECRET_KEYS.has(key) && (raw === '' || raw == null)) continue;
    try {
      accepted[key] = coerce(key, raw);
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (errors.length) throw new Error(errors.join(' '));
  for (const [key, value] of Object.entries(accepted)) save.run(key, JSON.stringify(value));
}

/** نسخهٔ امن برای ارسال به پنل مدیریت: به‌جای کلیدهای محرمانه فقط وضعیت «تنظیم شده» برمی‌گردد */
export function adminSettingsView(settings) {
  const out = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SECRET_KEYS.has(key)) out[`${key}_set`] = Boolean(value);
    else out[key] = value;
  }
  return out;
}

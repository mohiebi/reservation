import crypto from 'node:crypto';
import { tx } from '../db.js';
import { HttpError, badRequest, conflict } from './errors.js';
import { normalizeDigits } from './phone.js';
import { renderTemplate } from './sms.js';

// کد تأیید لغو نوبت: ۶ رقم، ۵ دقیقه اعتبار، حداکثر ۵ حدس، و محدودیت تعداد ارسال برای هر نوبت.
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_COOLDOWN_MS = 60_000;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_MAX_ATTEMPTS = 5;

/** ۰۹۱۲۳۴۵۶۷۸۹ → ۰۹۱۲***۶۷۸۹ */
export const maskPhone = (phone) => `${phone.slice(0, 4)}***${phone.slice(-4)}`;

/** تأیید هویت با پیامک فقط وقتی ممکن است که ارسال پیامک روشن باشد */
export const otpAvailable = (settings) => Boolean(settings.sms_enabled);

const hashCode = (salt, code) => crypto.createHash('sha256').update(`${salt}:${code}`).digest();

/**
 * یک کد تازه می‌سازد و به شمارهٔ ثبت‌شده در نوبت پیامک می‌کند.
 * appt باید فیلدهای id و customer_phone را داشته باشد. کدهای قبلی همان نوبت باطل می‌شوند.
 */
export async function requestCancelOtp(ctx, appt) {
  const settings = ctx.settings();
  if (!otpAvailable(settings)) throw conflict('تأیید هویت با پیامک فعال نیست؛ برای لغو نوبت با ما تماس بگیرید.');
  const nowMs = ctx.now().getTime();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = crypto.randomBytes(8).toString('hex');

  tx(ctx.db, () => {
    const last = ctx.db.prepare('SELECT created_at FROM cancel_otps WHERE appointment_id = ? ORDER BY id DESC LIMIT 1').get(appt.id);
    if (last && nowMs - last.created_at < OTP_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_COOLDOWN_MS - (nowMs - last.created_at)) / 1000);
      throw new HttpError(429, `برای دریافت دوبارهٔ کد ${wait} ثانیه صبر کنید.`, { retryAfterSec: wait });
    }
    const recent = ctx.db.prepare('SELECT COUNT(*) AS n FROM cancel_otps WHERE appointment_id = ? AND created_at > ?').get(appt.id, nowMs - 3600_000).n;
    if (recent >= OTP_MAX_SENDS_PER_HOUR) throw new HttpError(429, 'تعداد درخواست کد برای این نوبت زیاد بود. یک ساعت بعد دوباره تلاش کنید یا با ما تماس بگیرید.');
    ctx.db.prepare('UPDATE cancel_otps SET used = 1 WHERE appointment_id = ? AND used = 0').run(appt.id);
    ctx.db
      .prepare('INSERT INTO cancel_otps (appointment_id, salt, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(appt.id, salt, hashCode(salt, code).toString('hex'), nowMs + OTP_TTL_MS, nowMs);
  });

  const body = renderTemplate(settings.sms_tpl_otp, { business: settings.business_name, code });
  const result = await ctx.sendSms({
    phone: appt.customer_phone,
    kind: 'otp',
    body,
    logBody: renderTemplate(settings.sms_tpl_otp, { business: settings.business_name, code: '••••••' }), // کد در گزارش پیامک‌ها ذخیره نمی‌شود
  });
  if (result?.status === 'failed') throw new HttpError(502, 'ارسال پیامک ناموفق بود. کمی بعد دوباره تلاش کنید یا با ما تماس بگیرید.');
  return { phoneMasked: maskPhone(appt.customer_phone), retryAfterSec: OTP_COOLDOWN_MS / 1000 };
}

/** کد واردشده را بررسی و در صورت درستی «مصرف» می‌کند. در غیر این صورت خطای فارسی می‌اندازد. */
export function verifyCancelOtp(ctx, appt, input) {
  const code = normalizeDigits(input).replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) throw badRequest('کد تأیید یک عدد ۶ رقمی است.');
  const nowMs = ctx.now().getTime();

  // نتیجه را از داخل تراکنش برمی‌گردانیم و بیرون از آن خطا می‌اندازیم؛ وگرنه شمارندهٔ حدس‌ها هم برگردانده می‌شد.
  const result = tx(ctx.db, () => {
    const row = ctx.db
      .prepare('SELECT * FROM cancel_otps WHERE appointment_id = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1')
      .get(appt.id, nowMs);
    if (!row) return 'none';
    const expected = Buffer.from(row.code_hash, 'hex');
    if (crypto.timingSafeEqual(hashCode(row.salt, code), expected)) {
      ctx.db.prepare('UPDATE cancel_otps SET used = 1 WHERE id = ?').run(row.id);
      return 'ok';
    }
    const attempts = row.attempts + 1;
    ctx.db.prepare('UPDATE cancel_otps SET attempts = ?, used = ? WHERE id = ?').run(attempts, attempts >= OTP_MAX_ATTEMPTS ? 1 : 0, row.id);
    return attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'wrong';
  });

  if (result === 'ok') return;
  if (result === 'none') throw badRequest('کدی دریافت نشده یا کد منقضی شده است. یک کد تازه بگیرید.');
  if (result === 'locked') throw new HttpError(429, 'تعداد تلاش‌های ناموفق زیاد بود. یک کد تازه بگیرید.');
  throw badRequest('کد تأیید درست نیست.');
}

export function purgeOldOtps(db, nowMs) {
  db.prepare('DELETE FROM cancel_otps WHERE created_at < ?').run(nowMs - 24 * 3600_000);
}

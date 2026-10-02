import { config } from '../config.js';
import { describeDate } from './jalali.js';
import { minToHHMM } from './time.js';
import { faDigits } from './jalali.js';

export function renderTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

async function kavenegarSend(settings, phone, body) {
  if (!settings.kavenegar_api_key) throw new Error('کلید API کاوه‌نگار تنظیم نشده است.');
  const params = new URLSearchParams({ receptor: phone, message: body });
  if (settings.kavenegar_sender) params.set('sender', settings.kavenegar_sender);
  const res = await fetch(`https://api.kavenegar.com/v1/${encodeURIComponent(settings.kavenegar_api_key)}/sms/send.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.return?.status !== 200) throw new Error(data?.return?.message || `HTTP ${res.status}`);
}

/** پیامک می‌فرستد و همیشه نتیجه را در sms_log ثبت می‌کند. هرگز خطا نمی‌اندازد. */
export async function sendSms(ctx, { phone, kind, body }) {
  const settings = ctx.settings();
  if (!settings.sms_enabled) return { status: 'disabled' };
  let status = 'sent';
  let error = '';
  try {
    if (settings.sms_provider === 'kavenegar') await kavenegarSend(settings, phone, body);
    else status = 'simulated'; // حالت آزمایشی: فقط در لاگ ثبت می‌شود
  } catch (err) {
    status = 'failed';
    error = String(err?.message ?? err).slice(0, 300);
  }
  try {
    ctx.db
      .prepare('INSERT INTO sms_log (phone, kind, body, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(phone, kind, body, status, error, ctx.now().toISOString());
  } catch (err) {
    console.error('sms_log write failed:', err);
  }
  return { status, error };
}

/** kind: confirm | reminder | cancel */
export function notifyAppointment(ctx, appointmentId, kind) {
  const settings = ctx.settings();
  if (!settings.sms_enabled) return;
  const a = ctx.db
    .prepare(
      `SELECT a.*, c.name AS customer_name, c.phone AS customer_phone
       FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE a.id = ?`,
    )
    .get(appointmentId);
  if (!a) return;
  const { dateLabel, weekdayLabel } = describeDate(a.date);
  const body = renderTemplate(settings[`sms_tpl_${kind}`], {
    name: a.customer_name,
    service: a.service_name,
    business: settings.business_name,
    date: dateLabel,
    weekday: weekdayLabel,
    time: faDigits(minToHHMM(a.start_min)),
    code: a.code,
    link: `${config.baseUrl}/b/${a.code}`,
  });
  ctx.sendSms({ phone: a.customer_phone, kind, body }).catch((err) => console.error('sms failed:', err));
}

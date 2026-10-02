import crypto from 'node:crypto';
import { config } from '../config.js';
import { tx } from '../db.js';
import { applyPayment } from './booking.js';

/**
 * هر درگاه دو عملیات دارد:
 *   request({ amount (تومان)، description، callbackUrl، mobile }) → { authority, url }
 *   verify({ authority، amount (تومان)، status })                  → { ok, refId }
 */
const gateways = {
  // درگاه آزمایشی محلی: برای توسعه و تست بدون پول واقعی. هرگز در محیط واقعی استفاده نشود.
  mock: {
    async request() {
      const authority = `MOCK${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
      return { authority, url: `${config.baseUrl}/pay/mock/${authority}` };
    },
    async verify({ authority, status }) {
      return status === 'OK' ? { ok: true, refId: `MOCK-${authority.slice(-6)}` } : { ok: false };
    },
  },

  zarinpal: {
    base(settings) {
      return settings.zarinpal_sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
    },
    async post(settings, path, body) {
      const res = await fetch(`${this.base(settings)}/pg/v4/payment/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ merchant_id: settings.zarinpal_merchant_id, ...body }),
        signal: AbortSignal.timeout(15_000),
      });
      return res.json().catch(() => null);
    },
    async request({ settings, amount, description, callbackUrl, mobile }) {
      if (!settings.zarinpal_merchant_id) throw new Error('مرچنت‌کد زرین‌پال تنظیم نشده است.');
      const data = await this.post(settings, 'request.json', {
        amount: amount * 10, // زرین‌پال به‌صورت پیش‌فرض ریال می‌گیرد
        callback_url: callbackUrl,
        description,
        metadata: mobile ? { mobile } : undefined,
      });
      if (data?.data?.code !== 100 || !data.data.authority) {
        throw new Error(data?.errors?.message || 'پاسخ نامعتبر از زرین‌پال');
      }
      return { authority: data.data.authority, url: `${this.base(settings)}/pg/StartPay/${data.data.authority}` };
    },
    async verify({ settings, authority, amount, status }) {
      if (status !== 'OK') return { ok: false };
      const data = await this.post(settings, 'verify.json', { amount: amount * 10, authority });
      const code = data?.data?.code;
      // ۱۰۰ = موفق، ۱۰۱ = قبلاً تأیید شده
      return code === 100 || code === 101 ? { ok: true, refId: String(data.data.ref_id ?? '') } : { ok: false };
    },
  },
};

/** شروع پرداخت مبلغ باقی‌ماندهٔ نوبت؛ آدرس صفحهٔ درگاه را برمی‌گرداند */
export async function startPayment(ctx, appointment) {
  const settings = ctx.settings();
  const gatewayName = settings.payment_gateway;
  const gateway = gateways[gatewayName];
  const amount = appointment.deposit - appointment.paid;
  if (amount <= 0) throw new Error('مبلغی برای پرداخت وجود ندارد.');

  const { authority, url } = await gateway.request({
    settings,
    amount,
    description: `${settings.business_name} - ${appointment.service_name}`,
    callbackUrl: `${config.baseUrl}/pay/callback`,
    mobile: appointment.customer_phone,
  });
  ctx.db
    .prepare(`INSERT INTO payments (appointment_id, amount, gateway, authority, status, created_at) VALUES (?, ?, ?, ?, 'initiated', ?)`)
    .run(appointment.id, amount, gatewayName, authority, ctx.now().toISOString());
  return { url };
}

/**
 * بازگشت از درگاه. نتیجه: { code (کد پیگیری نوبت), outcome } که outcome یکی از
 * confirmed | failed | expired_paid | unknown است. تکرار callback امن است (idempotent).
 */
export async function handleCallback(ctx, { authority, status }) {
  const payment = authority ? ctx.db.prepare('SELECT * FROM payments WHERE authority = ?').get(String(authority)) : null;
  if (!payment) return { code: null, outcome: 'unknown' };
  const appt = ctx.db.prepare('SELECT code, status FROM appointments WHERE id = ?').get(payment.appointment_id);

  if (payment.status === 'paid') return { code: appt.code, outcome: appt.status === 'cancelled' ? 'expired_paid' : 'confirmed' };
  if (payment.status === 'failed') return { code: appt.code, outcome: 'failed' };

  let verified;
  try {
    verified = await gateways[payment.gateway].verify({ settings: ctx.settings(), authority: payment.authority, amount: payment.amount, status });
  } catch (err) {
    console.error('payment verify failed:', err);
    return { code: appt.code, outcome: 'failed' };
  }

  if (!verified.ok) {
    ctx.db.prepare(`UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'initiated'`).run(payment.id);
    return { code: appt.code, outcome: 'failed' };
  }

  // جلوگیری از دوبار اعمال شدن پرداخت در درخواست‌های هم‌زمان
  const claimed = tx(ctx.db, () => {
    const r = ctx.db
      .prepare(`UPDATE payments SET status = 'paid', ref_id = ?, paid_at = ? WHERE id = ? AND status = 'initiated'`)
      .run(verified.refId ?? '', ctx.now().toISOString(), payment.id);
    return r.changes === 1;
  });
  if (!claimed) return { code: appt.code, outcome: 'confirmed' };

  return { code: appt.code, outcome: applyPayment(ctx, payment.appointment_id, payment.amount) };
}

export function mockGatewayInfo(ctx, authority) {
  return ctx.db
    .prepare(
      `SELECT p.amount, p.status, a.service_name FROM payments p JOIN appointments a ON a.id = p.appointment_id
       WHERE p.authority = ? AND p.gateway = 'mock'`,
    )
    .get(authority);
}

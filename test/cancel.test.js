import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OTP_COOLDOWN_MS, OTP_TTL_MS } from '../server/lib/otp.js';
import { sendSms } from '../server/lib/sms.js';
import { SATURDAY, customer, makeCtx, seed, startServer } from './helpers.js';

const MIN = 60_000;
const advance = (ctx, ms) => { ctx.clock.current = new Date(ctx.clock.current.getTime() + ms); };

/** سرور + یک نوبت ثبت‌شده (شنبه ۱۲:۰۰) برای مشتری شمارهٔ ۱ */
async function setup(settings = {}, limits = {}) {
  const ctx = makeCtx({ sms_enabled: true, cancel_before_hours: 12, ...settings }, { otpSend: 1000, otpVerify: 1000, lookup: 1000, ...limits });
  const { serviceId, staffIds } = seed(ctx);
  const srv = await startServer(ctx);
  const book = async (who = 1, time = '12:00') => {
    const r = await srv.call('POST', '/api/public/bookings', { body: { serviceId, staffId: staffIds[0], date: SATURDAY, time, ...customer(who) } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.code;
  };
  const lastOtp = () => /\d{6}/.exec(ctx.sentSms.filter((m) => m.kind === 'otp').at(-1).body)[0];
  const sendCode = (code) => srv.call('POST', `/api/public/bookings/${code}/cancel-code`, { body: {} });
  const cancel = (code, otp) => srv.call('POST', `/api/public/bookings/${code}/cancel`, { body: { otp } });
  const status = async (code) => (await srv.call('GET', `/api/public/bookings/${code}`)).data.booking.status;
  return { ctx, srv, book, lastOtp, sendCode, cancel, status };
}

test('داشتن کد پیگیری کافی نیست: بدون کد تأیید پیامکی هیچ راهی برای لغو نیست', async () => {
  const t = await setup();
  try {
    const code = await t.book();
    for (const body of [{}, { otp: '' }, { otp: '123456' }, { otp: 'abcdef' }, { otp: null }, { code }]) {
      const r = await t.srv.call('POST', `/api/public/bookings/${code}/cancel`, { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(await t.status(code), 'confirmed');
    // مسیر قدیمی با متدهای دیگر هم راهی نیست
    assert.equal((await t.srv.call('DELETE', `/api/public/bookings/${code}`)).status, 404);
    assert.equal((await t.srv.call('PATCH', `/api/public/bookings/${code}`, { body: { status: 'cancelled' } })).status, 404);
    assert.equal(await t.status(code), 'confirmed');
  } finally { t.srv.close(); }
});

test('کد تأیید فقط به شمارهٔ ثبت‌شده در نوبت می‌رود و پس از یک بار استفاده باطل می‌شود', async () => {
  const t = await setup();
  try {
    const code = await t.book(1);
    const sent = await t.sendCode(code);
    assert.equal(sent.status, 200);
    assert.equal(sent.data.phoneMasked, '0912***0001');
    const sms = t.ctx.sentSms.filter((m) => m.kind === 'otp');
    assert.equal(sms.length, 1);
    assert.equal(sms[0].phone, customer(1).phone); // نه شماره‌ای که درخواست‌دهنده بگوید
    const otp = t.lastOtp();

    // ارقام فارسی هم پذیرفته می‌شود
    const persian = otp.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
    assert.equal((await t.cancel(code, persian)).status, 200);
    assert.equal(await t.status(code), 'cancelled');
    assert.equal((await t.cancel(code, otp)).status, 409); // نوبت دیگر قابل لغو نیست
  } finally { t.srv.close(); }
});

test('کد یک نوبت برای نوبت دیگر (حتی با همان شماره) کار نمی‌کند', async () => {
  const t = await setup();
  try {
    const a = await t.book(1, '09:00');
    const b = await t.book(1, '10:30');
    await t.sendCode(a);
    const otpA = t.lastOtp();
    assert.equal((await t.cancel(b, otpA)).status, 400);
    assert.equal(await t.status(b), 'confirmed');
    assert.equal((await t.cancel(a, otpA)).status, 200);
  } finally { t.srv.close(); }
});

test('حدس زدن کد: بعد از ۵ تلاش اشتباه باطل می‌شود (حتی کد درست)', async () => {
  const t = await setup();
  try {
    const code = await t.book();
    await t.sendCode(code);
    const otp = t.lastOtp();
    const wrong = otp === '000000' ? '111111' : '000000';
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await t.cancel(code, wrong)).status);
    assert.deepEqual(results, [400, 400, 400, 400, 429]);
    assert.equal((await t.cancel(code, otp)).status, 400); // کد باطل شده؛ باید کد تازه بگیرد
    assert.equal(await t.status(code), 'confirmed');

    advance(t.ctx, OTP_COOLDOWN_MS + 1000);
    assert.equal((await t.sendCode(code)).status, 200);
    assert.equal((await t.cancel(code, t.lastOtp())).status, 200);
  } finally { t.srv.close(); }
});

test('کد بعد از ۵ دقیقه منقضی می‌شود و کد جدید کد قبلی را باطل می‌کند', async () => {
  const t = await setup();
  try {
    const code = await t.book();
    await t.sendCode(code);
    const first = t.lastOtp();
    advance(t.ctx, OTP_TTL_MS + 1000);
    assert.equal((await t.cancel(code, first)).status, 400);

    assert.equal((await t.sendCode(code)).status, 200);
    const second = t.lastOtp();
    advance(t.ctx, OTP_COOLDOWN_MS + 1000);
    assert.equal((await t.sendCode(code)).status, 200);
    const third = t.lastOtp();
    if (second !== third) assert.equal((await t.cancel(code, second)).status, 400); // کد قبلی باطل شده
    assert.equal((await t.cancel(code, third)).status, 200);
  } finally { t.srv.close(); }
});

test('محدودیت ارسال: فاصلهٔ ۶۰ ثانیه و حداکثر ۵ کد در ساعت برای هر نوبت', async () => {
  const t = await setup();
  try {
    const code = await t.book();
    assert.equal((await t.sendCode(code)).status, 200);
    const tooSoon = await t.sendCode(code);
    assert.equal(tooSoon.status, 429);
    assert.ok(tooSoon.data.retryAfterSec > 0);
    assert.equal(t.ctx.sentSms.filter((m) => m.kind === 'otp').length, 1); // پیامک دوم ارسال نشد

    for (let i = 0; i < 4; i++) {
      advance(t.ctx, OTP_COOLDOWN_MS + 1000);
      assert.equal((await t.sendCode(code)).status, 200);
    }
    advance(t.ctx, OTP_COOLDOWN_MS + 1000);
    assert.equal((await t.sendCode(code)).status, 429); // ششمین درخواست در یک ساعت
    assert.equal(t.ctx.sentSms.filter((m) => m.kind === 'otp').length, 5);
  } finally { t.srv.close(); }
});

test('محدودیت تعداد درخواست از هر IP (ارسال و تأیید کد)', async () => {
  const t = await setup({}, { otpSend: 2, otpVerify: 3 });
  try {
    const code = await t.book();
    assert.equal((await t.sendCode(code)).status, 200);
    advance(t.ctx, OTP_COOLDOWN_MS + 1000);
    assert.equal((await t.sendCode(code)).status, 200);
    advance(t.ctx, OTP_COOLDOWN_MS + 1000);
    assert.equal((await t.sendCode(code)).status, 429);

    const verify = [];
    for (let i = 0; i < 4; i++) verify.push((await t.cancel(code, '000000')).status);
    assert.equal(verify.at(-1), 429);
  } finally { t.srv.close(); }
});

test('بدون پیامک، تأیید هویت ممکن نیست؛ لغو آنلاین بسته می‌ماند (نه اینکه بدون تأیید باز شود)', async () => {
  const t = await setup({ sms_enabled: false });
  try {
    const code = await t.book();
    const view = (await t.srv.call('GET', `/api/public/bookings/${code}`)).data.booking;
    assert.equal(view.cancelNeedsCode, false);
    const r = await t.sendCode(code);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /تماس/);
    assert.equal((await t.cancel(code, '123456')).status, 400);
    assert.equal(await t.status(code), 'confirmed');
  } finally { t.srv.close(); }
});

test('قانون مهلت لغو قبل از ارسال کد بررسی می‌شود؛ برای نوبتِ نزدیک پیامکی نمی‌رود', async () => {
  const t = await setup({ cancel_before_hours: 100 }); // شنبه ۱۲:۰۰ ≈ ۵۰ ساعت دیگر
  try {
    const code = await t.book();
    const r = await t.sendCode(code);
    assert.equal(r.status, 409);
    assert.equal(t.ctx.sentSms.filter((m) => m.kind === 'otp').length, 0);
    assert.equal((await t.cancel(code, '123456')).status, 409);
  } finally { t.srv.close(); }
});

test('خود کد در گزارش پیامک‌ها ذخیره نمی‌شود', async () => {
  const t = await setup();
  try {
    let sent;
    t.ctx.sendSms = (args) => { sent = args; return sendSms(t.ctx, args); }; // ارسال واقعی (حالت آزمایشی) تا ثبت در sms_log هم انجام شود
    const code = await t.book();
    await t.sendCode(code);
    const otp = /\d{6}/.exec(sent.body)[0];
    const row = t.ctx.db.prepare("SELECT * FROM sms_log WHERE kind = 'otp'").get();
    assert.ok(row);
    assert.equal(row.body.includes(otp), false);
    assert.match(row.body, /••••••/);
    const audit = JSON.stringify(t.ctx.db.prepare('SELECT * FROM audit_log').all());
    assert.equal(audit.includes(otp), false);
  } finally { t.srv.close(); }
});

test('رویدادهای لغو در گزارش امنیتی ثبت می‌شوند', async () => {
  const t = await setup();
  try {
    const code = await t.book();
    await t.cancel(code, '000000');
    await t.sendCode(code);
    await t.cancel(code, t.lastOtp());
    const actions = t.ctx.db.prepare('SELECT action FROM audit_log ORDER BY id').all().map((r) => r.action);
    assert.deepEqual(actions, ['cancel_code_failed', 'cancel_code_sent', 'cancelled_by_customer']);
  } finally { t.srv.close(); }
});

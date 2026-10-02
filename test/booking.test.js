import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSlots } from '../server/lib/availability.js';
import { applyPayment, cancelAppointment, cancelByCustomer, createBooking, expireHolds, getAppointment, updateAppointment } from '../server/lib/booking.js';
import { handleCallback, startPayment } from '../server/lib/payment.js';
import { runMaintenance } from '../server/lib/scheduler.js';
import { updateSettings } from '../server/lib/settings.js';
import { SATURDAY, SUNDAY, customer, makeCtx, seed } from './helpers.js';

const service = (ctx, id) => ctx.db.prepare('SELECT * FROM services WHERE id = ?').get(id);
const starts = (ctx, serviceId, staffId, date = SATURDAY, opts = {}) =>
  findSlots(ctx, { service: service(ctx, serviceId), staffId, date, ...opts }).map((s) => s.start);
const book = (ctx, serviceId, staffId, startMin, who = 1, date = SATURDAY) =>
  createBooking(ctx, { serviceId, staffId, date, startMin, ...customer(who) });

test('زمان‌های خالی از ساعت کاری ساخته می‌شوند', () => {
  const ctx = makeCtx();
  const { serviceId, staffIds } = seed(ctx);
  // خدمت ۶۰ دقیقه‌ای در بازهٔ ۹ تا ۱۳ با گام ۳۰ دقیقه: ۹:۰۰ تا ۱۲:۰۰
  assert.deepEqual(starts(ctx, serviceId, staffIds[0]), [540, 570, 600, 630, 660, 690, 720]);
  // روزی که ساعت کاری ندارد (یکشنبه)
  assert.deepEqual(starts(ctx, serviceId, staffIds[0], SUNDAY), []);
});

test('نوبت ثبت‌شده زمان‌های هم‌پوشان را می‌بندد و رزرو دوبل رد می‌شود', () => {
  const ctx = makeCtx();
  const { serviceId, staffIds } = seed(ctx);
  book(ctx, serviceId, staffIds[0], 600); // ۱۰:۰۰ تا ۱۱:۰۰
  // ۹:۰۰ تا ۱۰:۰۰ هنوز آزاد است؛ ۹:۳۰ و ۱۰:۳۰ هم‌پوشانی دارند
  assert.deepEqual(starts(ctx, serviceId, staffIds[0]), [540, 660, 690, 720]);
  assert.throws(() => book(ctx, serviceId, staffIds[0], 630, 2), (e) => e.status === 409);
  assert.throws(() => book(ctx, serviceId, staffIds[0], 600, 2), (e) => e.status === 409);
  book(ctx, serviceId, staffIds[0], 660, 2); // بلافاصله بعد از اولی مجاز است
});

test('زمان استراحت بعد از هر خدمت رزرو می‌شود', () => {
  const ctx = makeCtx();
  const { serviceId, staffIds } = seed(ctx, { buffer: 30 });
  book(ctx, serviceId, staffIds[0], 540); // تا ۱۰:۰۰ + ۳۰ دقیقه استراحت
  assert.equal(starts(ctx, serviceId, staffIds[0]).includes(600), false);
  assert.equal(starts(ctx, serviceId, staffIds[0]).includes(630), true);
});

test('هر کدام از پرسنل: توزیع بار و پر شدن ظرفیت', () => {
  const ctx = makeCtx();
  const { serviceId, staffIds } = seed(ctx);
  const a = book(ctx, serviceId, null, 540, 1);
  const b = book(ctx, serviceId, null, 540, 2); // نفر اول پر است، باید نفر دوم انتخاب شود
  assert.notEqual(a.staff_id, b.staff_id);
  assert.deepEqual([a.staff_id, b.staff_id].sort(), [...staffIds].sort());
  assert.throws(() => book(ctx, serviceId, null, 540, 3), (e) => e.status === 409);
  // ساعت ۹:۳۰ فقط وقتی هر دو نفر درگیرند بسته است؛ اینجا هر دو تا ۱۰:۰۰ درگیرند
  assert.equal(starts(ctx, serviceId, null).includes(540), false);
  assert.equal(starts(ctx, serviceId, null).includes(600), true);
});

test('مرخصی تمام‌روز و ساعتی', () => {
  const ctx = makeCtx();
  const { serviceId, staffIds } = seed(ctx);
  ctx.db.prepare('INSERT INTO time_off (staff_id, date_from, date_to, start_min, end_min) VALUES (?, ?, ?, 600, 660)').run(staffIds[0], SATURDAY, SATURDAY);
  // مرخصی ۱۰ تا ۱۱: فقط ۹:۰۰ (تا ۱۰:۰۰) و از ۱۱:۰۰ به بعد جا دارد
  assert.deepEqual(starts(ctx, serviceId, staffIds[0]), [540, 660, 690, 720]);
  assert.equal(starts(ctx, serviceId, staffIds[1]).length, 7); // مرخصی فرد دیگر اثری ندارد
  ctx.db.prepare('INSERT INTO time_off (staff_id, date_from, date_to) VALUES (NULL, ?, ?)').run(SATURDAY, SATURDAY); // تعطیلی کل مجموعه
  assert.deepEqual(starts(ctx, serviceId, staffIds[0]), []);
  assert.deepEqual(starts(ctx, serviceId, staffIds[1]), []);
});

test('حداقل زمان قبل از نوبت و سقف روزهای آینده', () => {
  const ctx = makeCtx({ min_notice_min: 0, max_days_ahead: 30 });
  const { serviceId, staffIds } = seed(ctx);
  // اکنون پنجشنبه ۱۰:۰۰ است؛ با حداقل ۴۹ ساعت فاصله، اولین زمان مجاز شنبه ۱۱:۰۰ است
  updateSettings(ctx.db, { min_notice_min: 2 * 24 * 60 + 60 });
  assert.equal(starts(ctx, serviceId, staffIds[0]).includes(630), false);
  assert.equal(starts(ctx, serviceId, staffIds[0]).includes(660), true);
  // مدیر از این قانون معاف است
  assert.equal(starts(ctx, serviceId, staffIds[0], SATURDAY, { admin: true }).includes(540), true);
  updateSettings(ctx.db, { min_notice_min: 0, max_days_ahead: 1 });
  assert.deepEqual(starts(ctx, serviceId, staffIds[0]), []);
  assert.equal(starts(ctx, serviceId, staffIds[0], SATURDAY, { admin: true }).length > 0, true);
});

test('گذشته قابل رزرو نیست', () => {
  const ctx = makeCtx({ min_notice_min: 0 });
  const { serviceId, staffIds } = seed(ctx);
  ctx.clock.current = new Date('2026-10-03T06:30:00Z'); // شنبه ۱۰:۰۰
  const s = starts(ctx, serviceId, staffIds[0]);
  assert.equal(s.every((t) => t >= 600), true);
  assert.equal(s.includes(600), true);
  assert.deepEqual(starts(ctx, serviceId, staffIds[0], '2026-10-01'), []);
});

test('محدودیت تعداد نوبت فعال برای یک شماره', () => {
  const ctx = makeCtx({ max_active_per_phone: 2 });
  const { serviceId, staffIds } = seed(ctx);
  book(ctx, serviceId, staffIds[0], 540, 1);
  book(ctx, serviceId, staffIds[0], 600, 1);
  assert.throws(() => book(ctx, serviceId, staffIds[0], 660, 1), (e) => e.status === 409);
  book(ctx, serviceId, staffIds[0], 660, 2); // شمارهٔ دیگر اشکالی ندارد
});

test('پرداخت: نگه‌داشتن زمان، تأیید و انقضا', async () => {
  const ctx = makeCtx({ payment_mode: 'deposit', deposit_percent: 30, hold_min: 15, payment_gateway: 'mock' });
  const { serviceId, staffIds } = seed(ctx, { price: 200_000 });

  const appt = book(ctx, serviceId, staffIds[0], 540);
  assert.equal(appt.status, 'pending_payment');
  assert.equal(appt.deposit, 60_000);
  // زمان در مدت مهلت برای دیگران بسته است
  assert.equal(starts(ctx, serviceId, staffIds[0]).includes(540), false);

  const { url } = await startPayment(ctx, appt);
  const authority = url.split('/').pop();

  // انصراف: نوبت همچنان در انتظار پرداخت می‌ماند
  const failed = await handleCallback(ctx, { authority, status: 'NOK' });
  assert.equal(failed.outcome, 'failed');
  assert.equal(getAppointment(ctx.db, appt.id).status, 'pending_payment');

  // پس از گذشتن مهلت، زمان آزاد می‌شود
  ctx.clock.current = new Date(ctx.clock.current.getTime() + 16 * 60_000);
  assert.equal(expireHolds(ctx), 1);
  assert.equal(getAppointment(ctx.db, appt.id).status, 'cancelled');
  assert.equal(starts(ctx, serviceId, staffIds[0]).includes(540), true);
});

test('پرداخت موفق نوبت را تأیید می‌کند و تکرار callback بی‌اثر است', async () => {
  const ctx = makeCtx({ payment_mode: 'full', payment_gateway: 'mock', sms_enabled: true });
  const { serviceId, staffIds } = seed(ctx, { price: 100_000 });
  const appt = book(ctx, serviceId, staffIds[0], 540);
  assert.equal(appt.deposit, 100_000);
  const authority = (await startPayment(ctx, appt)).url.split('/').pop();

  const first = await handleCallback(ctx, { authority, status: 'OK' });
  assert.deepEqual(first, { code: appt.code, outcome: 'confirmed' });
  const after = getAppointment(ctx.db, appt.id);
  assert.equal(after.status, 'confirmed');
  assert.equal(after.paid, 100_000);

  await handleCallback(ctx, { authority, status: 'OK' }); // تکرار
  assert.equal(getAppointment(ctx.db, appt.id).paid, 100_000);

  assert.equal((await handleCallback(ctx, { authority: 'نامعتبر', status: 'OK' })).outcome, 'unknown');
});

test('پرداخت بعد از انقضا: اگر زمان آزاد باشد تأیید، وگرنه ثبت پرداخت بدون نوبت', async () => {
  const ctx = makeCtx({ payment_mode: 'full', payment_gateway: 'mock' });
  const { serviceId, staffIds } = seed(ctx);
  const a = book(ctx, serviceId, staffIds[0], 540, 1);
  const authA = (await startPayment(ctx, a)).url.split('/').pop();
  ctx.clock.current = new Date(ctx.clock.current.getTime() + 20 * 60_000);
  expireHolds(ctx);
  assert.equal((await handleCallback(ctx, { authority: authA, status: 'OK' })).outcome, 'confirmed'); // زمان هنوز خالی بود

  const b = book(ctx, serviceId, staffIds[1], 540, 2);
  const authB = (await startPayment(ctx, b)).url.split('/').pop();
  ctx.clock.current = new Date(ctx.clock.current.getTime() + 20 * 60_000);
  expireHolds(ctx);
  updateSettings(ctx.db, { payment_mode: 'none' });
  book(ctx, serviceId, staffIds[1], 540, 3); // شخص دیگری زمان را گرفت
  assert.equal((await handleCallback(ctx, { authority: authB, status: 'OK' })).outcome, 'expired_paid');
  const row = getAppointment(ctx.db, b.id);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.paid, 100_000); // پرداخت ثبت شده تا مدیر پیگیری/بازپرداخت کند
});

test('لغو توسط مشتری فقط تا مهلت مجاز است', () => {
  const ctx = makeCtx({ cancel_before_hours: 12 });
  const { serviceId, staffIds } = seed(ctx);
  const far = book(ctx, serviceId, staffIds[0], 720, 1); // شنبه ۱۲:۰۰ → ۵۱ ساعت بعد
  cancelByCustomer(ctx, far.code);
  assert.equal(getAppointment(ctx.db, far.id).status, 'cancelled');
  assert.throws(() => cancelByCustomer(ctx, far.code), (e) => e.status === 409); // دوباره قابل لغو نیست

  const near = book(ctx, serviceId, staffIds[0], 540, 2);
  ctx.clock.current = new Date('2026-10-03T03:30:00Z'); // شنبه ۷:۰۰؛ ۲ ساعت تا نوبت ۹:۰۰
  assert.throws(() => cancelByCustomer(ctx, near.code), (e) => e.status === 409);
  cancelAppointment(ctx, near.id, { reason: 'admin' }); // مدیر همیشه می‌تواند
  assert.equal(getAppointment(ctx.db, near.id).status, 'cancelled');
});

test('ویرایش توسط مدیر: جابه‌جایی، تداخل و بازگرداندن نوبت لغوشده', () => {
  const ctx = makeCtx();
  const { serviceId, staffIds } = seed(ctx);
  const a = book(ctx, serviceId, staffIds[0], 540, 1);
  const b = book(ctx, serviceId, staffIds[0], 660, 2);

  assert.throws(() => updateAppointment(ctx, b.id, { startMin: 570 }), (e) => e.status === 409);
  const moved = updateAppointment(ctx, b.id, { startMin: 600, notes: 'یادداشت' });
  assert.equal(moved.start_min, 600);
  assert.equal(moved.end_min, 660);
  assert.equal(moved.notes, 'یادداشت');

  cancelAppointment(ctx, a.id);
  book(ctx, serviceId, staffIds[0], 540, 3); // جای نوبت لغوشده را دیگری گرفت
  assert.throws(() => updateAppointment(ctx, a.id, { status: 'confirmed' }), (e) => e.status === 409);

  const done = updateAppointment(ctx, moved.id, { status: 'completed', paid: 100_000 });
  assert.equal(done.status, 'completed');
  assert.equal(done.paid, 100_000);
});

test('ثبت دستی توسط مدیر: ساعت دلخواه ولی بدون هم‌پوشانی', () => {
  const ctx = makeCtx();
  const { serviceId, staffIds } = seed(ctx);
  const a = createBooking(ctx, { serviceId, staffId: staffIds[0], date: SATURDAY, startMin: 7 * 60 + 10, ...customer(1) }, { source: 'admin' });
  assert.equal(a.status, 'confirmed'); // حتی خارج از ساعت کاری
  assert.throws(
    () => createBooking(ctx, { serviceId, staffId: staffIds[0], date: SATURDAY, startMin: 7 * 60 + 40, ...customer(2) }, { source: 'admin' }),
    (e) => e.status === 409,
  );
});

test('پیامک تأیید و یادآوری', async () => {
  const ctx = makeCtx({ sms_enabled: true, reminder_hours: 24 });
  const { serviceId, staffIds } = seed(ctx);
  const a = book(ctx, serviceId, staffIds[0], 540, 1, SATURDAY); // شنبه ۹:۰۰، حدود ۴۸ ساعت بعد
  assert.equal(ctx.sentSms.length, 1);
  assert.equal(ctx.sentSms[0].kind, 'confirm');
  assert.match(ctx.sentSms[0].body, new RegExp(a.code));
  assert.match(ctx.sentSms[0].body, /۱۱ مهر ۱۴۰۵/);

  runMaintenance(ctx);
  assert.equal(ctx.sentSms.length, 1); // هنوز ۲۴ ساعت مانده

  ctx.clock.current = new Date('2026-10-02T09:00:00Z'); // جمعه ۱۲:۳۰؛ ۲۰ ساعت مانده
  runMaintenance(ctx);
  assert.equal(ctx.sentSms.length, 2);
  assert.equal(ctx.sentSms[1].kind, 'reminder');
  runMaintenance(ctx);
  assert.equal(ctx.sentSms.length, 2); // یادآوری فقط یک‌بار
});

test('applyPayment روی نوبت نامعتبر خطا نمی‌دهد', () => {
  const ctx = makeCtx();
  assert.equal(applyPayment(ctx, 999, 1000), 'missing');
});

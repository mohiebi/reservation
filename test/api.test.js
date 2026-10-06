import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/lib/auth.js';
import { SATURDAY, makeCtx, seed } from './helpers.js';

const ADMIN_PASSWORD = 'test-password-for-ci-only';
let server;
let base;
let ids;
let ctx;

before(async () => {
  ctx = makeCtx({ business_name: 'سالن تست' });
  ids = seed(ctx, { price: 100_000 });
  ctx.db.prepare('INSERT INTO admins (username, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('owner', 'مالک', await hashPassword(ADMIN_PASSWORD), new Date().toISOString());
  server = createApp(ctx).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function call(method, path, { body, cookie, json = true } = {}) {
  const headers = {};
  if (json) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* غیر JSON */ }
  return { status: res.status, data, res, text };
}

async function login() {
  const r = await call('POST', '/api/admin/login', { body: { username: 'owner', password: ADMIN_PASSWORD } });
  assert.equal(r.status, 200);
  return r.res.headers.get('set-cookie').split(';')[0];
}

test('صفحات و هدرهای امنیتی', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(home.res.headers.get('x-frame-options'), 'DENY');
  const admin = await call('GET', '/admin');
  assert.equal(admin.status, 301);
  assert.equal(admin.res.headers.get('location'), '/admin/');
  assert.equal((await call('GET', '/admin/')).status, 200);
  assert.equal((await call('GET', '/b/ABCD2345')).status, 200); // صفحهٔ پیگیری نوبت
  assert.equal((await call('GET', '/api/nothing')).status, 404);
});

test('مسیر عمومی: تنظیمات، خدمات، تقویم و زمان‌های خالی', async () => {
  const cfg = (await call('GET', '/api/public/config')).data;
  assert.equal(cfg.business.name, 'سالن تست');
  assert.deepEqual(cfg.today, { date: '2026-10-01', jy: 1405, jm: 7, jd: 9 });
  assert.equal(JSON.stringify(cfg).includes('kavenegar'), false);

  const { services } = (await call('GET', '/api/public/services')).data;
  assert.equal(services.length, 1);
  assert.equal(services[0].staff.length, 2);

  const cal = (await call('GET', '/api/public/calendar?jy=1405&jm=7')).data;
  assert.equal(cal.days.length, 30);
  assert.equal(cal.days[0].date, '2026-09-23');

  const days = (await call('GET', `/api/public/days?service=${ids.serviceId}&staff=any&jy=1405&jm=7`)).data;
  assert.ok(days.available.includes(SATURDAY));
  assert.ok(!days.available.includes('2026-09-23')); // گذشته
  assert.ok(!days.available.includes('2026-10-04')); // یکشنبه: ساعت کاری ندارد

  const slots = (await call('GET', `/api/public/slots?service=${ids.serviceId}&staff=any&date=${SATURDAY}`)).data;
  assert.equal(slots.slots[0].time, '09:00');
  assert.equal((await call('GET', `/api/public/slots?service=${ids.serviceId}&date=bad`)).status, 400);
  assert.equal((await call('GET', `/api/public/slots?service=999&date=${SATURDAY}`)).status, 400);
});

test('رزرو کامل مشتری، پیگیری با کد و لغو با کد تأیید پیامکی', async () => {
  const { updateSettings } = await import('../server/lib/settings.js');
  updateSettings(ctx.db, { sms_enabled: true });
  try {
    const body = { serviceId: ids.serviceId, staffId: 'any', date: SATURDAY, time: '10:00', name: 'علی رضایی', phone: '۰۹۱۲۳۴۵۶۷۸۹', notes: '' };
    const created = await call('POST', '/api/public/bookings', { body });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'confirmed');
    assert.match(created.data.code, /^[A-Z2-9]{8}$/);
    const code = created.data.code;

    const view = (await call('GET', `/api/public/bookings/${code}`)).data.booking;
    assert.equal(view.start, '10:00');
    assert.equal(view.dateLabel, '۱۱ مهر ۱۴۰۵');
    assert.equal(view.phoneMasked, '0912***6789');
    // نام و شمارهٔ کامل مشتری با کد پیگیری به‌تنهایی در دسترس نیست
    assert.equal(JSON.stringify(view).includes('09123456789'), false);
    assert.equal(JSON.stringify(view).includes('علی'), false);
    assert.equal(view.canCancel, true);

    // لغو بدون کد تأیید یا با کد غلط رد می‌شود
    assert.equal((await call('POST', `/api/public/bookings/${code}/cancel`, { body: {} })).status, 400);
    assert.equal((await call('POST', `/api/public/bookings/${code}/cancel`, { body: { otp: '000000' } })).status, 400);
    assert.equal((await call('GET', `/api/public/bookings/${code}`)).data.booking.status, 'confirmed');

    // کد به شمارهٔ ثبت‌شده در نوبت پیامک می‌شود
    const sent = await call('POST', `/api/public/bookings/${code}/cancel-code`, { body: {} });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.phoneMasked, '0912***6789');
    const otpSms = ctx.sentSms.filter((m) => m.kind === 'otp').at(-1);
    assert.equal(otpSms.phone, '09123456789');
    const otp = /\d{6}/.exec(otpSms.body)[0];

    const cancelled = await call('POST', `/api/public/bookings/${code}/cancel`, { body: { otp } });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.booking.status, 'cancelled');
    assert.equal((await call('GET', '/api/public/bookings/ZZZZZZZZ')).status, 404);
  } finally {
    updateSettings(ctx.db, { sms_enabled: false });
  }
});

test('اعتبارسنجی ورودی رزرو', async () => {
  const ok = { serviceId: ids.serviceId, staffId: 'any', date: SATURDAY, time: '11:00', name: 'سارا', phone: '09120000000' };
  assert.equal((await call('POST', '/api/public/bookings', { body: { ...ok, phone: '123' } })).status, 400);
  assert.equal((await call('POST', '/api/public/bookings', { body: { ...ok, name: '' } })).status, 400);
  assert.equal((await call('POST', '/api/public/bookings', { body: { ...ok, time: '25:00' } })).status, 400);
  assert.equal((await call('POST', '/api/public/bookings', { body: { ...ok, time: '08:00' } })).status, 409); // خارج ساعت کاری
  // درخواست غیر JSON (مثل فرم بین‌سایتی) رد می‌شود
  assert.equal((await call('POST', '/api/public/bookings', { json: false })).status, 415);
});

test('پرداخت آنلاین با درگاه آزمایشی از ابتدا تا انتها', async () => {
  const { updateSettings } = await import('../server/lib/settings.js');
  updateSettings(ctx.db, { payment_mode: 'deposit', deposit_percent: 50, payment_gateway: 'mock' });
  try {
    const created = await call('POST', '/api/public/bookings', {
      body: { serviceId: ids.serviceId, staffId: ids.staffIds[0], date: SATURDAY, time: '12:00', name: 'پرداخت‌کننده', phone: '09150000000' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'pending_payment');
    assert.match(created.data.paymentUrl, /\/pay\/mock\/MOCK/);

    const gatewayPath = new URL(created.data.paymentUrl).pathname;
    const page = await call('GET', gatewayPath);
    assert.equal(page.status, 200);
    assert.match(page.text, /پرداخت موفق/);

    const authority = gatewayPath.split('/').pop();
    const back = await call('GET', `/pay/callback?Authority=${authority}&Status=OK`);
    assert.equal(back.status, 302);
    assert.equal(back.res.headers.get('location'), `/b/${created.data.code}?pay=confirmed`);

    const view = (await call('GET', `/api/public/bookings/${created.data.code}`)).data.booking;
    assert.equal(view.status, 'confirmed');
    assert.equal(view.paid, 50_000);

    assert.equal((await call('GET', '/pay/mock/NOPE')).status, 404);
    assert.equal((await call('GET', '/pay/callback?Authority=NOPE&Status=OK')).res.headers.get('location'), '/');
  } finally {
    updateSettings(ctx.db, { payment_mode: 'none' });
  }
});

test('پنل مدیریت بدون ورود در دسترس نیست', async () => {
  for (const [method, path] of [['GET', '/api/admin/appointments'], ['GET', '/api/admin/settings'], ['POST', '/api/admin/services'], ['GET', '/api/admin/customers']]) {
    assert.equal((await call(method, path, { body: method === 'POST' ? {} : undefined })).status, 401, path);
  }
  const session = (await call('GET', '/api/admin/session')).data;
  assert.equal(session.admin, null);
  assert.equal(session.needsSetup, false);
});

test('ورود مدیر: گذرواژهٔ نادرست، ورود موفق، خروج', async () => {
  const bad = await call('POST', '/api/admin/login', { body: { username: 'owner', password: 'wrong' } });
  assert.equal(bad.status, 401);
  assert.equal((await call('POST', '/api/admin/login', { body: { username: 'nobody', password: 'x' } })).status, 401);

  const cookie = await login();
  const session = (await call('GET', '/api/admin/session', { cookie })).data;
  assert.equal(session.admin.username, 'owner');
  assert.match((await call('POST', '/api/admin/login', { body: { username: 'owner', password: ADMIN_PASSWORD } })).res.headers.get('set-cookie'), /HttpOnly/i);

  await call('POST', '/api/admin/logout', { cookie, body: {} });
  assert.equal((await call('GET', '/api/admin/appointments', { cookie })).status, 401);
});

test('مدیر: خدمت، پرسنل و ساعت کاری', async () => {
  const cookie = await login();
  const svc = await call('POST', '/api/admin/services', { cookie, body: { name: 'خدمت جدید', durationMin: 30, bufferMin: 5, price: 50_000, active: true } });
  assert.equal(svc.status, 201);
  assert.equal(svc.data.service.staffCount, 0);
  assert.equal((await call('POST', '/api/admin/services', { cookie, body: { name: '', durationMin: 30 } })).status, 400);
  assert.equal((await call('POST', '/api/admin/services', { cookie, body: { name: 'x', durationMin: 1 } })).status, 400);

  const overlap = await call('POST', '/api/admin/staff', {
    cookie,
    body: { name: 'نفر جدید', active: true, serviceIds: [svc.data.service.id], hours: [{ weekday: 0, start: '09:00', end: '12:00' }, { weekday: 0, start: '11:00', end: '14:00' }] },
  });
  assert.equal(overlap.status, 400);

  const staff = await call('POST', '/api/admin/staff', {
    cookie,
    body: { name: 'نفر جدید', title: 'آرایشگر', active: true, serviceIds: [svc.data.service.id], hours: [{ weekday: 0, start: '09:00', end: '12:00' }, { weekday: 0, start: '13:00', end: '17:00' }] },
  });
  assert.equal(staff.status, 201);
  assert.equal(staff.data.staff.hours.length, 2);

  const listed = (await call('GET', '/api/admin/services', { cookie })).data.services.find((s) => s.id === svc.data.service.id);
  assert.equal(listed.staffCount, 1);

  const slots = (await call('GET', `/api/public/slots?service=${svc.data.service.id}&staff=${staff.data.staff.id}&date=${SATURDAY}`)).data.slots;
  assert.equal(slots[0].time, '09:00');
  assert.ok(!slots.some((s) => s.time === '11:45')); // ۱۱:۴۵ + ۳۰ دقیقه به استراحت ناهار می‌خورد
  assert.ok(slots.some((s) => s.time === '13:00'));
});

test('مدیر: ثبت دستی، جابه‌جایی، تغییر وضعیت و تعطیلی', async () => {
  const cookie = await login();
  const created = await call('POST', '/api/admin/appointments', {
    cookie,
    body: { serviceId: ids.serviceId, staffId: ids.staffIds[1], date: SATURDAY, time: '09:00', name: 'مشتری حضوری', phone: '09130000000' },
  });
  assert.equal(created.status, 201);
  const id = created.data.appointment.id;

  const dup = await call('POST', '/api/admin/appointments', {
    cookie,
    body: { serviceId: ids.serviceId, staffId: ids.staffIds[1], date: SATURDAY, time: '09:30', name: 'دیگری', phone: '09140000000' },
  });
  assert.equal(dup.status, 409);

  const list = (await call('GET', `/api/admin/appointments?date=${SATURDAY}`, { cookie })).data.appointments;
  assert.ok(list.some((a) => a.id === id && a.customerPhone === '09130000000'));
  assert.equal((await call('GET', '/api/admin/appointments?q=حضوری', { cookie })).data.appointments.length, 1);

  const done = await call('PATCH', `/api/admin/appointments/${id}`, { cookie, body: { status: 'completed', paid: 100_000 } });
  assert.equal(done.data.appointment.status, 'completed');
  assert.equal((await call('PATCH', `/api/admin/appointments/${id}`, { cookie, body: { status: 'invalid' } })).status, 400);

  const off = await call('POST', '/api/admin/timeoff', {
    cookie, body: { staffId: null, dateFrom: SATURDAY, dateTo: SATURDAY, allDay: true, reason: 'تعطیلی' },
  });
  assert.equal(off.status, 201);
  assert.ok(off.data.conflicts >= 1); // نوبت‌های موجود در همان روز هشدار می‌دهند
  assert.deepEqual((await call('GET', `/api/public/slots?service=${ids.serviceId}&staff=any&date=${SATURDAY}`)).data.slots, []);
  await call('DELETE', `/api/admin/timeoff/${off.data.timeOff.id}`, { cookie, body: {} });
  assert.ok((await call('GET', `/api/public/slots?service=${ids.serviceId}&staff=any&date=${SATURDAY}`)).data.slots.length > 0);
});

test('مدیر: تنظیمات و پنهان ماندن کلیدها', async () => {
  const cookie = await login();
  const put = await call('PUT', '/api/admin/settings', { cookie, body: { settings: { business_name: 'نام جدید', kavenegar_api_key: 'abc123secret' } } });
  assert.equal(put.status, 200);
  assert.equal(put.data.settings.business_name, 'نام جدید');
  assert.equal(put.data.settings.kavenegar_api_key_set, true);
  assert.equal(JSON.stringify(put.data).includes('abc123secret'), false);
  assert.equal((await call('GET', '/api/public/config')).text.includes('abc123secret'), false);
  assert.equal((await call('PUT', '/api/admin/settings', { cookie, body: { settings: { payment_mode: 'x' } } })).status, 400);
});

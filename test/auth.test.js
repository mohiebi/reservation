import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { passwordProblem } from '../server/lib/auth.js';
import { addAdmin, loginAs, makeCtx, seed, startServer } from './helpers.js';

// گذرواژه‌های این فایل فقط برای تست‌اند
const PW = 'correct-horse-battery';
const HOUR = 3600_000;

let ctx;
let srv;
const { call } = {
  call: (...args) => srv.call(...args),
};

before(async () => {
  ctx = makeCtx({}, { loginPerIpUser: 1000, loginPerUser: 1000, loginPerIp: 1000, sensitiveAdmin: 1000 });
  seed(ctx);
  await addAdmin(ctx, { username: 'boss', password: PW, role: 'owner' });
  await addAdmin(ctx, { username: 'desk', password: PW, role: 'staff' });
  srv = await startServer(ctx);
});
after(() => srv.close());

test('سیاست گذرواژه', () => {
  assert.match(passwordProblem('short1'), /۱۰ حرف/);
  assert.match(passwordProblem('x'.repeat(129)), /۱۲۸/);
  assert.match(passwordProblem('myboss-secret-1', 'boss'), /نام کاربری/);
  assert.match(passwordProblem('aaaaaaaaaaaa'), /ساده/);
  assert.equal(passwordProblem('correct-horse-battery', 'boss'), null);
});

test('بدون ورود به هیچ بخش پنل دسترسی نیست و کد صفحه‌های پنل هم ارسال نمی‌شود', async () => {
  for (const path of ['appointments', 'customers', 'services', 'staff', 'timeoff', 'sms', 'settings', 'users', 'audit']) {
    assert.equal((await call('GET', `/api/admin/${path}`)).status, 401, path);
  }
  assert.equal((await call('POST', '/api/admin/logout-all', { body: {} })).status, 401);
  assert.equal((await call('GET', '/admin/')).status, 200); // فقط پوستهٔ ورود
  assert.equal((await call('GET', '/admin/pages/settings.js')).status, 401);
  assert.equal((await call('GET', '/admin/pages/appointments.js')).status, 401);

  const { cookie } = await loginAs(call, 'desk', PW);
  assert.equal((await call('GET', '/admin/pages/appointments.js', { cookie })).status, 200);
});

test('کوکی نشست: HttpOnly و SameSite=Strict و پاسخ بدون هش گذرواژه', async () => {
  const r = await loginAs(call, 'boss', PW);
  const setCookie = r.res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.equal(r.data.admin.role, 'owner');
  assert.equal(JSON.stringify(r.data).includes('scrypt'), false);
  const session = await call('GET', '/api/admin/session', { cookie: r.cookie });
  assert.equal(session.data.admin.username, 'boss');
  assert.equal(JSON.stringify(session.data).includes('scrypt'), false);
});

test('نقش‌ها: منشی فقط نوبت‌ها و مشتریان؛ مدیر کل همه‌چیز', async () => {
  const owner = (await loginAs(call, 'boss', PW)).cookie;
  const desk = (await loginAs(call, 'desk', PW)).cookie;

  for (const path of ['appointments', 'customers', 'services', 'staff']) {
    assert.equal((await call('GET', `/api/admin/${path}`, { cookie: desk })).status, 200, `desk GET ${path}`);
  }
  const blocked = [
    ['GET', 'timeoff'], ['GET', 'sms'], ['GET', 'settings'], ['GET', 'users'], ['GET', 'audit'],
    ['POST', 'services', { name: 'x', durationMin: 30 }], ['POST', 'staff', { name: 'xx' }],
    ['PUT', 'settings', { settings: { business_name: 'هک' } }], ['POST', 'users', { username: 'abc' }],
    ['POST', 'timeoff', { dateFrom: '2026-10-10', allDay: true }], ['DELETE', 'services/1', {}], ['DELETE', 'staff/1', {}],
  ];
  for (const [method, path, body] of blocked) {
    const r = await call(method, `/api/admin/${path}`, { cookie: desk, body });
    assert.equal(r.status, 403, `desk ${method} ${path}`);
  }
  // منشی می‌تواند کار روزمره را انجام دهد
  const appt = await call('POST', '/api/admin/appointments', {
    cookie: desk, body: { serviceId: 1, staffId: 1, date: '2026-10-03', time: '09:00', name: 'مشتری حضوری', phone: '09130000000' },
  });
  assert.equal(appt.status, 201);

  for (const path of ['timeoff', 'sms', 'settings', 'users', 'audit']) {
    assert.equal((await call('GET', `/api/admin/${path}`, { cookie: owner })).status, 200, `owner GET ${path}`);
  }
});

test('گذرواژهٔ موقت: تا تغییر آن هیچ بخشی باز نیست', async () => {
  const owner = (await loginAs(call, 'boss', PW)).cookie;
  const create = await call('POST', '/api/admin/users', { cookie: owner, body: { username: 'newbie', name: 'کاربر جدید', role: 'staff', password: 'temporary-pass-1' } });
  assert.equal(create.status, 201);
  assert.equal(create.data.user.mustChangePassword, true);

  const first = await loginAs(call, 'newbie', 'temporary-pass-1');
  assert.equal(first.status, 200);
  assert.equal(first.data.admin.mustChangePassword, true);

  const gated = await call('GET', '/api/admin/appointments', { cookie: first.cookie });
  assert.equal(gated.status, 403);
  assert.equal(gated.data.code, 'password_change_required');
  assert.equal((await call('GET', '/api/admin/session', { cookie: first.cookie })).data.admin.mustChangePassword, true);

  assert.equal((await call('POST', '/api/admin/password', { cookie: first.cookie, body: { current: 'wrong', next: 'a-fine-new-password' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { cookie: first.cookie, body: { current: 'temporary-pass-1', next: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { cookie: first.cookie, body: { current: 'temporary-pass-1', next: 'temporary-pass-1' } })).status, 400);

  const changed = await call('POST', '/api/admin/password', { cookie: first.cookie, body: { current: 'temporary-pass-1', next: 'a-fine-new-password' } });
  assert.equal(changed.status, 200);
  const fresh = changed.res.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/admin/appointments', { cookie: fresh })).status, 200);
  assert.equal((await call('GET', '/api/admin/appointments', { cookie: first.cookie })).status, 401); // نشست قبلی بسته شد
  assert.equal((await loginAs(call, 'newbie', 'temporary-pass-1')).status, 401);
  assert.equal((await loginAs(call, 'newbie', 'a-fine-new-password')).status, 200);
});

test('ساخت کاربر: اعتبارسنجی، تکراری و گذرواژهٔ ضعیف', async () => {
  const owner = (await loginAs(call, 'boss', PW)).cookie;
  const mk = (over) => call('POST', '/api/admin/users', { cookie: owner, body: { username: 'person', name: 'فلانی', role: 'staff', password: 'long-enough-pass', ...over } });
  assert.equal((await mk({ password: 'weak' })).status, 400);
  assert.equal((await mk({ username: 'bad name!' })).status, 400);
  assert.equal((await mk({ role: 'god' })).status, 400);
  assert.equal((await mk({ password: 'person-person-1' })).status, 400); // شامل نام کاربری
  assert.equal((await mk({})).status, 201);
  assert.equal((await mk({})).status, 409);
});

test('غیرفعال‌سازی و تغییر نقش فوراً نشست‌ها را می‌بندد', async () => {
  const owner = (await loginAs(call, 'boss', PW)).cookie;
  const users = (await call('GET', '/api/admin/users', { cookie: owner })).data.users;
  const desk = users.find((u) => u.username === 'desk');
  const deskCookie = (await loginAs(call, 'desk', PW)).cookie;
  assert.equal((await call('GET', '/api/admin/customers', { cookie: deskCookie })).status, 200);

  assert.equal((await call('PUT', `/api/admin/users/${desk.id}`, { cookie: owner, body: { active: false } })).status, 200);
  assert.equal((await call('GET', '/api/admin/customers', { cookie: deskCookie })).status, 401);
  const attempt = await loginAs(call, 'desk', PW);
  assert.equal(attempt.status, 401);
  // پیام همان پیام «گذرواژه نادرست» است تا غیرفعال بودن حساب لو نرود
  assert.equal(attempt.data.error, (await loginAs(call, 'desk', 'wrong-password-here')).data.error);

  assert.equal((await call('PUT', `/api/admin/users/${desk.id}`, { cookie: owner, body: { active: true } })).status, 200);
  assert.equal((await loginAs(call, 'desk', PW)).status, 200);
});

test('مدیر نمی‌تواند نقش/وضعیت خودش را عوض کند یا گذرواژهٔ خودش را از مسیر مدیریت کاربران بازنشانی کند', async () => {
  const owner = (await loginAs(call, 'boss', PW)).cookie;
  const me = (await call('GET', '/api/admin/users', { cookie: owner })).data.users.find((u) => u.username === 'boss');
  assert.equal((await call('PUT', `/api/admin/users/${me.id}`, { cookie: owner, body: { role: 'staff' } })).status, 409);
  assert.equal((await call('PUT', `/api/admin/users/${me.id}`, { cookie: owner, body: { active: false } })).status, 409);
  assert.equal((await call('POST', `/api/admin/users/${me.id}/password`, { cookie: owner, body: { password: 'another-long-pass' } })).status, 409);
  assert.equal((await call('PUT', `/api/admin/users/${me.id}`, { cookie: owner, body: { name: 'نام جدید' } })).status, 200); // تغییر نام مجاز است
  assert.equal((await call('PUT', '/api/admin/users/9999', { cookie: owner, body: { name: 'ناموجود' } })).status, 404);
});

test('بازنشانی گذرواژهٔ کاربر دیگر: نشست‌هایش بسته و تغییر اجباری می‌شود', async () => {
  const owner = (await loginAs(call, 'boss', PW)).cookie;
  const desk = (await call('GET', '/api/admin/users', { cookie: owner })).data.users.find((u) => u.username === 'desk');
  const deskCookie = (await loginAs(call, 'desk', PW)).cookie;

  assert.equal((await call('POST', `/api/admin/users/${desk.id}/password`, { cookie: owner, body: { password: 'weak' } })).status, 400);
  assert.equal((await call('POST', `/api/admin/users/${desk.id}/password`, { cookie: owner, body: { password: 'reset-by-owner-123' } })).status, 200);
  assert.equal((await call('GET', '/api/admin/customers', { cookie: deskCookie })).status, 401);
  assert.equal((await loginAs(call, 'desk', PW)).status, 401);
  const again = await loginAs(call, 'desk', 'reset-by-owner-123');
  assert.equal(again.status, 200);
  assert.equal(again.data.admin.mustChangePassword, true);
  // برگرداندن وضعیت برای تست‌های بعدی
  await call('POST', '/api/admin/password', { cookie: again.cookie, body: { current: 'reset-by-owner-123', next: PW } });
});

test('خروج از همهٔ دستگاه‌ها به‌جز همین مرورگر', async () => {
  const a = (await loginAs(call, 'boss', PW)).cookie;
  const b = (await loginAs(call, 'boss', PW)).cookie;
  assert.equal((await call('POST', '/api/admin/logout-all', { cookie: a, body: {} })).status, 200);
  assert.equal((await call('GET', '/api/admin/appointments', { cookie: a })).status, 200);
  assert.equal((await call('GET', '/api/admin/appointments', { cookie: b })).status, 401);
});

test('نشست: پایان بعد از بیکاری (۸ ساعت) و سقف عمر (۷ روز)، با تمدید در صورت فعالیت', async () => {
  const { cookie } = await loginAs(call, 'boss', PW);
  ctx.clock.current = new Date(ctx.clock.current.getTime() + 7 * HOUR);
  assert.equal((await call('GET', '/api/admin/appointments', { cookie })).status, 200); // فعالیت = تمدید
  ctx.clock.current = new Date(ctx.clock.current.getTime() + 7 * HOUR);
  assert.equal((await call('GET', '/api/admin/appointments', { cookie })).status, 200);
  ctx.clock.current = new Date(ctx.clock.current.getTime() + 9 * HOUR); // بیش از ۸ ساعت بیکار
  assert.equal((await call('GET', '/api/admin/appointments', { cookie })).status, 401);

  const long = (await loginAs(call, 'boss', PW)).cookie;
  let status = 200;
  for (let i = 0; i < 26 && status === 200; i++) { // هر ۷ ساعت یک بار فعال؛ مجموع بیش از ۷ روز
    ctx.clock.current = new Date(ctx.clock.current.getTime() + 7 * HOUR);
    status = (await call('GET', '/api/admin/appointments', { cookie: long })).status;
  }
  assert.equal(status, 401);
});

test('گزارش امنیتی: ورودها و تغییرها ثبت می‌شوند و کلیدهای محرمانه در آن نیست', async () => {
  const owner = (await loginAs(call, 'boss', PW)).cookie;
  await loginAs(call, 'ghost', 'whatever-password');
  await call('PUT', '/api/admin/settings', { cookie: owner, body: { settings: { business_name: 'نام آزمایشی', kavenegar_api_key: 'SUPER-SECRET-KEY' } } });

  const { events } = (await call('GET', '/api/admin/audit', { cookie: owner })).data;
  const actions = events.map((e) => e.action);
  for (const a of ['login_ok', 'login_failed', 'user_created', 'password_changed', 'user_updated', 'settings_changed']) {
    assert.ok(actions.includes(a), `missing ${a}`);
  }
  const failed = events.find((e) => e.action === 'login_failed' && e.detail === 'ghost');
  assert.ok(failed);
  assert.ok(failed.ip);
  const settingsEvent = events.find((e) => e.action === 'settings_changed');
  assert.match(settingsEvent.detail, /business_name/);
  assert.match(settingsEvent.detail, /kavenegar_api_key/);
  assert.equal(JSON.stringify(events).includes('SUPER-SECRET-KEY'), false);
  assert.equal(JSON.stringify(events).includes(PW), false);
});

test('محدودیت تلاش ورود: هر IP+نام، هر نام، و هر IP (سه لایه)', async () => {
  async function attempts(limits, users) {
    const c = makeCtx({}, limits);
    await addAdmin(c, { username: 'victim', password: PW });
    const s = await startServer(c);
    try {
      const statuses = [];
      for (const u of users) statuses.push((await loginAs(s.call, u, u === 'victim' ? 'wrong-password-x' : 'whatever-pass')).status);
      // پس از قفل شدن حتی گذرواژهٔ درست هم پذیرفته نمی‌شود
      const correct = (await loginAs(s.call, 'victim', PW)).status;
      c.clock.current = new Date(c.clock.current.getTime() + 16 * 60_000);
      const later = (await loginAs(s.call, 'victim', PW)).status;
      return { statuses, correct, later };
    } finally {
      s.close();
    }
  }
  const big = 1000;
  // لایهٔ ۱: IP + نام کاربری
  let r = await attempts({ loginPerIpUser: 3, loginPerUser: big, loginPerIp: big }, ['victim', 'victim', 'victim', 'victim']);
  assert.deepEqual(r.statuses, [401, 401, 401, 429]);
  assert.equal(r.correct, 429);
  assert.equal(r.later, 200); // بعد از ۱۵ دقیقه آزاد می‌شود
  // لایهٔ ۲: فقط نام کاربری (حملهٔ توزیع‌شده از IPهای مختلف)
  r = await attempts({ loginPerIpUser: big, loginPerUser: 3, loginPerIp: big }, ['victim', 'Victim', 'VICTIM', 'victim']);
  assert.deepEqual(r.statuses, [401, 401, 401, 429]);
  assert.equal(r.correct, 429);
  // لایهٔ ۳: فقط IP (امتحان کردن نام‌های مختلف)
  r = await attempts({ loginPerIpUser: big, loginPerUser: big, loginPerIp: 3 }, ['a1', 'a2', 'a3', 'a4']);
  assert.deepEqual(r.statuses, [401, 401, 401, 429]);
  assert.equal(r.correct, 429);
});

test('لایهٔ دوم: حساب غیرفعال‌شده حتی اگر نشستش مانده باشد (مثلاً تغییر مستقیم دیتابیس) بسته است', async () => {
  const { cookie } = await loginAs(call, 'desk', PW);
  assert.equal((await call('GET', '/api/admin/customers', { cookie })).status, 200);
  ctx.db.prepare("UPDATE admins SET active = 0 WHERE username = 'desk'").run();
  assert.equal((await call('GET', '/api/admin/customers', { cookie })).status, 401);
  assert.equal((await call('GET', '/admin/pages/customers.js', { cookie })).status, 401);
  ctx.db.prepare("UPDATE admins SET active = 1 WHERE username = 'desk'").run();
});

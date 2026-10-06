import { createApp, createContext } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { updateSettings } from '../server/lib/settings.js';

// پنج‌شنبه ۱ اکتبر ۲۰۲۶ ساعت ۱۰:۰۰ به وقت تهران (۹ مهر ۱۴۰۵)
export const START = new Date('2026-10-01T06:30:00Z');
export const SATURDAY = '2026-10-03'; // شنبه = weekday 0
export const SUNDAY = '2026-10-04';

/** زمینهٔ تست با دیتابیس حافظه‌ای و ساعت قابل‌تنظیم */
export function makeCtx(settings = {}, limits = {}) {
  const db = openDatabase(':memory:');
  const clock = { current: new Date(START) };
  const ctx = createContext({ db, now: () => new Date(clock.current), limits });
  ctx.clock = clock;
  ctx.sentSms = [];
  ctx.sendSms = async (args) => { ctx.sentSms.push(args); return { status: 'simulated' }; };
  if (Object.keys(settings).length) updateSettings(db, settings);
  return ctx;
}

/** یک خدمت ۶۰ دقیقه‌ای و دو نفر پرسنل که شنبه‌ها ۹ تا ۱۳ کار می‌کنند */
export function seed(ctx, { duration = 60, buffer = 0, price = 100_000 } = {}) {
  const { db } = ctx;
  const serviceId = Number(db.prepare('INSERT INTO services (name, duration_min, buffer_min, price) VALUES (?, ?, ?, ?)').run('کوتاهی', duration, buffer, price).lastInsertRowid);
  const staffIds = ['الف', 'ب'].map((name) => {
    const id = Number(db.prepare('INSERT INTO staff (name) VALUES (?)').run(name).lastInsertRowid);
    db.prepare('INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)').run(id, serviceId);
    db.prepare('INSERT INTO working_hours (staff_id, weekday, start_min, end_min) VALUES (?, 0, ?, ?)').run(id, 9 * 60, 13 * 60);
    return id;
  });
  return { serviceId, staffIds };
}

export const customer = (n = 1) => ({ name: `مشتری ${n}`, phone: `0912000000${n}`, notes: '' });

/** سرور HTTP واقعی روی پورت تصادفی؛ call(method, path, { body, cookie }) پاسخ را به‌صورت { status, data, res, text } برمی‌گرداند */
export async function startServer(ctx) {
  const server = createApp(ctx).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, { body, cookie, json = true } = {}) {
    const headers = {};
    if (json) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* پاسخ غیر JSON */ }
    return { status: res.status, data, res, text };
  }
  return { call, base, close: () => server.close() };
}

/** مدیر مستقیم در دیتابیس ساخته می‌شود (بدون HTTP)؛ گذرواژه‌ها فقط برای تست هستند */
export async function addAdmin(ctx, { username, password, role = 'owner', mustChange = false, active = true }) {
  const { hashPassword } = await import('../server/lib/auth.js');
  const r = ctx.db
    .prepare('INSERT INTO admins (username, name, role, password_hash, must_change_password, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(username, username, role, await hashPassword(password), mustChange ? 1 : 0, active ? 1 : 0, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export async function loginAs(call, username, password) {
  const r = await call('POST', '/api/admin/login', { body: { username, password } });
  return { ...r, cookie: r.res.headers.get('set-cookie')?.split(';')[0] };
}

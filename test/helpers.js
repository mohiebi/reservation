import { createContext } from '../server/app.js';
import { openDatabase } from '../server/db.js';
import { updateSettings } from '../server/lib/settings.js';

// پنج‌شنبه ۱ اکتبر ۲۰۲۶ ساعت ۱۰:۰۰ به وقت تهران (۹ مهر ۱۴۰۵)
export const START = new Date('2026-10-01T06:30:00Z');
export const SATURDAY = '2026-10-03'; // شنبه = weekday 0
export const SUNDAY = '2026-10-04';

/** زمینهٔ تست با دیتابیس حافظه‌ای و ساعت قابل‌تنظیم */
export function makeCtx(settings = {}) {
  const db = openDatabase(':memory:');
  const clock = { current: new Date(START) };
  const ctx = createContext({ db, now: () => new Date(clock.current) });
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

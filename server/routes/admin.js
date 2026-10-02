import { Router } from 'express';
import { findSlots } from '../lib/availability.js';
import {
  clearSessionCookie, createSession, destroySession, findSession, hashPassword,
  readCookie, requireAdmin, setSessionCookie, verifyPassword,
} from '../lib/auth.js';
import { adminView, cancelAppointment, createBooking, getAppointment, listAppointments, updateAppointment } from '../lib/booking.js';
import { config } from '../config.js';
import { tx } from '../db.js';
import { HttpError, badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { describeDate } from '../lib/jalali.js';
import { rateLimit } from '../lib/ratelimit.js';
import { adminSettingsView, getSettings, updateSettings } from '../lib/settings.js';
import { localNow, minToHHMM } from '../lib/time.js';
import * as v from '../lib/validate.js';
import { loadService, parseStaffParam } from './public.js';

const STATUSES = ['pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show'];
let dummyHash;

function serviceView(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    durationMin: row.duration_min,
    bufferMin: row.buffer_min,
    price: row.price,
    active: Boolean(row.active),
    staffCount: row.staff_count ?? 0,
  };
}

function parseService(b) {
  return {
    name: v.text(b.name, 'نام خدمت', { min: 1, max: 60 }),
    description: v.multiline(b.description, 'توضیحات', { max: 300 }),
    duration: v.int(b.durationMin, 'مدت خدمت', { min: 5, max: 720 }),
    buffer: v.int(b.bufferMin ?? 0, 'زمان استراحت', { min: 0, max: 240 }),
    price: v.int(b.price ?? 0, 'قیمت', { min: 0, max: 1_000_000_000 }),
    active: v.bool(b.active) ? 1 : 0,
  };
}

function parseHours(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 100) throw badRequest('ساعت کاری معتبر نیست.');
  const rows = list.map((h) => {
    const weekday = v.int(h.weekday, 'روز هفته', { min: 0, max: 6 });
    const start = v.time(h.start, 'ساعت شروع');
    const end = h.end === '24:00' ? 1440 : v.time(h.end, 'ساعت پایان');
    if (start >= end) throw badRequest('ساعت پایان باید بعد از ساعت شروع باشد.');
    return { weekday, start, end };
  });
  rows.sort((a, b) => a.weekday - b.weekday || a.start - b.start);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].weekday === rows[i - 1].weekday && rows[i].start < rows[i - 1].end) {
      throw badRequest('بازه‌های کاری یک روز نباید هم‌پوشانی داشته باشند.');
    }
  }
  return rows;
}

export function adminRoutes(ctx) {
  const { db } = ctx;
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    keyFn: (req) => `${req.ip}:${String(req.body?.username ?? '').toLowerCase()}`,
    message: 'تلاش‌های ناموفق زیاد بود. ۱۵ دقیقه بعد دوباره امتحان کنید.',
  });

  // ---------- ورود و خروج ----------

  router.get('/session', (req, res) => {
    const admin = findSession(db, readCookie(req), ctx.now().getTime());
    const needsSetup = !db.prepare('SELECT 1 FROM admins LIMIT 1').get();
    res.json({ admin, needsSetup });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    dummyHash ??= await hashPassword('dummy-password');
    const ok = await verifyPassword(password, row?.password_hash ?? dummyHash); // زمان پاسخ برای کاربر ناموجود هم یکسان است
    if (!row || !ok) throw unauthorized('نام کاربری یا گذرواژه درست نیست.');
    const { token, expiresAt } = createSession(db, row.id, ctx.now().getTime(), config.sessionDays);
    setSessionCookie(res, token, expiresAt, config.cookieSecure);
    res.json({ admin: { id: row.id, username: row.username, name: row.name } });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, readCookie(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---------- از اینجا به بعد ورود لازم است ----------
  router.use(requireAdmin(ctx));

  router.post('/password', async (req, res) => {
    const current = String(req.body?.current ?? '');
    const next = String(req.body?.next ?? '');
    if (next.length < 8) throw badRequest('گذرواژهٔ جدید باید حداقل ۸ حرف باشد.');
    const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
    if (!(await verifyPassword(current, row.password_hash))) throw badRequest('گذرواژهٔ فعلی درست نیست.');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(await hashPassword(next), row.id);
    // همهٔ نشست‌های قبلی بسته می‌شوند و یک نشست تازه برای همین مرورگر صادر می‌شود
    db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(row.id);
    const { token, expiresAt } = createSession(db, row.id, ctx.now().getTime(), config.sessionDays);
    setSessionCookie(res, token, expiresAt, config.cookieSecure);
    res.json({ ok: true });
  });

  // ---------- نوبت‌ها ----------

  router.get('/appointments', (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 50);
    const rows = listAppointments(db, {
      date: !q && req.query.date ? v.date(req.query.date) : undefined,
      from: req.query.from ? v.date(req.query.from) : undefined,
      to: req.query.to ? v.date(req.query.to) : undefined,
      staffId: req.query.staff ? v.int(req.query.staff, 'پرسنل', { min: 1 }) : undefined,
      status: req.query.status ? v.oneOf(String(req.query.status), STATUSES, 'وضعیت') : undefined,
      q,
      limit: q ? 100 : 500,
    });
    res.json({ appointments: rows.map(adminView) });
  });

  router.get('/slots', (req, res) => {
    const service = loadService(ctx, v.int(req.query.service, 'خدمت', { min: 1 }), { activeOnly: false });
    const excludeId = req.query.exclude ? v.int(req.query.exclude, 'نوبت', { min: 1 }) : null;
    const slots = findSlots(ctx, {
      service, staffId: parseStaffParam(req.query.staff), date: v.date(req.query.date), admin: true, excludeId,
    });
    res.json({ slots: slots.map((s) => ({ start: s.start, time: minToHHMM(s.start), staffId: s.staffId })) });
  });

  router.post('/appointments', (req, res) => {
    const b = req.body ?? {};
    const appt = createBooking(
      ctx,
      {
        serviceId: v.int(b.serviceId, 'خدمت', { min: 1 }),
        staffId: v.int(b.staffId, 'پرسنل', { min: 1 }),
        date: v.date(b.date),
        startMin: v.time(b.time),
        name: v.text(b.name, 'نام مشتری', { min: 2, max: 60 }),
        phone: v.phone(b.phone),
        notes: v.multiline(b.notes, 'یادداشت', { max: 300 }),
      },
      { source: 'admin' },
    );
    res.status(201).json({ appointment: adminView(appt) });
  });

  router.patch('/appointments/:id', (req, res) => {
    const b = req.body ?? {};
    const id = v.int(req.params.id, 'نوبت', { min: 1 });
    const patch = { notify: v.bool(b.notify) };
    if (b.status !== undefined) patch.status = v.oneOf(b.status, STATUSES, 'وضعیت');
    if (b.date !== undefined) patch.date = v.date(b.date);
    if (b.time !== undefined) patch.startMin = v.time(b.time);
    if (b.staffId !== undefined) patch.staffId = v.int(b.staffId, 'پرسنل', { min: 1 });
    if (b.notes !== undefined) patch.notes = v.multiline(b.notes, 'یادداشت', { max: 300 });
    if (b.paid !== undefined) patch.paid = v.int(b.paid, 'مبلغ پرداخت‌شده', { min: 0, max: 1_000_000_000 });
    if (b.price !== undefined) patch.price = v.int(b.price, 'قیمت', { min: 0, max: 1_000_000_000 });
    res.json({ appointment: adminView(updateAppointment(ctx, id, patch)) });
  });

  router.delete('/appointments/:id', (req, res) => {
    const id = v.int(req.params.id, 'نوبت', { min: 1 });
    if (!getAppointment(db, id)) throw notFound('نوبت پیدا نشد.');
    cancelAppointment(ctx, id, { reason: 'admin', notify: v.bool(req.query.notify) });
    res.json({ appointment: adminView(getAppointment(db, id)) });
  });

  // ---------- خدمات ----------

  const SERVICE_SELECT = `
    SELECT s.*, (SELECT COUNT(*) FROM staff_services ss JOIN staff st ON st.id = ss.staff_id
                 WHERE ss.service_id = s.id AND st.active = 1) AS staff_count
    FROM services s`;

  router.get('/services', (_req, res) => {
    res.json({ services: db.prepare(`${SERVICE_SELECT} ORDER BY s.sort_order, s.id`).all().map(serviceView) });
  });

  router.post('/services', (req, res) => {
    const s = parseService(req.body ?? {});
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM services').get().m;
    const r = db
      .prepare('INSERT INTO services (name, description, duration_min, buffer_min, price, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.name, s.description, s.duration, s.buffer, s.price, s.active, max + 1);
    res.status(201).json({ service: serviceView(db.prepare(`${SERVICE_SELECT} WHERE s.id = ?`).get(Number(r.lastInsertRowid))) });
  });

  router.put('/services/:id', (req, res) => {
    const id = v.int(req.params.id, 'خدمت', { min: 1 });
    const s = parseService(req.body ?? {});
    const r = db
      .prepare('UPDATE services SET name = ?, description = ?, duration_min = ?, buffer_min = ?, price = ?, active = ? WHERE id = ?')
      .run(s.name, s.description, s.duration, s.buffer, s.price, s.active, id);
    if (!r.changes) throw notFound('خدمت پیدا نشد.');
    res.json({ service: serviceView(db.prepare(`${SERVICE_SELECT} WHERE s.id = ?`).get(id)) });
  });

  router.delete('/services/:id', (req, res) => {
    const id = v.int(req.params.id, 'خدمت', { min: 1 });
    if (db.prepare('SELECT 1 FROM appointments WHERE service_id = ? LIMIT 1').get(id)) {
      throw conflict('برای این خدمت نوبت ثبت شده است. به‌جای حذف، آن را غیرفعال کنید.');
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- پرسنل ----------

  function staffView(row) {
    const hours = db.prepare('SELECT weekday, start_min, end_min FROM working_hours WHERE staff_id = ? ORDER BY weekday, start_min').all(row.id);
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      phone: row.phone,
      active: Boolean(row.active),
      serviceIds: db.prepare('SELECT service_id FROM staff_services WHERE staff_id = ?').all(row.id).map((r) => r.service_id),
      hours: hours.map((h) => ({ weekday: h.weekday, start: minToHHMM(h.start_min), end: h.end_min === 1440 ? '24:00' : minToHHMM(h.end_min) })),
    };
  }

  function saveStaff(id, b) {
    const name = v.text(b.name, 'نام', { min: 2, max: 60 });
    const title = v.text(b.title, 'عنوان', { max: 60 });
    const phone = b.phone ? v.phone(b.phone) : '';
    const active = v.bool(b.active) ? 1 : 0;
    const hours = parseHours(b.hours);
    const serviceIds = [...new Set((Array.isArray(b.serviceIds) ? b.serviceIds : []).map((x) => v.int(x, 'خدمت', { min: 1 })))];
    for (const sid of serviceIds) if (!db.prepare('SELECT 1 FROM services WHERE id = ?').get(sid)) throw badRequest('خدمت انتخاب‌شده معتبر نیست.');

    return tx(db, () => {
      if (id == null) {
        const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM staff').get().m;
        id = Number(db.prepare('INSERT INTO staff (name, title, phone, active, sort_order) VALUES (?, ?, ?, ?, ?)').run(name, title, phone, active, max + 1).lastInsertRowid);
      } else {
        const r = db.prepare('UPDATE staff SET name = ?, title = ?, phone = ?, active = ? WHERE id = ?').run(name, title, phone, active, id);
        if (!r.changes) throw notFound('پرسنل پیدا نشد.');
      }
      db.prepare('DELETE FROM staff_services WHERE staff_id = ?').run(id);
      for (const sid of serviceIds) db.prepare('INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)').run(id, sid);
      db.prepare('DELETE FROM working_hours WHERE staff_id = ?').run(id);
      for (const h of hours) db.prepare('INSERT INTO working_hours (staff_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)').run(id, h.weekday, h.start, h.end);
      return id;
    });
  }

  router.get('/staff', (_req, res) => {
    res.json({ staff: db.prepare('SELECT * FROM staff ORDER BY sort_order, id').all().map(staffView) });
  });

  router.post('/staff', (req, res) => {
    const id = saveStaff(null, req.body ?? {});
    res.status(201).json({ staff: staffView(db.prepare('SELECT * FROM staff WHERE id = ?').get(id)) });
  });

  router.put('/staff/:id', (req, res) => {
    const id = saveStaff(v.int(req.params.id, 'پرسنل', { min: 1 }), req.body ?? {});
    res.json({ staff: staffView(db.prepare('SELECT * FROM staff WHERE id = ?').get(id)) });
  });

  router.delete('/staff/:id', (req, res) => {
    const id = v.int(req.params.id, 'پرسنل', { min: 1 });
    if (db.prepare('SELECT 1 FROM appointments WHERE staff_id = ? LIMIT 1').get(id)) {
      throw conflict('برای این فرد نوبت ثبت شده است. به‌جای حذف، او را غیرفعال کنید.');
    }
    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- مرخصی و تعطیلات ----------

  function timeOffView(row) {
    return {
      id: row.id,
      staffId: row.staff_id,
      staffName: row.staff_name ?? null,
      dateFrom: row.date_from,
      dateTo: row.date_to,
      fromLabel: describeDate(row.date_from).dateLabel,
      toLabel: describeDate(row.date_to).dateLabel,
      start: row.start_min == null ? null : minToHHMM(row.start_min),
      end: row.end_min == null ? null : minToHHMM(row.end_min),
      reason: row.reason,
    };
  }

  router.get('/timeoff', (_req, res) => {
    const today = localNow(ctx.now(), ctx.settings().timezone).date;
    const rows = db
      .prepare(
        `SELECT t.*, s.name AS staff_name FROM time_off t LEFT JOIN staff s ON s.id = t.staff_id
         WHERE t.date_to >= ? ORDER BY t.date_from, t.id`,
      )
      .all(today);
    res.json({ timeOff: rows.map(timeOffView) });
  });

  router.post('/timeoff', (req, res) => {
    const b = req.body ?? {};
    const staffId = b.staffId == null || b.staffId === '' ? null : v.int(b.staffId, 'پرسنل', { min: 1 });
    if (staffId != null && !db.prepare('SELECT 1 FROM staff WHERE id = ?').get(staffId)) throw badRequest('پرسنل معتبر نیست.');
    const dateFrom = v.date(b.dateFrom, 'تاریخ شروع');
    const dateTo = v.date(b.dateTo ?? b.dateFrom, 'تاریخ پایان');
    if (dateTo < dateFrom) throw badRequest('تاریخ پایان باید بعد از تاریخ شروع باشد.');
    let start = null;
    let end = null;
    if (!v.bool(b.allDay)) {
      start = v.time(b.start, 'ساعت شروع');
      end = v.time(b.end, 'ساعت پایان');
      if (start >= end) throw badRequest('ساعت پایان باید بعد از ساعت شروع باشد.');
    }
    const reason = v.text(b.reason, 'دلیل', { max: 100 });
    const r = db
      .prepare('INSERT INTO time_off (staff_id, date_from, date_to, start_min, end_min, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(staffId, dateFrom, dateTo, start, end, reason);

    // تعداد نوبت‌های فعالی که در این بازه افتاده‌اند، تا مدیر هشدار بگیرد
    const clash = db
      .prepare(
        `SELECT COUNT(*) AS n FROM appointments
         WHERE status IN ('confirmed','pending_payment') AND date BETWEEN ? AND ?
           AND (? IS NULL OR staff_id = ?)
           AND (? IS NULL OR (start_min < ? AND end_min > ?))`,
      )
      .get(dateFrom, dateTo, staffId, staffId, start, end, start).n;

    const row = db.prepare('SELECT t.*, s.name AS staff_name FROM time_off t LEFT JOIN staff s ON s.id = t.staff_id WHERE t.id = ?').get(Number(r.lastInsertRowid));
    res.status(201).json({ timeOff: timeOffView(row), conflicts: clash });
  });

  router.delete('/timeoff/:id', (req, res) => {
    db.prepare('DELETE FROM time_off WHERE id = ?').run(v.int(req.params.id, 'مورد', { min: 1 }));
    res.json({ ok: true });
  });

  // ---------- مشتریان ----------

  router.get('/customers', (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 50).replace(/[%_]/g, '');
    const like = `%${q}%`;
    const rows = db
      .prepare(
        `SELECT c.*, COUNT(a.id) AS visits, MAX(a.date) AS last_date
         FROM customers c LEFT JOIN appointments a ON a.customer_id = c.id AND a.status != 'cancelled'
         WHERE ? = '' OR c.name LIKE ? OR c.phone LIKE ?
         GROUP BY c.id ORDER BY MAX(a.date) DESC, c.id DESC LIMIT 200`,
      )
      .all(q, like, like);
    res.json({
      customers: rows.map((c) => ({
        id: c.id, name: c.name, phone: c.phone, notes: c.notes, visits: c.visits,
        lastDate: c.last_date, lastLabel: c.last_date ? describeDate(c.last_date).dateLabel : '',
      })),
    });
  });

  router.get('/customers/:id', (req, res) => {
    const id = v.int(req.params.id, 'مشتری', { min: 1 });
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) throw notFound('مشتری پیدا نشد.');
    const appointments = db
      .prepare('SELECT id FROM appointments WHERE customer_id = ? ORDER BY date DESC, start_min DESC LIMIT 100')
      .all(id)
      .map((r) => adminView(getAppointment(db, r.id)));
    res.json({ customer: { id: c.id, name: c.name, phone: c.phone, notes: c.notes }, appointments });
  });

  router.put('/customers/:id', (req, res) => {
    const id = v.int(req.params.id, 'مشتری', { min: 1 });
    const name = v.text(req.body?.name, 'نام', { min: 2, max: 60 });
    const notes = v.multiline(req.body?.notes, 'یادداشت', { max: 500 });
    const r = db.prepare('UPDATE customers SET name = ?, notes = ? WHERE id = ?').run(name, notes, id);
    if (!r.changes) throw notFound('مشتری پیدا نشد.');
    res.json({ ok: true });
  });

  // ---------- پیامک و تنظیمات ----------

  router.get('/sms', (_req, res) => {
    res.json({ sms: db.prepare('SELECT * FROM sms_log ORDER BY id DESC LIMIT 100').all() });
  });

  router.get('/settings', (_req, res) => {
    res.json({ settings: adminSettingsView(getSettings(db)) });
  });

  router.put('/settings', (req, res) => {
    try {
      updateSettings(db, req.body?.settings ?? req.body);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    res.json({ settings: adminSettingsView(getSettings(db)) });
  });

  return router;
}

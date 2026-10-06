import crypto from 'node:crypto';
import { tx } from '../db.js';
import { findSlots, hasOverlap, qualifiedStaff } from './availability.js';
import { badRequest, conflict, notFound } from './errors.js';
import { describeDate } from './jalali.js';
import { maskPhone, otpAvailable } from './otp.js';
import { notifyAppointment } from './sms.js';
import { epochMinutes, localNow, minToHHMM } from './time.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون حروف و ارقام شبیه هم (I, O, 0, 1)

function generateCode(db) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM appointments WHERE code = ?').get(code)) return code;
  }
  throw new Error('could not generate a unique code');
}

const SELECT = `
  SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, s.name AS staff_name
  FROM appointments a
  JOIN customers c ON c.id = a.customer_id
  JOIN staff s ON s.id = a.staff_id`;

export const getAppointment = (db, id) => db.prepare(`${SELECT} WHERE a.id = ?`).get(id) ?? null;
export const getAppointmentByCode = (db, code) => db.prepare(`${SELECT} WHERE a.code = ?`).get(String(code).toUpperCase()) ?? null;

export function listAppointments(db, { date, from, to, staffId, status, q, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (date) { where.push('a.date = ?'); args.push(date); }
  if (from) { where.push('a.date >= ?'); args.push(from); }
  if (to) { where.push('a.date <= ?'); args.push(to); }
  if (staffId) { where.push('a.staff_id = ?'); args.push(staffId); }
  if (status) { where.push('a.status = ?'); args.push(status); }
  if (q) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR a.code LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like.toUpperCase());
  }
  const order = date ? 'ORDER BY a.start_min, a.id' : 'ORDER BY a.date DESC, a.start_min DESC';
  return db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${order} LIMIT ?`).all(...args, limit);
}

export function adminView(a) {
  return {
    id: a.id,
    code: a.code,
    status: a.status,
    date: a.date,
    ...describeDate(a.date),
    startMin: a.start_min,
    endMin: a.end_min,
    start: minToHHMM(a.start_min),
    end: minToHHMM(a.end_min),
    serviceId: a.service_id,
    serviceName: a.service_name,
    staffId: a.staff_id,
    staffName: a.staff_name,
    customerId: a.customer_id,
    customerName: a.customer_name,
    customerPhone: a.customer_phone,
    price: a.price,
    deposit: a.deposit,
    paid: a.paid,
    notes: a.notes,
    source: a.source,
    cancelReason: a.cancel_reason,
    createdAt: a.created_at,
  };
}

export function canCustomerCancel(ctx, a) {
  if (a.status === 'pending_payment') return true;
  if (a.status !== 'confirmed') return false;
  const s = ctx.settings();
  const local = localNow(ctx.now(), s.timezone);
  const minutesLeft = epochMinutes(a.date, a.start_min) - epochMinutes(local.date, local.minutes);
  return minutesLeft >= s.cancel_before_hours * 60;
}

/**
 * نمایی که هر کسی با کد پیگیری می‌بیند. نام و شمارهٔ کامل مشتری و یادداشت‌های داخلی در آن نیست؛
 * فقط شمارهٔ ماسک‌شده می‌آید تا مشتری بداند کد تأیید به کدام شماره پیامک می‌شود.
 */
export function publicView(ctx, a) {
  const s = ctx.settings();
  const nowMs = ctx.now().getTime();
  return {
    code: a.code,
    status: a.status,
    serviceName: a.service_name,
    staffName: a.staff_name,
    phoneMasked: maskPhone(a.customer_phone),
    date: a.date,
    ...describeDate(a.date),
    start: minToHHMM(a.start_min),
    end: minToHHMM(a.end_min),
    price: a.price,
    deposit: a.deposit,
    paid: a.paid,
    amountDue: Math.max(0, a.deposit - a.paid),
    holdSecondsLeft: a.status === 'pending_payment' ? Math.max(0, Math.floor((a.hold_until - nowMs) / 1000)) : 0,
    canCancel: canCustomerCancel(ctx, a), // طبق قانون مهلت لغو
    cancelNeedsCode: otpAvailable(s), // اگر false باشد لغو آنلاین ممکن نیست و باید تماس بگیرند
    cancelBeforeHours: s.cancel_before_hours,
    cancelPolicy: s.cancel_policy,
    business: { name: s.business_name, phone: s.business_phone, address: s.business_address },
  };
}

function requiredDeposit(settings, price) {
  if (settings.payment_mode === 'none' || price <= 0) return 0;
  if (settings.payment_mode === 'full') return price;
  const amount = Math.ceil((price * settings.deposit_percent) / 100);
  return Math.min(price, Math.max(amount, 1000)); // حداقل مبلغ درگاه‌ها معمولاً ۱۰٬۰۰۰ ریال است
}

function reminderAlreadyDue(settings, date, startMin, local) {
  if (settings.reminder_hours === 0) return 1;
  const minutesLeft = epochMinutes(date, startMin) - epochMinutes(local.date, local.minutes);
  return minutesLeft <= settings.reminder_hours * 60 ? 1 : 0;
}

/**
 * ثبت نوبت.
 * source = 'online': زمان باید دقیقاً یکی از زمان‌های خالی عمومی باشد و محدودیت‌ها اعمال می‌شود.
 * source = 'admin': فقط تداخل با نوبت‌های دیگر بررسی می‌شود (مدیر می‌تواند ساعت دلخواه بدهد).
 */
export function createBooking(ctx, input, { source = 'online' } = {}) {
  const { db } = ctx;
  const settings = ctx.settings();
  const nowDate = ctx.now();
  const nowMs = nowDate.getTime();
  const local = localNow(nowDate, settings.timezone);

  const id = tx(db, () => {
    const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(input.serviceId);
    if (!service) throw badRequest('خدمت انتخاب‌شده معتبر نیست.');

    let staffId = input.staffId ?? null;
    const endMin = input.startMin + service.duration_min;

    if (source === 'online') {
      const slot = findSlots(ctx, { service, staffId, date: input.date }).find((s) => s.start === input.startMin);
      if (!slot) throw conflict('این زمان دیگر در دسترس نیست. لطفاً زمان دیگری انتخاب کنید.');
      staffId = slot.staffId;
    } else {
      if (staffId == null) throw badRequest('پرسنل را انتخاب کنید.');
      if (endMin > 1440) throw badRequest('نوبت نمی‌تواند از نیمه‌شب بگذرد.');
      if (!qualifiedStaff(db, service.id, staffId).length) throw badRequest('این فرد این خدمت را انجام نمی‌دهد.');
      if (hasOverlap(db, { staffId, date: input.date, startMin: input.startMin, endMin, bufferMin: service.buffer_min, nowMs })) {
        throw conflict('در این زمان نوبت دیگری برای این فرد ثبت شده است.');
      }
    }

    let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(input.phone);

    if (source === 'online' && customer) {
      const active = db
        .prepare(
          `SELECT COUNT(*) AS n FROM appointments
           WHERE customer_id = ? AND (status = 'confirmed' OR (status = 'pending_payment' AND hold_until > ?))
             AND (date > ? OR (date = ? AND end_min > ?))`,
        )
        .get(customer.id, nowMs, local.date, local.date, local.minutes).n;
      if (active >= settings.max_active_per_phone) {
        throw conflict(`با این شماره بیش از ${settings.max_active_per_phone} نوبت فعال نمی‌توانید داشته باشید. برای نوبت جدید، یکی از نوبت‌ها را لغو کنید یا با ما تماس بگیرید.`);
      }
    }

    if (!customer) {
      const r = db.prepare('INSERT INTO customers (name, phone, created_at) VALUES (?, ?, ?)').run(input.name, input.phone, nowDate.toISOString());
      customer = { id: Number(r.lastInsertRowid) };
    } else if (source === 'admin' && input.name) {
      db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(input.name, customer.id);
    }

    const deposit = source === 'online' ? requiredDeposit(settings, service.price) : 0;
    const status = deposit > 0 ? 'pending_payment' : 'confirmed';
    const holdUntil = deposit > 0 ? nowMs + settings.hold_min * 60_000 : null;

    const r = db
      .prepare(
        `INSERT INTO appointments
         (code, customer_id, staff_id, service_id, service_name, date, start_min, end_min, buffer_min,
          status, price, deposit, notes, source, hold_until, reminder_sent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        generateCode(db), customer.id, staffId, service.id, service.name, input.date, input.startMin, endMin, service.buffer_min,
        status, service.price, deposit, input.notes ?? '', source, holdUntil,
        reminderAlreadyDue(settings, input.date, input.startMin, local), nowDate.toISOString(),
      );
    return Number(r.lastInsertRowid);
  });

  const appt = getAppointment(db, id);
  if (appt.status === 'confirmed') notifyAppointment(ctx, id, 'confirm');
  return appt;
}

/** نوبت‌هایی که مهلت پرداختشان گذشته آزاد می‌شوند */
export function expireHolds(ctx) {
  return ctx.db
    .prepare(`UPDATE appointments SET status = 'cancelled', cancel_reason = 'payment_timeout' WHERE status = 'pending_payment' AND hold_until <= ?`)
    .run(ctx.now().getTime()).changes;
}

/** ثبت پرداخت موفق روی نوبت؛ نتیجه: confirmed یا expired_paid (پرداخت شد ولی زمان قبلاً آزاد و گرفته شده بود) */
export function applyPayment(ctx, appointmentId, amount) {
  const { db } = ctx;
  const nowMs = ctx.now().getTime();
  const result = tx(db, () => {
    const a = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    if (!a) return { outcome: 'missing' };
    const paid = a.paid + amount;
    if (a.status === 'pending_payment') {
      db.prepare(`UPDATE appointments SET paid = ?, status = 'confirmed', hold_until = NULL WHERE id = ?`).run(paid, a.id);
      return { outcome: 'confirmed', notify: true };
    }
    if (a.status === 'cancelled' && a.cancel_reason === 'payment_timeout') {
      const clash = hasOverlap(db, { staffId: a.staff_id, date: a.date, startMin: a.start_min, endMin: a.end_min, bufferMin: a.buffer_min, nowMs, excludeId: a.id });
      if (!clash) {
        db.prepare(`UPDATE appointments SET paid = ?, status = 'confirmed', cancel_reason = '', hold_until = NULL WHERE id = ?`).run(paid, a.id);
        return { outcome: 'confirmed', notify: true };
      }
      db.prepare('UPDATE appointments SET paid = ?, cancel_reason = ? WHERE id = ?').run(paid, 'payment_after_expiry', a.id);
      return { outcome: 'expired_paid' };
    }
    db.prepare('UPDATE appointments SET paid = ? WHERE id = ?').run(paid, a.id);
    return { outcome: a.status === 'cancelled' ? 'expired_paid' : 'confirmed' };
  });
  if (result.notify) notifyAppointment(ctx, appointmentId, 'confirm');
  return result.outcome;
}

export function cancelAppointment(ctx, id, { reason = '', notify = true } = {}) {
  const a = ctx.db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!a) throw notFound('نوبت پیدا نشد.');
  if (a.status !== 'confirmed' && a.status !== 'pending_payment') throw conflict('این نوبت قابل لغو نیست.');
  ctx.db.prepare(`UPDATE appointments SET status = 'cancelled', cancel_reason = ? WHERE id = ?`).run(reason, id);
  if (notify && a.status === 'confirmed') notifyAppointment(ctx, id, 'cancel');
}

export function cancelByCustomer(ctx, code) {
  const a = getAppointmentByCode(ctx.db, code);
  if (!a) throw notFound('نوبتی با این کد پیدا نشد.');
  if (!canCustomerCancel(ctx, a)) {
    throw conflict(`لغو آنلاین فقط تا ${ctx.settings().cancel_before_hours} ساعت قبل از نوبت ممکن است. لطفاً با ما تماس بگیرید.`);
  }
  cancelAppointment(ctx, a.id, { reason: 'customer' });
}

/** ویرایش نوبت توسط مدیر: وضعیت، یادداشت، مبلغ، یا جابه‌جایی (تاریخ/ساعت/پرسنل) */
export function updateAppointment(ctx, id, patch) {
  const { db } = ctx;
  const nowDate = ctx.now();
  const settings = ctx.settings();
  const local = localNow(nowDate, settings.timezone);
  let sms = null;

  tx(db, () => {
    const a = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!a) throw notFound('نوبت پیدا نشد.');

    const next = {
      status: patch.status ?? a.status,
      date: patch.date ?? a.date,
      start_min: patch.startMin ?? a.start_min,
      staff_id: patch.staffId ?? a.staff_id,
      notes: patch.notes ?? a.notes,
      paid: patch.paid ?? a.paid,
      price: patch.price ?? a.price,
    };
    next.end_min = next.start_min + (a.end_min - a.start_min);
    if (next.end_min > 1440) throw badRequest('نوبت نمی‌تواند از نیمه‌شب بگذرد.');

    const moved = next.date !== a.date || next.start_min !== a.start_min || next.staff_id !== a.staff_id;
    const reinstated = a.status === 'cancelled' && next.status !== 'cancelled';

    if (next.staff_id !== a.staff_id && !qualifiedStaff(db, a.service_id, next.staff_id).length) {
      throw badRequest('این فرد این خدمت را انجام نمی‌دهد.');
    }
    if (next.status !== 'cancelled' && (moved || reinstated)) {
      const clash = hasOverlap(db, {
        staffId: next.staff_id, date: next.date, startMin: next.start_min, endMin: next.end_min,
        bufferMin: a.buffer_min, nowMs: nowDate.getTime(), excludeId: a.id,
      });
      if (clash) throw conflict('در این زمان نوبت دیگری برای این فرد ثبت شده است.');
    }

    const reminder = moved ? reminderAlreadyDue(settings, next.date, next.start_min, local) : a.reminder_sent;
    const holdUntil = next.status === 'pending_payment' ? a.hold_until : null;
    const cancelReason = next.status === 'cancelled' ? (a.status === 'cancelled' ? a.cancel_reason : 'admin') : '';

    db.prepare(
      `UPDATE appointments SET status = ?, date = ?, start_min = ?, end_min = ?, staff_id = ?, notes = ?,
         paid = ?, price = ?, reminder_sent = ?, hold_until = ?, cancel_reason = ? WHERE id = ?`,
    ).run(next.status, next.date, next.start_min, next.end_min, next.staff_id, next.notes, next.paid, next.price, reminder, holdUntil, cancelReason, id);

    if (patch.notify) {
      if (next.status === 'cancelled' && a.status !== 'cancelled') sms = 'cancel';
      else if (next.status === 'confirmed' && (moved || reinstated)) sms = 'confirm';
    }
  });

  if (sms) notifyAppointment(ctx, id, sms);
  return getAppointment(db, id);
}

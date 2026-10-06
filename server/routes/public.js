import { Router } from 'express';
import { datesWithSlots, findSlots, qualifiedStaff } from '../lib/availability.js';
import { audit } from '../lib/audit.js';
import { cancelAppointment, canCustomerCancel, cancelByCustomer, createBooking, getAppointmentByCode, publicView } from '../lib/booking.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { MONTH_NAMES, WEEKDAY_NAMES, isoToJalali, monthGrid } from '../lib/jalali.js';
import { requestCancelOtp, verifyCancelOtp } from '../lib/otp.js';
import { startPayment } from '../lib/payment.js';
import { rateLimit } from '../lib/ratelimit.js';
import { addDays, localNow, minToHHMM } from '../lib/time.js';
import * as v from '../lib/validate.js';

/** پرسنل: «any» یا خالی یعنی هر کدام (null)، وگرنه شناسهٔ عددی */
export function parseStaffParam(value) {
  if (value === undefined || value === null || value === '' || value === 'any') return null;
  return v.int(value, 'پرسنل', { min: 1 });
}

export function loadService(ctx, id, { activeOnly = true } = {}) {
  const service = ctx.db.prepare(`SELECT * FROM services WHERE id = ? ${activeOnly ? 'AND active = 1' : ''}`).get(id);
  if (!service) throw badRequest('خدمت انتخاب‌شده معتبر نیست.');
  return service;
}

export function publicRoutes(ctx) {
  const router = Router();

  const now = () => ctx.now().getTime();
  const bookingLimiter = rateLimit({ windowMs: 3600_000, max: ctx.limits.booking, now, message: 'تعداد ثبت نوبت از این شبکه زیاد است. کمی بعد دوباره تلاش کنید.' });
  const lookupLimiter = rateLimit({ windowMs: 600_000, max: ctx.limits.lookup, now });
  const otpSendLimiter = rateLimit({ windowMs: 3600_000, max: ctx.limits.otpSend, now, message: 'تعداد درخواست کد از این شبکه زیاد است. کمی بعد دوباره تلاش کنید.' });
  const otpVerifyLimiter = rateLimit({ windowMs: 3600_000, max: ctx.limits.otpVerify, now, message: 'تعداد تلاش‌ها زیاد است. کمی بعد دوباره تلاش کنید.' });

  router.get('/config', (_req, res) => {
    const s = ctx.settings();
    const today = localNow(ctx.now(), s.timezone).date;
    res.json({
      business: { name: s.business_name, phone: s.business_phone, address: s.business_address, about: s.business_about },
      brandColor: s.brand_color,
      rules: {
        minNoticeMin: s.min_notice_min,
        maxDaysAhead: s.max_days_ahead,
        cancelBeforeHours: s.cancel_before_hours,
        cancelPolicy: s.cancel_policy,
        holdMin: s.hold_min,
      },
      payment: { mode: s.payment_mode, depositPercent: s.deposit_percent },
      today: { date: today, ...isoToJalali(today) },
      lastBookableDate: addDays(today, s.max_days_ahead),
      monthNames: MONTH_NAMES,
      weekdayNames: WEEKDAY_NAMES,
    });
  });

  router.get('/services', (_req, res) => {
    const services = ctx.db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY sort_order, id').all();
    const out = [];
    for (const s of services) {
      const staff = qualifiedStaff(ctx.db, s.id);
      if (!staff.length) continue; // خدمتی که کسی انجامش نمی‌دهد قابل رزرو نیست
      out.push({ id: s.id, name: s.name, description: s.description, durationMin: s.duration_min, price: s.price, staff });
    }
    res.json({ services: out });
  });

  /** ماه شمسی برای رسم تقویم (برای مشتری و مدیر). با ?date=ISO ماهِ آن تاریخ، با jy و jm همان ماه، و بدون پارامتر ماه جاری */
  router.get('/calendar', (req, res) => {
    const today = localNow(ctx.now(), ctx.settings().timezone).date;
    const cur = isoToJalali(req.query.date ? v.date(req.query.date) : today);
    const jy = req.query.jy ? v.int(req.query.jy, 'سال', { min: 1300, max: 1700 }) : cur.jy;
    const jm = req.query.jm ? v.int(req.query.jm, 'ماه', { min: 1, max: 12 }) : cur.jm;
    res.json(monthGrid(jy, jm));
  });

  /** روزهای دارای زمان خالی در یک ماه شمسی */
  router.get('/days', (req, res) => {
    const service = loadService(ctx, v.int(req.query.service, 'خدمت', { min: 1 }));
    const staffId = parseStaffParam(req.query.staff);
    const grid = monthGrid(v.int(req.query.jy, 'سال', { min: 1300, max: 1700 }), v.int(req.query.jm, 'ماه', { min: 1, max: 12 }));
    const s = ctx.settings();
    const today = localNow(ctx.now(), s.timezone).date;
    const last = addDays(today, s.max_days_ahead);
    const candidates = grid.days.map((d) => d.date).filter((d) => d >= today && d <= last);
    res.json({ available: datesWithSlots(ctx, { service, staffId, dates: candidates }) });
  });

  router.get('/slots', (req, res) => {
    const service = loadService(ctx, v.int(req.query.service, 'خدمت', { min: 1 }));
    const slots = findSlots(ctx, { service, staffId: parseStaffParam(req.query.staff), date: v.date(req.query.date) });
    res.json({ slots: slots.map((s) => ({ start: s.start, time: minToHHMM(s.start) })) });
  });

  router.post('/bookings', bookingLimiter, async (req, res) => {
    const b = req.body ?? {};
    const input = {
      serviceId: v.int(b.serviceId, 'خدمت', { min: 1 }),
      staffId: parseStaffParam(b.staffId),
      date: v.date(b.date),
      startMin: v.time(b.time),
      name: v.text(b.name, 'نام و نام خانوادگی', { min: 2, max: 60 }),
      phone: v.phone(b.phone),
      notes: v.multiline(b.notes, 'توضیحات', { max: 300 }),
    };
    const appt = createBooking(ctx, input, { source: 'online' });

    let paymentUrl = null;
    if (appt.status === 'pending_payment') {
      try {
        paymentUrl = (await startPayment(ctx, appt)).url;
      } catch (err) {
        console.error('payment start failed:', err);
        cancelAppointment(ctx, appt.id, { reason: 'gateway_error', notify: false });
        throw new HttpError(502, 'اتصال به درگاه پرداخت برقرار نشد. لطفاً کمی بعد دوباره تلاش کنید.');
      }
    }
    res.status(201).json({ code: appt.code, status: appt.status, paymentUrl });
  });

  const byCode = (req) => {
    const a = getAppointmentByCode(ctx.db, req.params.code);
    if (!a) throw notFound('نوبتی با این کد پیدا نشد.');
    return a;
  };

  router.get('/bookings/:code', lookupLimiter, (req, res) => {
    res.json({ booking: publicView(ctx, byCode(req)) });
  });

  /** قانون زمانی لغو (مثلاً ۱۲ ساعت قبل). پیش از ارسال یا مصرف کد بررسی می‌شود تا کد بی‌دلیل خرج نشود. */
  const assertCancellable = (a) => {
    if (!canCustomerCancel(ctx, a)) {
      throw conflict(`لغو آنلاین فقط تا ${ctx.settings().cancel_before_hours} ساعت قبل از نوبت ممکن است. لطفاً با ما تماس بگیرید.`);
    }
  };

  /**
   * مرحلهٔ ۱ لغو: ارسال کد تأیید به شمارهٔ ثبت‌شده در خود نوبت.
   * کد پیگیری به‌تنهایی کافی نیست؛ فقط صاحب آن شمارهٔ موبایل می‌تواند نوبت را لغو کند.
   */
  router.post('/bookings/:code/cancel-code', otpSendLimiter, async (req, res) => {
    const a = byCode(req);
    assertCancellable(a);
    const sent = await requestCancelOtp(ctx, a);
    audit(ctx, { ip: req.ip, action: 'cancel_code_sent', detail: a.code });
    res.json(sent);
  });

  /** مرحلهٔ ۲ لغو: با کد تأیید پیامکی. */
  router.post('/bookings/:code/cancel', otpVerifyLimiter, (req, res) => {
    const a = byCode(req);
    assertCancellable(a);
    try {
      verifyCancelOtp(ctx, a, req.body?.otp);
    } catch (err) {
      audit(ctx, { ip: req.ip, action: 'cancel_code_failed', detail: a.code });
      throw err;
    }
    cancelByCustomer(ctx, a.code);
    audit(ctx, { ip: req.ip, action: 'cancelled_by_customer', detail: a.code });
    res.json({ booking: publicView(ctx, byCode(req)) });
  });

  /** تلاش دوباره برای پرداخت نوبتی که هنوز مهلتش نگذشته */
  router.post('/bookings/:code/pay', lookupLimiter, async (req, res) => {
    const a = byCode(req);
    if (a.status !== 'pending_payment' || a.hold_until <= ctx.now().getTime()) {
      throw badRequest('مهلت پرداخت این نوبت تمام شده است. لطفاً نوبت جدیدی ثبت کنید.');
    }
    try {
      res.json({ url: (await startPayment(ctx, a)).url });
    } catch (err) {
      console.error('payment start failed:', err);
      throw new HttpError(502, 'اتصال به درگاه پرداخت برقرار نشد. لطفاً کمی بعد دوباره تلاش کنید.');
    }
  });

  return router;
}

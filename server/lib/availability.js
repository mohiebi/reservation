import { addDays, epochMinutes, localNow, weekdayOf } from './time.js';

/** از بازه‌های base، بازه‌های cuts را کم می‌کند. هر بازه [شروع، پایان) به دقیقه است. */
export function subtractIntervals(base, cuts) {
  let result = base.map(([s, e]) => [s, e]);
  for (const [cs, ce] of cuts) {
    const next = [];
    for (const [s, e] of result) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    result = next;
  }
  return result;
}

/** ساعت کاری پرسنل در یک تاریخ، پس از کسر مرخصی/تعطیلی */
export function staffFreeIntervals(db, staffId, date) {
  const hours = db
    .prepare('SELECT start_min, end_min FROM working_hours WHERE staff_id = ? AND weekday = ? ORDER BY start_min')
    .all(staffId, weekdayOf(date));
  const offs = db
    .prepare('SELECT start_min, end_min FROM time_off WHERE (staff_id IS NULL OR staff_id = ?) AND date_from <= ? AND date_to >= ?')
    .all(staffId, date, date);
  const cuts = [];
  for (const off of offs) {
    if (off.start_min == null || off.end_min == null) return []; // تمام روز تعطیل
    cuts.push([off.start_min, off.end_min]);
  }
  return subtractIntervals(
    hours.map((h) => [h.start_min, h.end_min]),
    cuts,
  );
}

const BLOCKING = `(status IN ('confirmed','completed','no_show') OR (status = 'pending_payment' AND hold_until > ?))`;

/** بازه‌های اشغال‌شده توسط نوبت‌های دیگر (با احتساب زمان استراحت بعد از هر نوبت) */
export function busyIntervals(db, staffId, date, nowMs, excludeId = null) {
  return db
    .prepare(`SELECT start_min, end_min, buffer_min FROM appointments WHERE staff_id = ? AND date = ? AND id != ? AND ${BLOCKING}`)
    .all(staffId, date, excludeId ?? -1, nowMs)
    .map((r) => [r.start_min, r.end_min + r.buffer_min]);
}

/** آیا بازهٔ [start, end+buffer) با نوبت دیگری تداخل دارد؟ */
export function hasOverlap(db, { staffId, date, startMin, endMin, bufferMin = 0, nowMs, excludeId = null }) {
  const end = endMin + bufferMin;
  return busyIntervals(db, staffId, date, nowMs, excludeId).some(([bs, be]) => startMin < be && end > bs);
}

export function activeCountOn(db, staffId, date, nowMs) {
  return db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE staff_id = ? AND date = ? AND ${BLOCKING}`).get(staffId, date, nowMs).n;
}

function slotsForStaff(db, { staffId, date, duration, buffer, step, earliest, nowMs, excludeId }) {
  const free = staffFreeIntervals(db, staffId, date);
  if (!free.length) return [];
  const busy = busyIntervals(db, staffId, date, nowMs, excludeId);
  const starts = [];
  for (const [s, e] of free) {
    for (let t = s; t + duration <= e; t += step) {
      if (t < earliest) continue;
      const tEnd = t + duration + buffer;
      if (busy.some(([bs, be]) => t < be && tEnd > bs)) continue;
      starts.push(t);
    }
  }
  return starts;
}

/** پرسنل فعالی که این خدمت را انجام می‌دهند؛ اگر staffId داده شود فقط همان نفر (در صورت صلاحیت) */
export function qualifiedStaff(db, serviceId, staffId = null) {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.title FROM staff s
       JOIN staff_services ss ON ss.staff_id = s.id
       WHERE ss.service_id = ? AND s.active = 1
       ORDER BY s.sort_order, s.id`,
    )
    .all(serviceId);
  return staffId == null ? rows : rows.filter((r) => r.id === staffId);
}

/**
 * زمان‌های خالی یک خدمت در یک تاریخ.
 * staffId = null یعنی «هر کدام از پرسنل»؛ در این حالت برای هر ساعت، کم‌کارترین فرد انتخاب می‌شود.
 * admin = true: قانون حداقل زمان قبل و سقف روزهای آینده اعمال نمی‌شود.
 * خروجی: [{ start (دقیقه)، staffId }]
 */
export function findSlots(ctx, { service, staffId = null, date, admin = false, excludeId = null }) {
  const settings = ctx.settings();
  const nowDate = ctx.now();
  const nowMs = nowDate.getTime();
  const local = localNow(nowDate, settings.timezone);

  if (date < local.date) return [];
  if (!admin && date > addDays(local.date, settings.max_days_ahead)) return [];

  const notice = admin ? 0 : settings.min_notice_min;
  const earliestAbs = epochMinutes(local.date, local.minutes) + notice;
  const earliest = admin ? 0 : Math.max(0, earliestAbs - epochMinutes(date, 0));

  const candidates = qualifiedStaff(ctx.db, service.id, staffId);
  const best = new Map(); // start → { staffId, load }
  for (const st of candidates) {
    const starts = slotsForStaff(ctx.db, {
      staffId: st.id,
      date,
      duration: service.duration_min,
      buffer: service.buffer_min,
      step: settings.slot_step_min,
      earliest,
      nowMs,
      excludeId,
    });
    if (!starts.length) continue;
    const load = activeCountOn(ctx.db, st.id, date, nowMs);
    for (const t of starts) {
      const cur = best.get(t);
      if (!cur || load < cur.load) best.set(t, { staffId: st.id, load });
    }
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([start, v]) => ({ start, staffId: v.staffId }));
}

export function datesWithSlots(ctx, { service, staffId = null, dates }) {
  return dates.filter((date) => findSlots(ctx, { service, staffId, date }).length > 0);
}

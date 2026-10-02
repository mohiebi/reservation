import { purgeExpiredSessions } from './auth.js';
import { expireHolds } from './booking.js';
import { notifyAppointment } from './sms.js';
import { addDays, epochMinutes, localNow } from './time.js';

/** آزادسازی نوبت‌های پرداخت‌نشده و ارسال یادآوری‌ها. هر دقیقه اجرا می‌شود. */
export function runMaintenance(ctx) {
  const settings = ctx.settings();
  const nowDate = ctx.now();

  expireHolds(ctx);
  purgeExpiredSessions(ctx.db, nowDate.getTime());

  if (!settings.sms_enabled || settings.reminder_hours <= 0) return;

  const local = localNow(nowDate, settings.timezone);
  const nowMin = epochMinutes(local.date, local.minutes);
  const horizon = settings.reminder_hours * 60;

  const due = ctx.db
    .prepare(`SELECT id, date, start_min FROM appointments WHERE status = 'confirmed' AND reminder_sent = 0 AND date BETWEEN ? AND ?`)
    .all(local.date, addDays(local.date, Math.ceil(settings.reminder_hours / 24) + 1));

  for (const a of due) {
    const left = epochMinutes(a.date, a.start_min) - nowMin;
    if (left <= 0 || left > horizon) continue;
    // ابتدا علامت می‌زنیم تا در صورت خطا یا اجرای هم‌زمان، پیامک تکراری نرود
    const claimed = ctx.db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ? AND reminder_sent = 0').run(a.id);
    if (claimed.changes === 1) notifyAppointment(ctx, a.id, 'reminder');
  }
}

export function startScheduler(ctx, intervalMs = 60_000) {
  const tick = () => {
    try {
      runMaintenance(ctx);
    } catch (err) {
      console.error('maintenance failed:', err);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

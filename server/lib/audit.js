/**
 * گزارش امنیتی: ورودها، تغییر گذرواژه و حساب‌ها، تغییر تنظیمات و تأیید هویت لغو نوبت.
 * ثبت گزارش هرگز نباید عملیات اصلی را خراب کند؛ خطاها فقط در کنسول چاپ می‌شوند.
 */
export function audit(ctx, { admin = null, ip = '', action, detail = '' }) {
  try {
    ctx.db
      .prepare('INSERT INTO audit_log (at, admin_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.now().toISOString(), admin?.id ?? null, admin?.username ?? '', action, String(detail).slice(0, 300), String(ip ?? '').replace(/^::ffff:/, '').slice(0, 64)); // IPv4 داخل IPv6 را ساده می‌کنیم
  } catch (err) {
    console.error('audit write failed:', err);
  }
}

export function listAudit(db, limit = 150) {
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
}

export function pruneAudit(db, keep = 5000) {
  db.prepare('DELETE FROM audit_log WHERE id <= (SELECT COALESCE(MAX(id), 0) - ? FROM audit_log)').run(keep);
}

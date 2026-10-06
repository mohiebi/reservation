import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { HttpError, unauthorized } from './errors.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'rsv_session';
const TOUCH_EVERY_MS = 60_000;

/** نقش‌ها: مدیر کل به همه‌چیز دسترسی دارد؛ منشی فقط نوبت‌ها و مشتریان. */
export const ROLES = { owner: 'مدیر کل', staff: 'منشی' };

// ---------- گذرواژه ----------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password).slice(0, 200), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/** اگر گذرواژه قابل قبول نباشد پیام خطای فارسی برمی‌گرداند، وگرنه null */
export function passwordProblem(password, username = '') {
  if (password.length < 10) return 'گذرواژه باید حداقل ۱۰ حرف باشد.';
  if (password.length > 128) return 'گذرواژه حداکثر ۱۲۸ حرف می‌تواند باشد.';
  if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) return 'گذرواژه نباید شامل نام کاربری باشد.';
  if (new Set(password).size < 5) return 'گذرواژه بیش از حد ساده است؛ حروف و اعداد متنوع‌تری بگذارید.';
  return null;
}

// ---------- نشست ----------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** نمایی از حساب مدیر که به مرورگر داده می‌شود (بدون هش گذرواژه) */
export function sessionView(row) {
  return { id: row.id, username: row.username, name: row.name, role: row.role, mustChangePassword: Boolean(row.must_change_password) };
}

export function createSession(db, adminId, nowMs, days = config.sessionDays) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = nowMs + days * 86400_000;
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at, last_seen) VALUES (?, ?, ?, ?)').run(sha256(token), adminId, expiresAt, nowMs);
  return { token, expiresAt };
}

/**
 * حساب مدیر مربوط به یک توکن نشست؛ null اگر نامعتبر، منقضی، بیکارِ بیش از حد، یا حساب غیرفعال باشد.
 * هر بار که استفاده شود زمان آخرین فعالیت (last_seen) به‌روز می‌شود.
 */
export function findSession(db, token, nowMs, idleMs = config.sessionIdleHours * 3600_000) {
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT a.*, s.last_seen FROM sessions s
       JOIN admins a ON a.id = s.admin_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1`,
    )
    .get(hash, nowMs);
  if (!row) return null;
  if (nowMs - row.last_seen > idleMs) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  if (nowMs - row.last_seen > TOUCH_EVERY_MS) db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(nowMs, hash);
  return sessionView(row);
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

/** همهٔ نشست‌های یک مدیر را می‌بندد؛ اگر keepToken داده شود نشست همان مرورگر می‌ماند */
export function destroySessionsOf(db, adminId, keepToken = null) {
  if (keepToken) db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?').run(adminId, sha256(keepToken));
  else db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId);
}

export function purgeExpiredSessions(db, nowMs, idleMs = config.sessionIdleHours * 3600_000) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR last_seen < ?').run(nowMs, nowMs - idleMs);
}

// ---------- کوکی و میان‌افزارها ----------

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// SameSite=Strict: کوکی نشست هرگز در درخواست‌هایی که از سایت دیگر شروع شده‌اند فرستاده نمی‌شود
export function setSessionCookie(res, token, expiresAt, secure) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure, path: '/', expires: new Date(expiresAt) });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/**
 * ورود لازم است. اگر مدیر باید گذرواژهٔ موقتش را عوض کند، فقط مسیرهای allowDuringPasswordChange باز می‌مانند.
 */
export function requireAdmin(ctx, { allowDuringPasswordChange = [] } = {}) {
  return (req, _res, next) => {
    const token = readCookie(req);
    const admin = findSession(ctx.db, token, ctx.now().getTime());
    if (!admin) return next(unauthorized());
    req.admin = admin;
    req.sessionToken = token;
    if (admin.mustChangePassword && !allowDuringPasswordChange.includes(req.path)) {
      return next(new HttpError(403, 'برای ادامه ابتدا گذرواژهٔ خود را تغییر دهید.', { code: 'password_change_required' }));
    }
    next();
  };
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.admin?.role) ? next() : next(new HttpError(403, 'دسترسی شما به این بخش مجاز نیست.'));

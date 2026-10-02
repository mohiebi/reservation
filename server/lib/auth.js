import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { unauthorized } from './errors.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'rsv_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(db, adminId, nowMs, days) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = nowMs + days * 86400_000;
  db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), adminId, expiresAt);
  return { token, expiresAt };
}

export function findSession(db, token, nowMs) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT a.id, a.username, a.name FROM sessions s
         JOIN admins a ON a.id = s.admin_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(sha256(token), nowMs) ?? null
  );
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function purgeExpiredSessions(db, nowMs) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowMs);
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function setSessionCookie(res, token, expiresAt, secure) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: new Date(expiresAt) });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export function requireAdmin(ctx) {
  return (req, _res, next) => {
    const admin = findSession(ctx.db, readCookie(req), ctx.now().getTime());
    if (!admin) return next(unauthorized());
    req.admin = admin;
    next();
  };
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const port = Number(process.env.PORT) || 3000;

export const config = {
  port,
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'reservation.db'),
  publicDir: path.join(ROOT, 'public'),
  // آدرس عمومی سایت؛ برای ساخت آدرس بازگشت درگاه پرداخت لازم است.
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  // پشت Nginx/Cloudflare مقدار TRUST_PROXY=1 بگذارید تا IP واقعی کاربر خوانده شود.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionDays: 7,
};

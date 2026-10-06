import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { findSession, readCookie } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { getSettings } from './lib/settings.js';
import { sendSms } from './lib/sms.js';
import { adminRoutes } from './routes/admin.js';
import { payRoutes } from './routes/pay.js';
import { publicRoutes } from './routes/public.js';

/** سقف تعداد درخواست‌ها (در هر بازهٔ زمانی مشخص). در تست‌ها قابل تغییر است. */
export const DEFAULT_LIMITS = {
  loginPerIpUser: 10, // هر IP برای هر نام کاربری، در ۱۵ دقیقه
  loginPerUser: 20, // هر نام کاربری از مجموع همهٔ IPها، در ۱۵ دقیقه (جلوگیری از حملهٔ توزیع‌شده)
  loginPerIp: 60, // هر IP برای همهٔ نام‌ها، در ۱۵ دقیقه
  sensitiveAdmin: 10, // تغییر گذرواژه و کارهای حساس، در ۱۵ دقیقه
  booking: 20, // ثبت نوبت از هر IP، در ساعت
  lookup: 60, // دیدن/پیگیری نوبت از هر IP، در ۱۰ دقیقه
  otpSend: 15, // درخواست کد تأیید از هر IP، در ساعت
  otpVerify: 30, // وارد کردن کد تأیید از هر IP، در ساعت
};

/** همهٔ وابستگی‌ها یک‌جا؛ در تست‌ها ساعت (now)، ارسال پیامک و سقف‌ها قابل جایگزینی است. */
export function createContext({ db, now = () => new Date(), limits = {} }) {
  const ctx = { db, now, limits: { ...DEFAULT_LIMITS, ...limits }, settings: () => getSettings(db) };
  ctx.sendSms = (args) => sendSms(ctx, args);
  return ctx;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function securityHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
}

/** فقط درخواست JSON اجازهٔ تغییر داده دارد؛ فرم‌های بین‌سایتی (CSRF) نمی‌توانند این هدر را بفرستند. */
function requireJsonForWrites(req, _res, next) {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return next(new HttpError(415, 'درخواست نامعتبر است.'));
  }
  next();
}

export function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders);

  app.use('/api', requireJsonForWrites, express.json({ limit: '100kb' }));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api/public', publicRoutes(ctx));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'مسیر پیدا نشد.')));
  app.use('/pay', payRoutes(ctx));

  const pub = config.publicDir;
  // کد صفحه‌های پنل فقط برای مدیر واردشده ارسال می‌شود. ساختار و مسیرهای پنل برای ناشناس‌ها لو نمی‌رود
  // (فقط پوستهٔ ورود در /admin/ باز است). داده‌ها در هر حال پشت API و نیازمند ورود هستند.
  app.use('/admin/pages', (req, res, next) => {
    if (findSession(ctx.db, readCookie(req), ctx.now().getTime())) return next();
    res.status(401).type('text/plain').send('Unauthorized');
  });
  app.use(
    express.static(pub, {
      setHeaders(res, file) {
        if (file.endsWith('.woff2')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get('/b/:code', (_req, res) => res.sendFile(path.join(pub, 'track.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'درخواست نامعتبر است.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'درخواست بیش از حد بزرگ است.' });
    console.error(`${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.' });
  });

  return app;
}

import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { getSettings } from './lib/settings.js';
import { sendSms } from './lib/sms.js';
import { adminRoutes } from './routes/admin.js';
import { payRoutes } from './routes/pay.js';
import { publicRoutes } from './routes/public.js';

/** همهٔ وابستگی‌ها یک‌جا؛ در تست‌ها ساعت (now) و ارسال پیامک قابل جایگزینی است. */
export function createContext({ db, now = () => new Date() }) {
  const ctx = { db, now, settings: () => getSettings(db) };
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

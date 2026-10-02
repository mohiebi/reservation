import { HttpError } from './errors.js';

/**
 * محدودکنندهٔ ساده در حافظه (پنجرهٔ ثابت). برای اجرای تک‌پردازشی کافی است.
 * keyFn کلید را از درخواست می‌سازد؛ now برای تست قابل تزریق است.
 */
export function rateLimit({ windowMs, max, keyFn = (req) => req.ip, message = 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.', now = Date.now }) {
  const hits = new Map();
  let lastSweep = now();

  function sweep(t) {
    if (t - lastSweep < windowMs) return;
    lastSweep = t;
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }

  const middleware = (req, _res, next) => {
    const t = now();
    sweep(t);
    const key = keyFn(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) return next(new HttpError(429, message));
    next();
  };

  middleware.reset = (key) => hits.delete(key);
  return middleware;
}

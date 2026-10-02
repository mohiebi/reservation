import { Router } from 'express';
import { handleCallback, mockGatewayInfo } from '../lib/payment.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function payRoutes(ctx) {
  const router = Router();

  /** بازگشت از درگاه (زرین‌پال: ?Authority=...&Status=OK|NOK) */
  router.get('/callback', async (req, res) => {
    const { code, outcome } = await handleCallback(ctx, {
      authority: req.query.Authority ?? req.query.authority,
      status: req.query.Status ?? req.query.status,
    });
    res.redirect(code ? `/b/${encodeURIComponent(code)}?pay=${outcome}` : '/');
  });

  /** صفحهٔ درگاه آزمایشی؛ فقط وقتی درگاه «mock» انتخاب شده کار می‌کند */
  router.get('/mock/:authority', (req, res) => {
    const info = mockGatewayInfo(ctx, req.params.authority);
    if (!info || info.status !== 'initiated') return res.status(404).type('text/plain').send('Not found');
    const authority = encodeURIComponent(req.params.authority);
    const amount = new Intl.NumberFormat('fa-IR').format(info.amount);
    res.type('html').send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>درگاه پرداخت آزمایشی</title>
<style>
  body{font-family:Tahoma,sans-serif;background:#f6f7f4;margin:0;display:grid;place-items:center;min-height:100vh;color:#1c1f1e}
  main{background:#fff;border:1px solid #e4e7e3;border-radius:16px;padding:28px;max-width:380px;width:calc(100% - 32px);text-align:center}
  .warn{background:#fff4e5;color:#8a4b00;border-radius:10px;padding:10px;font-size:13px;margin-bottom:18px}
  .amount{font-size:26px;font-weight:700;margin:14px 0 22px}
  a{display:block;padding:12px;border-radius:10px;text-decoration:none;font-weight:700;margin-top:10px}
  .ok{background:#067647;color:#fff}.no{background:#f2f4f2;color:#1c1f1e}
</style></head><body><main>
  <div class="warn">این صفحه یک درگاه <b>آزمایشی</b> است و پول واقعی دریافت نمی‌کند.</div>
  <div>${escapeHtml(info.service_name)}</div>
  <div class="amount">${escapeHtml(amount)} تومان</div>
  <a class="ok" href="/pay/callback?Authority=${authority}&Status=OK">پرداخت موفق (شبیه‌سازی)</a>
  <a class="no" href="/pay/callback?Authority=${authority}&Status=NOK">انصراف</a>
</main></body></html>`);
  });

  return router;
}

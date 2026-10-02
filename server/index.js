import { createApp, createContext } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { startScheduler } from './lib/scheduler.js';

const db = openDatabase(config.dbPath);
const ctx = createContext({ db });
const app = createApp(ctx);

if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  console.warn('\n⚠  هنوز مدیری ساخته نشده است. برای ساخت حساب مدیر اجرا کنید:\n   npm run create-admin\n');
}
if (ctx.settings().payment_mode !== 'none' && ctx.settings().payment_gateway === 'mock') {
  console.warn('⚠  درگاه پرداخت روی «آزمایشی» است؛ پیش از راه‌اندازی واقعی آن را به زرین‌پال تغییر دهید.\n');
}

const server = app.listen(config.port, () => {
  console.log(`سیستم نوبت‌دهی روی ${config.baseUrl} در حال اجراست`);
  console.log(`پنل مدیریت: ${config.baseUrl}/admin/`);
});

const stopScheduler = startScheduler(ctx);

function shutdown() {
  stopScheduler();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

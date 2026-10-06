// پر کردن دیتابیس با داده‌های نمونه برای دیدن و آزمایش سیستم.
//   npm run seed-demo
// یک مدیر آزمایشی با گذرواژهٔ تصادفی می‌سازد و اطلاعات ورودش را در data/demo-credentials.txt می‌نویسد.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { openDatabase, tx } from '../server/db.js';
import { hashPassword } from '../server/lib/auth.js';
import { updateSettings } from '../server/lib/settings.js';

const db = openDatabase(config.dbPath);

if (db.prepare('SELECT 1 FROM services LIMIT 1').get() && !process.argv.includes('--force')) {
  console.error('دیتابیس از قبل خدمت دارد. برای افزودن دوباره، گزینهٔ --force را بدهید.');
  process.exit(1);
}

const services = [
  { name: 'کوتاهی مو', description: 'شستشو، کوتاهی و سشوار', duration: 45, buffer: 5, price: 250_000 },
  { name: 'رنگ و مش', description: 'مشاوره رنگ و اجرای کامل', duration: 120, buffer: 10, price: 1_200_000 },
  { name: 'اصلاح و پاکسازی صورت', description: '', duration: 30, buffer: 0, price: 150_000 },
  { name: 'مشاوره رایگان', description: 'جلسهٔ آشنایی و تعیین خدمت مناسب', duration: 15, buffer: 0, price: 0 },
];

const staff = [
  { name: 'سارا احمدی', title: 'مدیر سالن', serviceIdx: [0, 1, 2, 3] },
  { name: 'مریم رضایی', title: 'آرایشگر', serviceIdx: [0, 2, 3] },
];

// شنبه تا چهارشنبه ۹–۱۳ و ۱۵–۱۹، پنجشنبه ۹–۱۴، جمعه تعطیل
const weekHours = [];
for (let weekday = 0; weekday <= 4; weekday++) weekHours.push([weekday, 9 * 60, 13 * 60], [weekday, 15 * 60, 19 * 60]);
weekHours.push([5, 9 * 60, 14 * 60]);

const password = crypto.randomBytes(9).toString('base64url');

await (async () => {
  const hash = await hashPassword(password);
  tx(db, () => {
    updateSettings(db, { business_name: 'سالن زیبایی نمونه', business_phone: '021-12345678', business_address: 'تهران، خیابان نمونه، پلاک ۱۰', business_about: 'نوبت خود را آنلاین و در چند ثانیه رزرو کنید.' });
    const serviceIds = services.map((s, i) =>
      Number(db.prepare('INSERT INTO services (name, description, duration_min, buffer_min, price, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(s.name, s.description, s.duration, s.buffer, s.price, i + 1).lastInsertRowid),
    );
    staff.forEach((st, i) => {
      const id = Number(db.prepare('INSERT INTO staff (name, title, sort_order) VALUES (?, ?, ?)').run(st.name, st.title, i + 1).lastInsertRowid);
      for (const idx of st.serviceIdx) db.prepare('INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)').run(id, serviceIds[idx]);
      for (const [weekday, s, e] of weekHours) db.prepare('INSERT INTO working_hours (staff_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)').run(id, weekday, s, e);
    });
    db.prepare("INSERT OR REPLACE INTO admins (username, name, role, password_hash, created_at) VALUES (?, ?, 'owner', ?, ?)").run('demo', 'مدیر نمونه', hash, new Date().toISOString());
  });
})();

const file = path.join(path.dirname(config.dbPath), 'demo-credentials.txt');
fs.writeFileSync(file, `username: demo\npassword: ${password}\n`, { mode: 0o600 });
console.log(`داده‌های نمونه ساخته شد.\nاطلاعات ورود مدیر آزمایشی در این فایل است: ${file}`);
db.close();

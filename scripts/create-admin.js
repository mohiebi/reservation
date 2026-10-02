// ساخت حساب مدیر (یا تغییر گذرواژهٔ مدیر موجود).
//   npm run create-admin
//   npm run create-admin -- --username=ali            (گذرواژه را بعداً می‌پرسد)
// برای اجرای غیرتعاملی گذرواژه را در متغیر محیطی ADMIN_PASSWORD بدهید (نه در آرگومان، تا در history شل نماند).
import readline from 'node:readline';
import { config } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/lib/auth.js';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (str) => rl.output.write(rl.muted ? '*' : str);
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    rl.muted = hidden;
  });
}

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));

const username = String(args.username ?? process.env.ADMIN_USERNAME ?? (await ask('نام کاربری: '))).trim().toLowerCase();
if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
  console.error('نام کاربری باید ۳ تا ۳۲ حرف انگلیسی کوچک، عدد یا ._- باشد.');
  process.exit(1);
}

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  password = await ask('گذرواژه (حداقل ۸ حرف): ', { hidden: true });
  const again = await ask('تکرار گذرواژه: ', { hidden: true });
  if (password !== again) {
    console.error('گذرواژه‌ها یکسان نیستند.');
    process.exit(1);
  }
}
if (password.length < 8) {
  console.error('گذرواژه باید حداقل ۸ حرف باشد.');
  process.exit(1);
}

const db = openDatabase(config.dbPath);
const hash = await hashPassword(password);
const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing.id);
  console.log(`گذرواژهٔ «${username}» تغییر کرد.`);
} else {
  db.prepare('INSERT INTO admins (username, name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(username, username, hash, new Date().toISOString());
  console.log(`مدیر «${username}» ساخته شد. از آدرس ${config.baseUrl}/admin/ وارد شوید.`);
}
db.close();

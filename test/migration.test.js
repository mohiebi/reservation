import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, migrate } from '../server/db.js';
import { findSession } from '../server/lib/auth.js';

test('مهاجرت از نسخهٔ ۱: مدیر قبلی «مدیر کل» فعال می‌شود و داده‌ها می‌مانند', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  // دیتابیسی که با نسخهٔ قدیمی (فقط مهاجرت اول) ساخته شده و داده دارد
  db.exec(MIGRATIONS[0]);
  db.exec('PRAGMA user_version = 1');
  db.prepare("INSERT INTO admins (username, name, password_hash, created_at) VALUES ('old', 'قدیمی', 'x', '2026-01-01')").run();
  db.prepare("INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES ('h', 1, ?)").run(Date.now() + 86400_000);
  db.prepare("INSERT INTO services (name, duration_min) VALUES ('خدمت', 30)").run();

  migrate(db);

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  const admin = db.prepare("SELECT role, active, must_change_password FROM admins WHERE username = 'old'").get();
  assert.deepEqual({ ...admin }, { role: 'owner', active: 1, must_change_password: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM services').get().n, 1);
  for (const table of ['audit_log', 'cancel_otps']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);

  // نشست‌های قدیمی (last_seen = 0) بیکار حساب می‌شوند؛ یک بار باید دوباره وارد شد و این عمدی و امن است
  assert.equal(findSession(db, 'whatever', Date.now()), null);
  // اجرای دوباره بی‌اثر است
  migrate(db);
});

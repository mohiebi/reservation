import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// هر مورد یک نسخهٔ مهاجرت (migration) است؛ فقط به انتهای آرایه اضافه کنید.
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE services (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    duration_min INTEGER NOT NULL CHECK (duration_min > 0),
    buffer_min   INTEGER NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
    price        INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    active       INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE staff (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE staff_services (
    staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (staff_id, service_id)
  );

  -- weekday: شنبه = ۰ ... جمعه = ۶
  CREATE TABLE working_hours (
    id        INTEGER PRIMARY KEY,
    staff_id  INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    weekday   INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_min INTEGER NOT NULL,
    end_min   INTEGER NOT NULL,
    CHECK (start_min >= 0 AND end_min <= 1440 AND start_min < end_min)
  );
  CREATE INDEX idx_working_hours_staff ON working_hours(staff_id, weekday);

  -- staff_id خالی یعنی تعطیلی کل مجموعه؛ start_min خالی یعنی تمام روز
  CREATE TABLE time_off (
    id        INTEGER PRIMARY KEY,
    staff_id  INTEGER REFERENCES staff(id) ON DELETE CASCADE,
    date_from TEXT NOT NULL,
    date_to   TEXT NOT NULL,
    start_min INTEGER,
    end_min   INTEGER,
    reason    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_time_off_dates ON time_off(date_from, date_to);

  CREATE TABLE customers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL UNIQUE,
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE appointments (
    id            INTEGER PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    customer_id   INTEGER NOT NULL REFERENCES customers(id),
    staff_id      INTEGER NOT NULL REFERENCES staff(id),
    service_id    INTEGER NOT NULL REFERENCES services(id),
    service_name  TEXT NOT NULL,
    date          TEXT NOT NULL,
    start_min     INTEGER NOT NULL,
    end_min       INTEGER NOT NULL,
    buffer_min    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL CHECK (status IN ('pending_payment','confirmed','completed','cancelled','no_show')),
    price         INTEGER NOT NULL DEFAULT 0,
    deposit       INTEGER NOT NULL DEFAULT 0,
    paid          INTEGER NOT NULL DEFAULT 0,
    notes         TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT 'online',
    hold_until    INTEGER,
    reminder_sent INTEGER NOT NULL DEFAULT 0,
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_appt_staff_date ON appointments(staff_id, date);
  CREATE INDEX idx_appt_date ON appointments(date);
  CREATE INDEX idx_appt_customer ON appointments(customer_id);

  CREATE TABLE payments (
    id             INTEGER PRIMARY KEY,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id),
    amount         INTEGER NOT NULL,
    gateway        TEXT NOT NULL,
    authority      TEXT NOT NULL UNIQUE,
    ref_id         TEXT,
    status         TEXT NOT NULL CHECK (status IN ('initiated','paid','failed')),
    created_at     TEXT NOT NULL,
    paid_at        TEXT
  );

  CREATE TABLE sms_log (
    id         INTEGER PRIMARY KEY,
    phone      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    body       TEXT NOT NULL,
    status     TEXT NOT NULL,
    error      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE admins (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  `,
];

export function openDatabase(filePath) {
  if (filePath !== ':memory:') fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** اجرای fn داخل یک تراکنش؛ SQLite همزمانی نوشتن را سریال می‌کند و از رزرو تکراری جلوگیری می‌شود. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

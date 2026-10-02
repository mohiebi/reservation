import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoToJalali, jalaliToIso, monthGrid, formatJalali, faDigits } from '../server/lib/jalali.js';
import { normalizePhone } from '../server/lib/phone.js';
import { subtractIntervals } from '../server/lib/availability.js';
import { addDays, epochMinutes, hhmmToMin, isISODate, localNow, minToHHMM, weekdayOf } from '../server/lib/time.js';
import { DEFAULTS, updateSettings, getSettings, adminSettingsView } from '../server/lib/settings.js';
import { openDatabase } from '../server/db.js';

test('تبدیل تاریخ شمسی و میلادی', () => {
  assert.deepEqual(isoToJalali('2026-10-01'), { jy: 1405, jm: 7, jd: 9 });
  assert.equal(jalaliToIso(1405, 1, 1), '2026-03-21');
  assert.equal(formatJalali('2026-10-01'), '۹ مهر ۱۴۰۵');
  // اسفند سال کبیسه ۳۰ روز و غیرکبیسه ۲۹ روز است
  assert.equal(monthGrid(1403, 12).days.length, 30);
  assert.equal(monthGrid(1404, 12).days.length, 29);
  assert.equal(monthGrid(1405, 13), null);
});

test('روز هفته از شنبه شروع می‌شود', () => {
  assert.equal(weekdayOf('2026-10-03'), 0); // شنبه
  assert.equal(weekdayOf('2026-10-01'), 5); // پنجشنبه
  assert.equal(weekdayOf('2026-10-02'), 6); // جمعه
  assert.equal(monthGrid(1405, 7).firstWeekday, weekdayOf(jalaliToIso(1405, 7, 1)));
});

test('زمان محلی تهران', () => {
  assert.deepEqual(localNow(new Date('2026-10-01T06:30:00Z'), 'Asia/Tehran'), { date: '2026-10-01', minutes: 600 });
  // نیمه‌شب به وقت تهران → روز بعد
  assert.deepEqual(localNow(new Date('2026-10-01T20:45:00Z'), 'Asia/Tehran'), { date: '2026-10-02', minutes: 15 });
  assert.equal(epochMinutes('2026-10-02', 0) - epochMinutes('2026-10-01', 0), 1440);
});

test('کمک‌تابع‌های زمان', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(minToHHMM(615), '10:15');
  assert.equal(hhmmToMin('9:05'), 545);
  assert.equal(hhmmToMin('24:00'), null);
  assert.equal(hhmmToMin('abc'), null);
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2026-02-28'), true);
});

test('نرمال‌سازی شمارهٔ موبایل', () => {
  for (const input of ['09123456789', '9123456789', '+989123456789', '00989123456789', '۰۹۱۲۳۴۵۶۷۸۹', '0912 345 6789', '0912-345-6789']) {
    assert.equal(normalizePhone(input), '09123456789', input);
  }
  for (const bad of ['', '0912345678', '08123456789', '021123456', 'abc']) assert.equal(normalizePhone(bad), null, bad);
  assert.equal(faDigits('12:30'), '۱۲:۳۰');
});

test('کم کردن بازه‌ها', () => {
  assert.deepEqual(subtractIntervals([[540, 780]], [[600, 660]]), [[540, 600], [660, 780]]);
  assert.deepEqual(subtractIntervals([[540, 780]], [[500, 800]]), []);
  assert.deepEqual(subtractIntervals([[540, 780]], [[800, 900]]), [[540, 780]]);
  assert.deepEqual(subtractIntervals([[540, 780]], [[540, 570], [750, 780]]), [[570, 750]]);
});

test('تنظیمات: اعتبارسنجی و پنهان ماندن کلیدهای محرمانه', () => {
  const db = openDatabase(':memory:');
  assert.equal(getSettings(db).slot_step_min, DEFAULTS.slot_step_min);
  updateSettings(db, { slot_step_min: 15, kavenegar_api_key: 'secret-key', unknown_key: 'x' });
  const s = getSettings(db);
  assert.equal(s.slot_step_min, 15);
  assert.equal(s.kavenegar_api_key, 'secret-key');
  assert.equal('unknown_key' in s, false);

  const view = adminSettingsView(s);
  assert.equal(view.kavenegar_api_key, undefined);
  assert.equal(view.kavenegar_api_key_set, true);

  // مقدار خالی برای کلید محرمانه یعنی «تغییر نده»
  updateSettings(db, { kavenegar_api_key: '' });
  assert.equal(getSettings(db).kavenegar_api_key, 'secret-key');

  assert.throws(() => updateSettings(db, { payment_mode: 'bitcoin' }));
  assert.throws(() => updateSettings(db, { brand_color: 'red' }));
  assert.throws(() => updateSettings(db, { slot_step_min: 1 }));
});

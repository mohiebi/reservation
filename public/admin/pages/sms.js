import { api, fa, h } from '/js/common.js';

const KIND = { confirm: 'تأیید نوبت', reminder: 'یادآوری', cancel: 'لغو نوبت' };
const STATUS = {
  sent: ['confirmed', 'ارسال شد'],
  simulated: ['pending_payment', 'آزمایشی (ارسال نشده)'],
  failed: ['no_show', 'ناموفق'],
};

const when = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' });

export async function render(root, app) {
  const [{ sms }, { settings }] = await Promise.all([api('/api/admin/sms'), api('/api/admin/settings')]);
  const notices = [];
  if (!settings.sms_enabled) notices.push(h('div', { class: 'notice warn' }, 'ارسال پیامک خاموش است و هیچ پیامکی ثبت یا ارسال نمی‌شود. از بخش «تنظیمات» آن را روشن کنید.'));
  else if (settings.sms_provider === 'console') notices.push(h('div', { class: 'notice warn' }, 'سرویس پیامک روی حالت «آزمایشی» است: پیام‌ها فقط در همین فهرست ثبت می‌شوند و برای مشتری ارسال نمی‌شوند.'));

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'پیامک‌ها')),
    h('div', { class: 'stack' },
      ...notices,
      sms.length
        ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {}, ['زمان', 'گیرنده', 'نوع', 'وضعیت', 'متن'].map((t) => h('th', {}, t)))),
            h('tbody', {}, sms.map((m) => h('tr', {},
              h('td', { style: 'white-space:nowrap' }, when.format(new Date(m.created_at))),
              h('td', { style: 'white-space:nowrap' }, h('span', { class: 'ltr' }, fa(m.phone))),
              h('td', {}, KIND[m.kind] ?? m.kind),
              h('td', {}, h('span', { class: `badge ${STATUS[m.status]?.[0] ?? ''}` }, STATUS[m.status]?.[1] ?? m.status), m.error && h('div', { class: 'small', style: 'color:var(--danger)' }, m.error)),
              h('td', { class: 'clip', title: m.body }, m.body))))))
        : h('div', { class: 'card empty' }, 'هنوز پیامکی ثبت نشده است.'),
    ),
  );
}

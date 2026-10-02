import { dateField } from '/js/calendar.js';
import { api, confirmDialog, fa, field, guarded, h, icon, openDialog, timeSelect, toast } from '/js/common.js';

export async function render(root, app) {
  const today = app.config.today.date;
  const rows = h('div', { class: 'rows' });

  async function load() {
    const { timeOff } = await api('/api/admin/timeoff');
    if (!timeOff.length) {
      rows.replaceChildren(h('div', { class: 'card empty' }, 'مرخصی یا تعطیلی آینده‌ای ثبت نشده است.'));
      return;
    }
    rows.replaceChildren(
      ...timeOff.map((t) =>
        h(
          'article',
          { class: 'item' },
          h(
            'div',
            {},
            h('div', { class: 'title' }, h('b', {}, t.staffName ?? 'کل مجموعه'), t.reason && h('span', { class: 'muted' }, t.reason)),
            h('div', { class: 'meta' }, `${t.dateFrom === t.dateTo ? t.fromLabel : `${t.fromLabel} تا ${t.toLabel}`} · ${t.start ? `${fa(t.start)} تا ${fa(t.end)}` : 'تمام روز'}`),
          ),
          h('div', { class: 'acts' }, h('button', { class: 'btn sm danger', type: 'button', onclick: () => remove(t) }, icon('trash'), 'حذف')),
        ),
      ),
    );
  }

  async function remove(t) {
    if (!(await confirmDialog('این مورد حذف شود؟ زمان‌های آن دوباره قابل رزرو می‌شود.', { confirmText: 'حذف', danger: true }))) return;
    await api(`/api/admin/timeoff/${t.id}`, { method: 'DELETE' });
    toast('حذف شد.', 'ok');
    await load();
  }

  async function add() {
    const { staff } = await api('/api/admin/staff');
    const who = h('select', { class: 'input' }, h('option', { value: '' }, 'کل مجموعه (تعطیلی عمومی)'), staff.map((s) => h('option', { value: s.id }, s.name)));
    let to;
    const from = dateField({ today, value: today, minDate: today, onChange: (iso) => { if (to.value < iso) to.set(iso); } });
    to = dateField({ today, value: today, minDate: today });
    const allDay = h('input', { type: 'checkbox', checked: true });
    const start = timeSelect({ value: '12:00', label: 'از ساعت' });
    const end = timeSelect({ value: '14:00', label: 'تا ساعت' });
    const times = h('div', { class: 'form-grid', hidden: true },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'از ساعت'), start.el),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'تا ساعت'), end.el));
    allDay.addEventListener('change', () => { times.hidden = allDay.checked; });
    const reason = h('input', { class: 'input', maxlength: 100, placeholder: 'مثلاً تعطیلات نوروز، مرخصی استعلاجی' });
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'ثبت');
    const dlg = openDialog({
      title: 'مرخصی / تعطیلی جدید',
      body: [
        field('برای', who),
        field('از تاریخ', from.el),
        field('تا تاریخ', to.el),
        h('label', { class: 'check' }, allDay, 'تمام روز'),
        times,
        field('دلیل (اختیاری)', reason),
        error,
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () =>
      guarded(save, async () => {
        error.hidden = true;
        try {
          const res = await api('/api/admin/timeoff', {
            method: 'POST',
            body: { staffId: who.value || null, dateFrom: from.value, dateTo: to.value, allDay: allDay.checked, start: start.value, end: end.value, reason: reason.value },
          });
          dlg.close();
          if (res.conflicts > 0) toast(`${fa(res.conflicts)} نوبت فعال در این بازه وجود دارد. این نوبت‌ها لغو نشده‌اند؛ از بخش «نوبت‌ها» با مشتریان هماهنگ کنید.`, 'bad');
          else toast('ثبت شد.', 'ok');
          await load();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }),
    );
  }

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'مرخصی و تعطیلات'), h('button', { class: 'btn primary', type: 'button', onclick: add }, icon('plus'), 'مورد جدید')),
    h('p', { class: 'muted', style: 'margin-bottom:14px' }, 'در بازه‌های ثبت‌شده، زمان آزاد برای رزرو آنلاین نمایش داده نمی‌شود. نوبت‌های قبلی خودکار لغو نمی‌شوند.'),
    rows,
  );
  await load();
}

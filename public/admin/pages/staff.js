import { api, confirmDialog, fa, field, guarded, h, icon, openDialog, timeSelect, toast } from '/js/common.js';

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

/** ویرایشگر ساعت کاری هفتگی؛ هر روز می‌تواند چند بازه داشته باشد (مثلاً صبح و عصر) */
function hoursEditor(initial) {
  const days = WEEKDAYS.map((_, wd) => initial.filter((x) => x.weekday === wd).map((x) => ({ start: x.start, end: x.end })));
  const root = h('div', { class: 'hours' });

  function timeInput(iv, key) {
    return timeSelect({ value: iv[key], label: key === 'start' ? 'از ساعت' : 'تا ساعت', onChange: (v) => { iv[key] = v; } }).el;
  }

  function draw() {
    root.replaceChildren(
      ...WEEKDAYS.map((name, wd) => {
        const list = days[wd];
        return h(
          'div',
          { class: 'hrow' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: list.length > 0, onchange: (e) => { days[wd] = e.target.checked ? [{ start: '09:00', end: '17:00' }] : []; draw(); } }), name),
          list.length
            ? h(
                'div',
                { class: 'ivs' },
                list.map((iv, i) =>
                  h('div', { class: 'iv' }, timeInput(iv, 'start'), h('span', { class: 'muted' }, 'تا'), timeInput(iv, 'end'),
                    list.length > 1 && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'حذف این بازه', onclick: () => { list.splice(i, 1); draw(); } }, icon('x'))),
                ),
                h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { list.push({ start: list.at(-1).end < '20:00' ? list.at(-1).end : '18:00', end: '21:00' }); draw(); } }, icon('plus'), 'بازهٔ دیگر'),
              )
            : h('div', { class: 'off-label' }, 'تعطیل'),
        );
      }),
      h('div', {}, h('button', {
        class: 'btn sm', type: 'button',
        onclick: () => {
          const src = days.find((d) => d.length);
          if (!src) return toast('ابتدا ساعت کاری یک روز را وارد کنید.', 'bad');
          for (let wd = 0; wd < 6; wd++) days[wd] = src.map((iv) => ({ ...iv })); // جمعه تعطیل می‌ماند
          days[6] = [];
          draw();
        },
      }, 'اعمال اولین روز کاری روی شنبه تا پنجشنبه (جمعه تعطیل)')),
    );
  }
  draw();

  return {
    el: root,
    get value() {
      return days.flatMap((list, weekday) => list.filter((iv) => iv.start && iv.end).map((iv) => ({ weekday, start: iv.start, end: iv.end })));
    },
  };
}

/** «شنبه تا چهارشنبه: ۰۹:۰۰ تا ۱۳:۰۰ و ۱۵:۰۰ تا ۱۹:۰۰» — روزهای پشت‌سرهم با ساعت یکسان ادغام می‌شوند */
function summarizeHours(hours) {
  // از «تا» و «و» استفاده می‌کنیم؛ خط تیره بین اعداد در متن راست‌به‌چپ جابه‌جا نمایش داده می‌شود
  const sig = WEEKDAYS.map((_, wd) => hours.filter((x) => x.weekday === wd).map((x) => `${fa(x.start)} تا ${fa(x.end)}`).join(' و '));
  const out = [];
  for (let i = 0; i < 7; ) {
    if (!sig[i]) { i++; continue; }
    let j = i;
    while (j + 1 < 7 && sig[j + 1] === sig[i]) j++;
    out.push(`${i === j ? WEEKDAYS[i] : `${WEEKDAYS[i]} تا ${WEEKDAYS[j]}`}: ${sig[i]}`);
    i = j + 1;
  }
  return out;
}

export async function render(root) {
  const rows = h('div', { class: 'rows' });
  let services = [];

  async function load() {
    const [{ staff }, svc] = await Promise.all([api('/api/admin/staff'), api('/api/admin/services')]);
    services = svc.services;
    if (!staff.length) {
      rows.replaceChildren(h('div', { class: 'card empty' }, 'هنوز پرسنلی ثبت نشده است. بدون پرسنل، مشتری نمی‌تواند نوبت بگیرد.'));
      return;
    }
    rows.replaceChildren(
      ...staff.map((s) => {
        const names = services.filter((x) => s.serviceIds.includes(x.id)).map((x) => x.name);
        const lines = summarizeHours(s.hours);
        return h(
          'article',
          { class: `item${s.active ? '' : ' off'}` },
          h(
            'div',
            {},
            h('div', { class: 'title' }, h('b', {}, s.name), s.title && h('span', { class: 'muted' }, s.title), !s.active && h('span', { class: 'pill muted' }, 'غیرفعال')),
            h('div', { class: 'pills' }, names.length ? names.map((n) => h('span', { class: 'pill' }, n)) : h('span', { class: 'pill warn' }, 'هیچ خدمتی انتخاب نشده')),
            h('div', { class: 'meta', style: 'margin-top:6px' }, lines.length ? lines.map((l) => h('div', {}, l)) : h('span', { class: 'pill warn' }, 'ساعت کاری تعریف نشده')),
          ),
          h(
            'div',
            { class: 'acts' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => edit(s) }, icon('edit'), 'ویرایش'),
            h('button', { class: 'btn sm danger', type: 'button', onclick: () => remove(s) }, icon('trash'), 'حذف'),
          ),
        );
      }),
    );
  }

  async function remove(s) {
    if (!(await confirmDialog(`«${s.name}» حذف شود؟`, { confirmText: 'حذف', danger: true }))) return;
    try {
      await api(`/api/admin/staff/${s.id}`, { method: 'DELETE' });
      toast('حذف شد.', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function edit(s = null) {
    const name = h('input', { class: 'input', value: s?.name ?? '', maxlength: 60 });
    const title = h('input', { class: 'input', value: s?.title ?? '', maxlength: 60, placeholder: 'مثلاً آرایشگر ارشد' });
    const phone = h('input', { class: 'input', dir: 'ltr', value: s?.phone ?? '', placeholder: '09123456789' });
    const active = h('input', { type: 'checkbox', checked: s ? s.active : true });
    const checks = services.map((x) => ({ id: x.id, box: h('input', { type: 'checkbox', checked: s?.serviceIds.includes(x.id) ?? false }), name: x.name }));
    const hours = hoursEditor(s?.hours ?? [0, 1, 2, 3, 4].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })));
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'ذخیره');
    const dlg = openDialog({
      title: s ? 'ویرایش پرسنل' : 'پرسنل جدید',
      wide: true,
      body: [
        h('div', { class: 'form-grid' }, field('نام', name), field('عنوان (اختیاری)', title), field('شمارهٔ موبایل (اختیاری)', phone)),
        h('label', { class: 'check' }, active, 'فعال (در صفحهٔ رزرو نمایش داده شود)'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'خدماتی که انجام می‌دهد'),
          services.length ? h('div', { class: 'checks' }, checks.map((c) => h('label', { class: 'check' }, c.box, c.name))) : h('div', { class: 'muted' }, 'ابتدا از بخش «خدمات» خدمت تعریف کنید.')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'ساعت کاری هفتگی'), hours.el),
        error,
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () =>
      guarded(save, async () => {
        error.hidden = true;
        try {
          await api(s ? `/api/admin/staff/${s.id}` : '/api/admin/staff', {
            method: s ? 'PUT' : 'POST',
            body: { name: name.value, title: title.value, phone: phone.value, active: active.checked, serviceIds: checks.filter((c) => c.box.checked).map((c) => c.id), hours: hours.value },
          });
          dlg.close();
          toast('ذخیره شد.', 'ok');
          await load();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }),
    );
  }

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'پرسنل'), h('button', { class: 'btn primary', type: 'button', onclick: () => edit() }, icon('plus'), 'پرسنل جدید')),
    rows,
  );
  await load();
}

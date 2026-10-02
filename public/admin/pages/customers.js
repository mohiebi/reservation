import { api, fa, field, guarded, h, money, openDialog, statusBadge, toast } from '/js/common.js';

export async function render(root) {
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'جستجوی نام یا شمارهٔ موبایل…', 'aria-label': 'جستجو' });
  const body = h('div');

  async function load() {
    const { customers } = await api(`/api/admin/customers?q=${encodeURIComponent(search.value.trim())}`);
    if (!customers.length) {
      body.replaceChildren(h('div', { class: 'card empty' }, search.value ? 'مشتری‌ای با این مشخصات پیدا نشد.' : 'هنوز مشتری‌ای ثبت نشده است. با اولین رزرو، مشتری‌ها اینجا ظاهر می‌شوند.'));
      return;
    }
    body.replaceChildren(
      h('div', { class: 'scroll-x' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, ['نام', 'موبایل', 'تعداد نوبت', 'آخرین نوبت', 'یادداشت'].map((t) => h('th', {}, t)))),
          h('tbody', {}, customers.map((c) =>
            h('tr', { class: 'click', tabindex: 0, onclick: () => open(c.id), onkeydown: (e) => { if (e.key === 'Enter') open(c.id); } },
              h('td', {}, h('b', {}, c.name)),
              h('td', {}, h('span', { class: 'ltr' }, fa(c.phone))),
              h('td', {}, fa(c.visits)),
              h('td', {}, c.lastLabel || '—'),
              h('td', { class: 'clip muted' }, c.notes),
            )))),
      ),
    );
  }

  async function open(id) {
    const { customer, appointments } = await api(`/api/admin/customers/${id}`);
    const name = h('input', { class: 'input', value: customer.name, maxlength: 60 });
    const notes = h('textarea', { class: 'input', maxlength: 500, placeholder: 'مثلاً حساسیت‌ها، ترجیحات، توضیحات خاص' }, customer.notes);
    const save = h('button', { class: 'btn primary', type: 'button' }, 'ذخیره');
    const dlg = openDialog({
      title: 'پرونده مشتری',
      wide: true,
      body: [
        h('div', { class: 'notice' }, 'موبایل: ', h('a', { class: 'ltr', href: `tel:${customer.phone}` }, fa(customer.phone))),
        field('نام', name),
        field('یادداشت داخلی', notes),
        h('div', { class: 'stack' }, h('h3', {}, `سابقهٔ نوبت‌ها (${fa(appointments.length)})`),
          appointments.length
            ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('tbody', {}, appointments.map((a) =>
                h('tr', {}, h('td', {}, a.dateLabel), h('td', {}, fa(a.start)), h('td', {}, a.serviceName), h('td', {}, a.staffName), h('td', {}, money(a.price)), h('td', {}, statusBadge(a.status)))))))
            : h('p', { class: 'muted' }, 'نوبتی ثبت نشده است.')),
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'بستن')],
    });
    save.addEventListener('click', () => guarded(save, async () => {
      await api(`/api/admin/customers/${id}`, { method: 'PUT', body: { name: name.value, notes: notes.value } });
      dlg.close();
      toast('ذخیره شد.', 'ok');
      await load();
    }));
  }

  let debounce;
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(load, 300); });
  root.append(h('div', { class: 'page-head' }, h('h1', {}, 'مشتریان')), h('div', { class: 'toolbar' }, search), body);
  await load();
}

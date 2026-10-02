import { api, confirmDialog, durationLabel, fa, field, guarded, h, icon, money, numberInput, openDialog, toast } from '/js/common.js';

export async function render(root) {
  const rows = h('div', { class: 'rows' });

  async function load() {
    const { services } = await api('/api/admin/services');
    if (!services.length) {
      rows.replaceChildren(h('div', { class: 'card empty' }, 'هنوز خدمتی تعریف نشده است. با دکمهٔ «خدمت جدید» شروع کنید.'));
      return;
    }
    rows.replaceChildren(
      ...services.map((s) =>
        h(
          'article',
          { class: `item${s.active ? '' : ' off'}` },
          h(
            'div',
            {},
            h('div', { class: 'title' }, h('b', {}, s.name), !s.active && h('span', { class: 'pill muted' }, 'غیرفعال'), s.active && s.staffCount === 0 && h('span', { class: 'pill warn' }, 'هیچ پرسنلی ندارد؛ قابل رزرو نیست')),
            h('div', { class: 'meta' }, `${durationLabel(s.durationMin)}${s.bufferMin ? ` + ${durationLabel(s.bufferMin)} استراحت` : ''} · ${money(s.price)}${s.staffCount ? ` · ${fa(s.staffCount)} نفر ارائه‌دهنده` : ''}`),
            s.description && h('div', { class: 'meta' }, s.description),
          ),
          h(
            'div',
            { class: 'acts' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => edit(s) }, icon('edit'), 'ویرایش'),
            h('button', { class: 'btn sm danger', type: 'button', onclick: () => remove(s) }, icon('trash'), 'حذف'),
          ),
        ),
      ),
    );
  }

  async function remove(s) {
    if (!(await confirmDialog(`خدمت «${s.name}» حذف شود؟`, { confirmText: 'حذف', danger: true }))) return;
    try {
      await api(`/api/admin/services/${s.id}`, { method: 'DELETE' });
      toast('حذف شد.', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function edit(s = null) {
    const name = h('input', { class: 'input', value: s?.name ?? '', maxlength: 60 });
    const description = h('textarea', { class: 'input', maxlength: 300 }, s?.description ?? '');
    const duration = numberInput(s?.durationMin ?? 30);
    const buffer = numberInput(s?.bufferMin ?? 0);
    const price = numberInput(s?.price ?? 0);
    const active = h('input', { type: 'checkbox', checked: s ? s.active : true });
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'ذخیره');
    const dlg = openDialog({
      title: s ? 'ویرایش خدمت' : 'خدمت جدید',
      body: [
        field('نام خدمت', name),
        field('توضیح کوتاه (اختیاری)', description),
        h('div', { class: 'form-grid' }, field('مدت خدمت (دقیقه)', duration), field('استراحت بعد از خدمت (دقیقه)', buffer, 'این زمان برای نوبت بعدی بسته می‌شود.')),
        field('قیمت (تومان)', price, 'صفر یعنی رایگان؛ برای خدمت رایگان پرداخت آنلاین گرفته نمی‌شود.'),
        h('label', { class: 'check' }, active, 'فعال (در صفحهٔ رزرو نمایش داده شود)'),
        error,
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () =>
      guarded(save, async () => {
        error.hidden = true;
        try {
          await api(s ? `/api/admin/services/${s.id}` : '/api/admin/services', {
            method: s ? 'PUT' : 'POST',
            body: { name: name.value, description: description.value, durationMin: duration.num, bufferMin: buffer.num, price: price.num, active: active.checked },
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
    h('div', { class: 'page-head' }, h('h1', {}, 'خدمات'), h('button', { class: 'btn primary', type: 'button', onclick: () => edit() }, icon('plus'), 'خدمت جدید')),
    rows,
  );
  await load();
}

import { dateField, createCalendar } from '/js/calendar.js';
import {
  addDaysISO, api, durationLabel, fa, field, guarded, h, icon, jalaliLong, latin, money, numberInput,
  openDialog, statusBadge, STATUS_LABEL, timeSelect, toast,
} from '/js/common.js';

/** انتخاب ساعت: چیپ‌های زمان‌های خالی + ورودی ساعت دلخواه */
function slotPicker(fetchSlots) {
  const chips = h('div', { class: 'chips' });
  const sync = () => {
    for (const c of chips.children) if (c.dataset?.time) c.setAttribute('aria-pressed', String(c.dataset.time === input.value));
  };
  const input = timeSelect({ label: 'ساعت دلخواه', onChange: sync });
  let ticket = 0;
  async function reload() {
    const mine = ++ticket;
    chips.replaceChildren(h('span', { class: 'muted small' }, 'در حال بارگذاری…'));
    try {
      const slots = await fetchSlots();
      if (mine !== ticket) return;
      chips.replaceChildren(
        ...(slots.length
          ? slots.map((s) => h('button', { type: 'button', class: 'chip', dataset: { time: s.time }, 'aria-pressed': 'false', onclick: () => { input.value = s.time; sync(); } }, fa(s.time)))
          : [h('span', { class: 'muted small' }, 'زمان خالی در ساعت کاری وجود ندارد. می‌توانید ساعت دلخواه را وارد کنید.')]),
      );
      sync();
    } catch (err) {
      if (mine === ticket) chips.replaceChildren(h('span', { class: 'form-error' }, err.message));
    }
  }
  return {
    el: h('div', { class: 'stack', style: 'gap:10px' }, chips, h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'یا ساعت دلخواه:'), input.el)),
    get value() { return input.value; },
    set value(v) { input.value = v; sync(); },
    reload,
  };
}

const select = (options, value, attrs = {}) =>
  h('select', { class: 'input', value: String(value ?? ''), ...attrs }, options.map(([v, label]) => h('option', { value: String(v) }, label)));

export async function render(root, app) {
  const { config } = app;
  const [{ staff }, { services }] = await Promise.all([api('/api/admin/staff'), api('/api/admin/services')]);
  const state = { date: config.today.date, staff: '', q: '' };

  const dateBtn = h('button', { class: 'btn date-btn', type: 'button', 'aria-label': 'انتخاب تاریخ' }, icon('calendar'));
  const staffSel = select([['', 'همهٔ پرسنل'], ...staff.map((s) => [s.id, s.name])], '');
  const search = h('input', { class: 'input search', type: 'search', placeholder: 'جستجوی نام، شماره یا کد پیگیری…', 'aria-label': 'جستجو' });
  const summary = h('div', { class: 'summary-line', 'aria-live': 'polite' });
  const list = h('div', { class: 'appts' });

  // ---------- بارگذاری و نمایش ----------

  let ticket = 0;
  async function load() {
    const mine = ++ticket;
    const q = state.q.trim();
    const url = q
      ? `/api/admin/appointments?q=${encodeURIComponent(q)}`
      : `/api/admin/appointments?date=${state.date}${state.staff ? `&staff=${state.staff}` : ''}`;
    dateBtn.replaceChildren(icon('calendar'), q ? 'نتایج جستجو' : jalaliLong(state.date));
    try {
      const { appointments } = await api(url);
      if (mine !== ticket) return;
      draw(appointments, Boolean(q));
    } catch (err) {
      if (mine === ticket) list.replaceChildren(h('div', { class: 'form-error' }, err.message));
    }
  }

  function draw(items, isSearch) {
    const active = items.filter((a) => a.status === 'confirmed' || a.status === 'pending_payment' || a.status === 'completed');
    const pending = items.filter((a) => a.status === 'pending_payment').length;
    summary.textContent = items.length
      ? `${fa(active.length)} نوبت فعال${pending ? ` · ${fa(pending)} در انتظار پرداخت` : ''}${items.length > active.length ? ` · ${fa(items.length - active.length)} لغو/عدم حضور` : ''}`
      : '';
    if (!items.length) {
      list.replaceChildren(h('div', { class: 'card empty' }, isSearch ? 'نتیجه‌ای پیدا نشد.' : 'برای این روز نوبتی ثبت نشده است.'));
      return;
    }
    list.replaceChildren(...items.map((a) => card(a, isSearch)));
  }

  async function patch(id, body, okMessage) {
    await api(`/api/admin/appointments/${id}`, { method: 'PATCH', body });
    if (okMessage) toast(okMessage, 'ok');
    await load();
  }

  function card(a, showDate) {
    const btn = (label, onclick, cls = '') => {
      const b = h('button', { class: `btn sm ${cls}`, type: 'button' }, label);
      b.addEventListener('click', () => guarded(b, () => onclick(b)));
      return b;
    };
    const acts = [];
    if (a.status === 'confirmed') {
      acts.push(btn('انجام شد', () => patch(a.id, { status: 'completed' }), 'primary'), btn('عدم حضور', () => patch(a.id, { status: 'no_show' })));
    }
    if (a.status === 'pending_payment') {
      acts.push(btn('ثبت پرداخت دستی', () => patch(a.id, { status: 'confirmed', paid: a.deposit }, 'نوبت تأیید شد.'), 'primary'));
    }
    acts.push(btn('ویرایش', () => openEditor(a)));
    if (a.status === 'confirmed' || a.status === 'pending_payment') acts.push(btn('لغو', () => cancelFlow(a), 'danger'));

    const money_ = [money(a.price)];
    if (a.paid > 0) money_.push(`پرداخت‌شده ${money(a.paid)}`);
    else if (a.status === 'pending_payment') money_.push(`بیعانه ${money(a.deposit)}`);

    return h(
      'article',
      { class: `appt ${a.status}` },
      h('div', { class: 'time' }, showDate && h('span', { class: 'small muted' }, a.dateLabel), h('b', {}, fa(a.start)), h('span', { class: 'small muted' }, `تا ${fa(a.end)}`)),
      h(
        'div',
        {},
        h('div', { class: 'who' }, h('b', {}, a.customerName), h('a', { class: 'ltr muted', href: `tel:${a.customerPhone}` }, fa(a.customerPhone)), statusBadge(a.status)),
        h('div', { class: 'what muted' }, `${a.serviceName} · ${a.staffName} · ${money_.join(' · ')}`),
        a.notes && h('div', { class: 'note' }, a.notes),
      ),
      h('div', { class: 'acts' }, acts),
    );
  }

  async function cancelFlow(a) {
    const notify = h('input', { type: 'checkbox', checked: a.status === 'confirmed' });
    let go = false;
    const dlg = openDialog({
      title: 'لغو نوبت',
      body: [
        h('p', {}, `نوبت «${a.customerName}» در ${a.dateLabel} ساعت ${fa(a.start)} لغو شود؟`),
        a.paid > 0 && h('div', { class: 'notice warn' }, `این مشتری ${money(a.paid)} پرداخت کرده است. بازگرداندن وجه دستی انجام می‌شود.`),
        a.status === 'confirmed' && h('label', { class: 'check' }, notify, 'ارسال پیامک لغو به مشتری'),
      ],
      footer: [
        h('button', { class: 'btn solid-danger', type: 'button', onclick: () => { go = true; dlg.close(); } }, 'بله، لغو شود'),
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف'),
      ],
      onClose: async () => {
        if (!go) return;
        try { await patch(a.id, { status: 'cancelled', notify: notify.checked }, 'نوبت لغو شد.'); } catch (err) { toast(err.message, 'bad'); }
      },
    });
  }

  // ---------- ویرایش نوبت موجود ----------

  function openEditor(a) {
    const status = select(Object.entries(STATUS_LABEL), a.status);
    const qualified = staff.filter((s) => s.serviceIds.includes(a.serviceId) && (s.active || s.id === a.staffId));
    const staffSel2 = select(qualified.map((s) => [s.id, s.name]), a.staffId);
    const date = dateField({ today: config.today.date, value: a.date, onChange: () => picker.reload() });
    const picker = slotPicker(async () => (await api(`/api/admin/slots?service=${a.serviceId}&staff=${staffSel2.value}&date=${date.value}&exclude=${a.id}`)).slots);
    picker.value = a.start;
    staffSel2.addEventListener('change', () => picker.reload());
    const notes = h('textarea', { class: 'input', maxlength: 300 }, a.notes);
    const price = numberInput(a.price);
    const paid = numberInput(a.paid);
    const notify = h('input', { type: 'checkbox' });
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    picker.reload();

    const save = h('button', { class: 'btn primary', type: 'button' }, 'ذخیره');
    const dlg = openDialog({
      title: 'ویرایش نوبت',
      wide: true,
      body: [
        h('div', { class: 'notice' }, `${a.customerName} · `, h('span', { class: 'ltr' }, fa(a.customerPhone)), ` · ${a.serviceName} (${durationLabel(a.endMin - a.startMin)}) · کد `, h('span', { class: 'latin' }, a.code)),
        h('div', { class: 'form-grid' }, field('وضعیت', status), field('پرسنل', staffSel2)),
        field('تاریخ', date.el),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'ساعت'), picker.el),
        h('div', { class: 'form-grid' }, field('قیمت (تومان)', price), field('پرداخت‌شده (تومان)', paid)),
        field('یادداشت داخلی', notes),
        h('label', { class: 'check' }, notify, 'ارسال پیامک به مشتری (برای لغو یا تغییر زمان)'),
        error,
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () =>
      guarded(save, async () => {
        error.hidden = true;
        if (!picker.value) { error.textContent = 'ساعت نوبت را انتخاب کنید.'; error.hidden = false; return; }
        try {
          await api(`/api/admin/appointments/${a.id}`, {
            method: 'PATCH',
            body: { status: status.value, staffId: Number(staffSel2.value), date: date.value, time: picker.value, notes: notes.value, price: price.num, paid: paid.num, notify: notify.checked },
          });
          dlg.close();
          toast('تغییرات ذخیره شد.', 'ok');
          load();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }),
    );
  }

  // ---------- ثبت نوبت جدید ----------

  function openNew() {
    const activeServices = services.filter((s) => s.active);
    if (!activeServices.length) return toast('ابتدا یک خدمت فعال تعریف کنید.', 'bad');
    const service = select(activeServices.map((s) => [s.id, `${s.name} (${durationLabel(s.durationMin)})`]), activeServices[0].id);
    const staffSelNew = h('select', { class: 'input' });
    const date = dateField({ today: config.today.date, value: state.date, onChange: () => picker.reload() });
    const picker = slotPicker(async () => (staffSelNew.value ? (await api(`/api/admin/slots?service=${service.value}&staff=${staffSelNew.value}&date=${date.value}`)).slots : []));
    const name = h('input', { class: 'input', maxlength: 60, autocomplete: 'off' });
    const phone = h('input', { class: 'input', dir: 'ltr', inputmode: 'tel', placeholder: '09123456789', autocomplete: 'off' });
    const notes = h('textarea', { class: 'input', maxlength: 300 });
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });

    function fillStaff() {
      const list = staff.filter((s) => s.active && s.serviceIds.includes(Number(service.value)));
      staffSelNew.replaceChildren(...(list.length ? list.map((s) => h('option', { value: s.id }, s.name)) : [h('option', { value: '' }, 'پرسنلی برای این خدمت تعریف نشده')]));
      picker.reload();
    }
    service.addEventListener('change', fillStaff);
    staffSelNew.addEventListener('change', () => picker.reload());
    phone.addEventListener('change', async () => {
      const p = latin(phone.value).replace(/\D/g, '');
      if (p.length < 10 || name.value) return;
      try {
        const { customers } = await api(`/api/admin/customers?q=${encodeURIComponent(p.slice(-10))}`);
        if (customers.length === 1) name.value = customers[0].name;
      } catch { /* جستجوی خودکار اختیاری است */ }
    });
    fillStaff();

    const save = h('button', { class: 'btn primary', type: 'button' }, 'ثبت نوبت');
    const dlg = openDialog({
      title: 'ثبت نوبت جدید',
      wide: true,
      body: [
        h('div', { class: 'form-grid' }, field('خدمت', service), field('پرسنل', staffSelNew)),
        field('تاریخ', date.el),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'ساعت'), picker.el),
        h('div', { class: 'form-grid' }, field('شمارهٔ موبایل مشتری', phone), field('نام مشتری', name)),
        field('یادداشت داخلی', notes),
        error,
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () =>
      guarded(save, async () => {
        error.hidden = true;
        try {
          const res = await api('/api/admin/appointments', {
            method: 'POST',
            body: { serviceId: Number(service.value), staffId: Number(staffSelNew.value), date: date.value, time: picker.value, name: name.value, phone: phone.value, notes: notes.value },
          });
          dlg.close();
          toast('نوبت ثبت شد.', 'ok');
          state.date = res.appointment.date;
          state.q = '';
          search.value = '';
          load();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      }),
    );
  }

  // ---------- رویدادها ----------

  const shift = (n) => { state.date = addDaysISO(state.date, n); state.q = ''; search.value = ''; load(); };
  dateBtn.addEventListener('click', () => {
    const cal = createCalendar({ initial: state.date, selected: state.date, today: config.today.date, onSelect(iso) { dlg.close(); state.date = iso; state.q = ''; search.value = ''; load(); } });
    const dlg = openDialog({ title: 'انتخاب تاریخ', body: cal.el });
  });
  staffSel.addEventListener('change', () => { state.staff = staffSel.value; load(); });
  let debounce;
  search.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = search.value; load(); }, 300); });

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'نوبت‌ها'), h('button', { class: 'btn primary', type: 'button', onclick: openNew }, icon('plus'), 'نوبت جدید')),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'day-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'روز قبل', onclick: () => shift(-1) }, icon('right')),
        dateBtn,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'روز بعد', onclick: () => shift(1) }, icon('left')),
      ),
      h('button', { class: 'btn', type: 'button', onclick: () => { state.date = config.today.date; state.q = ''; search.value = ''; load(); } }, 'امروز'),
      staffSel,
      search,
    ),
    summary,
    list,
  );
  await load();
}

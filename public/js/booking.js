import { createCalendar } from './calendar.js';
import { $, ApiError, api, applyBrand, durationLabel, fa, guarded, h, icon, jalaliLong, money, showSpinner, toast } from './common.js';

const STEPS = ['خدمت', 'پرسنل', 'زمان', 'مشخصات'];
const state = { config: null, services: [], step: 1, service: null, staffId: 'any', staffName: 'هر کدام از پرسنل', date: null, time: null };
const view = $('#view');

function renderHero() {
  const { business } = state.config;
  document.title = `رزرو نوبت - ${business.name}`;
  $('#hero').replaceChildren(
    h('h1', {}, business.name),
    business.about && h('p', {}, business.about),
    h(
      'div',
      { class: 'hero-meta' },
      business.phone && h('a', { href: `tel:${business.phone}` }, icon('phone'), h('span', { class: 'ltr' }, fa(business.phone))),
      business.address && h('span', {}, business.address),
    ),
  );
}

function renderStepper() {
  $('#stepper').replaceChildren(
    ...STEPS.map((label, i) => {
      const n = i + 1;
      return h(
        'li',
        { class: n < state.step ? 'done' : '', 'aria-current': n === state.step ? 'step' : null },
        h('span', { class: 'num' }, n < state.step ? icon('check') : fa(n)),
        h('span', { class: 'lbl' }, label),
      );
    }),
  );
}

function go(step) {
  state.step = step;
  renderStepper();
  view.replaceChildren(...[stepService, stepStaff, stepTime, stepDetails][step - 1]());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const title = (t, sub) => [h('h2', { class: 'step-title' }, t), h('p', { class: 'step-sub' }, sub)];
const backButton = (to) => h('button', { class: 'btn', type: 'button', onclick: () => go(to) }, 'بازگشت');

// ---------- ۱. خدمت ----------

function stepService() {
  if (!state.services.length) {
    return [h('div', { class: 'card empty' }, 'در حال حاضر خدمتی برای رزرو آنلاین تعریف نشده است.')];
  }
  return [
    ...title('کدام خدمت را می‌خواهید؟', 'یکی از خدمات زیر را انتخاب کنید.'),
    h(
      'div',
      { class: 'options' },
      state.services.map((s) =>
        h(
          'button',
          {
            type: 'button',
            class: 'option',
            'aria-pressed': String(state.service?.id === s.id),
            onclick: () => {
              if (state.service?.id !== s.id) Object.assign(state, { service: s, staffId: 'any', staffName: 'هر کدام از پرسنل', date: null, time: null });
              // اگر فقط یک نفر این خدمت را انجام می‌دهد، مرحلهٔ انتخاب پرسنل لازم نیست
              if (s.staff.length === 1) Object.assign(state, { staffId: s.staff[0].id, staffName: s.staff[0].name });
              go(s.staff.length === 1 ? 3 : 2);
            },
          },
          h('span', { class: 't' }, s.name),
          s.description && h('span', { class: 'd' }, s.description),
          h('span', { class: 'side' }, h('span', { class: 'price' }, money(s.price)), h('span', { class: 'd' }, durationLabel(s.durationMin))),
        ),
      ),
    ),
  ];
}

// ---------- ۲. پرسنل ----------

function stepStaff() {
  const pick = (id, name) => {
    if (state.staffId !== id) Object.assign(state, { date: null, time: null });
    Object.assign(state, { staffId: id, staffName: name });
    go(3);
  };
  const option = (id, name, desc) =>
    h(
      'button',
      { type: 'button', class: 'option', 'aria-pressed': String(state.staffId === id), onclick: () => pick(id, name) },
      h('span', { class: 't' }, name),
      desc && h('span', { class: 'd' }, desc),
    );
  return [
    ...title('با چه کسی؟', 'می‌توانید پرسنل دلخواه را انتخاب کنید یا سیستم نزدیک‌ترین زمان خالی را پیدا کند.'),
    h('div', { class: 'options' }, option('any', 'هر کدام از پرسنل', 'نزدیک‌ترین زمان خالی'), state.service.staff.map((p) => option(p.id, p.name, p.title))),
    h('div', { class: 'actions' }, backButton(1)),
  ];
}

// ---------- ۳. تاریخ و ساعت ----------

function groupOf(min) {
  return min < 12 * 60 ? 'صبح' : min < 17 * 60 ? 'بعدازظهر' : 'عصر';
}

function stepTime() {
  const { config, service } = state;
  const slotsBox = h('div', { class: 'stack' });
  const hint = h('p', { class: 'legend' }, h('i'), 'روزهای دارای نقطهٔ سبز زمان خالی دارند.');
  const next = h('button', { class: 'btn primary', type: 'button', disabled: !state.time, onclick: () => go(4) }, 'ادامه');
  const hasStaffStep = service.staff.length > 1;

  async function loadSlots(date) {
    const keepTime = state.date === date ? state.time : null; // برگشت از مرحلهٔ بعد، ساعت انتخابی حفظ شود
    Object.assign(state, { date, time: keepTime });
    next.disabled = !keepTime;
    showSpinner(slotsBox);
    try {
      const { slots } = await api(`/api/public/slots?service=${service.id}&staff=${state.staffId}&date=${date}`);
      if (state.date !== date) return;
      if (keepTime && !slots.some((s) => s.time === keepTime)) {
        state.time = null;
        next.disabled = true;
      }
      if (!slots.length) {
        slotsBox.replaceChildren(h('div', { class: 'notice warn' }, 'برای این روز زمان خالی نمانده است.'));
        return;
      }
      const groups = new Map();
      for (const s of slots) groups.set(groupOf(s.start), [...(groups.get(groupOf(s.start)) ?? []), s]);
      slotsBox.replaceChildren(
        h('h3', {}, jalaliLong(date)),
        ...[...groups].map(([name, list]) =>
          h(
            'div',
            { class: 'slot-group' },
            h('h3', {}, name),
            h(
              'div',
              { class: 'chips' },
              list.map((s) =>
                h('button', {
                  type: 'button', class: 'chip', 'aria-pressed': String(state.time === s.time),
                  onclick: (e) => {
                    state.time = s.time;
                    next.disabled = false;
                    for (const c of slotsBox.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c === e.currentTarget));
                  },
                }, fa(s.time)),
              ),
            ),
          ),
        ),
      );
    } catch (err) {
      slotsBox.replaceChildren(h('div', { class: 'form-error' }, err.message));
    }
  }

  const calendar = createCalendar({
    initial: state.date ?? config.today.date,
    selected: state.date,
    today: config.today.date,
    minDate: config.today.date,
    maxDate: config.lastBookableDate,
    async enabledFor(jy, jm) {
      const { available } = await api(`/api/public/days?service=${service.id}&staff=${state.staffId}&jy=${jy}&jm=${jm}`);
      hint.hidden = false;
      hint.replaceChildren(h('i'), available.length ? 'روزهای دارای نقطهٔ سبز زمان خالی دارند.' : 'در این ماه زمان خالی وجود ندارد؛ ماه بعد را ببینید.');
      return new Set(available);
    },
    onSelect: loadSlots,
  });
  if (state.date) loadSlots(state.date);

  return [
    ...title('چه روزی و چه ساعتی؟', `${service.name} · ${durationLabel(service.durationMin)} · ${state.staffName}`),
    h('div', { class: 'stack' }, calendar.el, hint, slotsBox),
    h('div', { class: 'actions' }, backButton(hasStaffStep ? 2 : 1), next),
  ];
}

// ---------- ۴. مشخصات و ثبت ----------

function depositFor(price) {
  const { mode, depositPercent } = state.config.payment;
  if (mode === 'none' || price <= 0) return 0;
  if (mode === 'full') return price;
  return Math.min(price, Math.max(Math.ceil((price * depositPercent) / 100), 1000));
}

function stepDetails() {
  const { service, config } = state;
  const deposit = depositFor(service.price);
  const name = h('input', { class: 'input', id: 'name', autocomplete: 'name', required: true, maxlength: 60, placeholder: 'مثلاً علی رضایی' });
  const phone = h('input', { class: 'input', id: 'phone', type: 'tel', inputmode: 'tel', dir: 'ltr', autocomplete: 'tel', required: true, placeholder: '09123456789' });
  const notes = h('textarea', { class: 'input', id: 'notes', maxlength: 300, placeholder: 'اگر نکته‌ای هست بنویسید (اختیاری)' });
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, deposit > 0 ? 'ادامه و پرداخت' : 'ثبت نوبت');

  const line = (k, v) => h('div', { class: 'line' }, h('span', {}, k), h('b', {}, v));

  async function onSubmit(e) {
    e.preventDefault();
    error.hidden = true;
    await guarded(submit, async () => {
      try {
        const res = await api('/api/public/bookings', {
          method: 'POST',
          body: { serviceId: service.id, staffId: state.staffId, date: state.date, time: state.time, name: name.value, phone: phone.value, notes: notes.value },
        });
        location.href = res.paymentUrl || `/b/${res.code}?new=1`;
        await new Promise(() => {}); // تا تغییر صفحه، دکمه فعال نشود
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.status === 409) {
          toast(err.message, 'bad');
          state.time = null;
          if (/زمان/.test(err.message)) return go(3);
        }
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  }

  return [
    ...title('اطلاعات شما', 'برای ارسال تأیید و یادآوری، شمارهٔ موبایل را درست وارد کنید.'),
    h(
      'form',
      { class: 'stack', onsubmit: onSubmit, novalidate: true },
      h(
        'div',
        { class: 'summary' },
        line('خدمت', service.name),
        line('پرسنل', state.staffName),
        line('زمان', `${jalaliLong(state.date)}، ساعت ${fa(state.time)}`),
        line('مبلغ', money(service.price)),
      ),
      deposit > 0 &&
        h('div', { class: 'notice warn' }, `برای قطعی شدن نوبت باید ${money(deposit)}${deposit < service.price ? ` (${fa(config.payment.depositPercent)}٪ مبلغ)` : ''} به‌صورت آنلاین پرداخت کنید. زمان شما ${fa(config.rules.holdMin)} دقیقه برایتان نگه داشته می‌شود.`),
      h('div', { class: 'field' }, h('label', { for: 'name' }, 'نام و نام خانوادگی'), name),
      h('div', { class: 'field' }, h('label', { for: 'phone' }, 'شمارهٔ موبایل'), phone),
      h('div', { class: 'field' }, h('label', { for: 'notes' }, 'توضیحات'), notes),
      config.rules.cancelPolicy && h('p', { class: 'muted small' }, config.rules.cancelPolicy),
      error,
      h('div', { class: 'actions' }, backButton(3), submit),
    ),
  ];
}

// ---------- پیگیری با کد ----------

function renderFooter() {
  const code = h('input', { class: 'input latin', id: 'lookup', placeholder: 'کد پیگیری', maxlength: 8, 'aria-label': 'کد پیگیری نوبت', autocomplete: 'off' });
  $('#foot').replaceChildren(
    h('div', {}, 'قبلاً نوبت گرفته‌اید؟ با کد پیگیری، نوبت خود را ببینید یا لغو کنید.'),
    h('form', { class: 'lookup', onsubmit: (e) => { e.preventDefault(); const c = code.value.trim().toUpperCase(); if (c) location.href = `/b/${encodeURIComponent(c)}`; } }, code, h('button', { class: 'btn', type: 'submit' }, 'پیگیری')),
  );
}

async function init() {
  try {
    [state.config, { services: state.services }] = await Promise.all([api('/api/public/config'), api('/api/public/services')]);
  } catch (err) {
    view.replaceChildren(h('div', { class: 'form-error' }, err.message));
    return;
  }
  applyBrand(state.config.brandColor);
  renderHero();
  renderFooter();
  go(1);
}

init();

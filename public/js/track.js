import { $, api, applyBrand, confirmDialog, fa, guarded, h, icon, jalaliLong, money, statusBadge, toast } from './common.js';

const code = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() ?? '');
const params = new URLSearchParams(location.search);
const view = $('#view');
let timer = null;

const PAY_MESSAGES = {
  confirmed: { kind: 'ok', text: 'پرداخت با موفقیت انجام شد و نوبت شما قطعی شد.' },
  failed: { kind: 'bad', text: 'پرداخت انجام نشد. اگر مبلغی از حساب شما کسر شده، طی ۷۲ ساعت به حساب‌تان برمی‌گردد. تا پایان مهلت می‌توانید دوباره پرداخت کنید.' },
  expired_paid: { kind: 'warn', text: 'پرداخت انجام شد اما مهلت نگه‌داشتن این زمان تمام شده بود و زمان به کس دیگری رسیده است. لطفاً با ما تماس بگیرید تا مبلغ بازگردانده شود یا نوبت جدیدی بگیریم.' },
};

function statusHead(b) {
  const isNew = params.get('new') === '1';
  if (b.status === 'confirmed') return ['', isNew ? 'نوبت شما ثبت شد' : 'نوبت شما تأیید شده است', isNew ? 'کد پیگیری را نگه دارید و در صورت نیاز با آن نوبت را ببینید یا لغو کنید.' : ''];
  if (b.status === 'pending_payment') return ['warn', 'در انتظار پرداخت', 'برای قطعی شدن نوبت، مبلغ را پرداخت کنید.'];
  if (b.status === 'completed') return ['', 'این نوبت انجام شده است', ''];
  if (b.status === 'no_show') return ['bad', 'در این نوبت حضور پیدا نکردید', ''];
  return ['bad', 'این نوبت لغو شده است', ''];
}

function render(b) {
  clearInterval(timer);
  $('#hero').replaceChildren(h('h1', {}, b.business.name), h('p', {}, 'پیگیری نوبت'));
  document.title = `پیگیری نوبت - ${b.business.name}`;

  const [tone, heading, sub] = statusHead(b);
  const pay = PAY_MESSAGES[params.get('pay')];
  const row = (k, v) => v && h('div', {}, h('dt', {}, k), h('dd', {}, v));

  const countdown = h('span', { class: 'latin' });
  const tick = () => {
    const left = Math.max(0, b.holdSecondsLeft - Math.floor((performance.now() - started) / 1000));
    countdown.textContent = fa(`${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`);
    if (left === 0) { clearInterval(timer); load(); }
  };
  const started = performance.now();

  const actions = [];
  if (b.status === 'pending_payment' && b.holdSecondsLeft > 0) {
    const payBtn = h('button', { class: 'btn primary block', type: 'button' }, `پرداخت ${money(b.amountDue)}`);
    payBtn.addEventListener('click', () => guarded(payBtn, async () => { location.href = (await api(`/api/public/bookings/${code}/pay`, { method: 'POST' })).url; await new Promise(() => {}); }));
    actions.push(h('p', { class: 'notice warn' }, 'زمان باقی‌مانده برای پرداخت: ', countdown), payBtn);
    tick();
    timer = setInterval(tick, 1000);
  }
  if (b.canCancel) {
    const cancelBtn = h('button', { class: 'btn danger block', type: 'button' }, 'لغو نوبت');
    cancelBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('نوبت لغو شود؟', { confirmText: 'بله، لغو شود', danger: true }))) return;
      await guarded(cancelBtn, async () => { await api(`/api/public/bookings/${code}/cancel`, { method: 'POST' }); toast('نوبت لغو شد.', 'ok'); params.delete('new'); params.delete('pay'); await load(); });
    });
    actions.push(cancelBtn);
  } else if (b.status === 'confirmed') {
    actions.push(h('p', { class: 'muted small' }, `لغو آنلاین تا ${fa(b.cancelBeforeHours)} ساعت قبل از نوبت ممکن است. برای تغییر با ما تماس بگیرید${b.business.phone ? `: ${fa(b.business.phone)}` : '.'}`));
  }
  if (b.cancelPolicy && ['confirmed', 'pending_payment'].includes(b.status)) actions.push(h('p', { class: 'muted small' }, b.cancelPolicy));

  const copyBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(b.code); toast('کد کپی شد.', 'ok'); } catch { toast('کپی انجام نشد؛ کد را دستی بنویسید.', 'bad'); } } }, 'کپی');

  view.replaceChildren(
    h(
      'div',
      { class: 'card stack' },
      pay && h('div', { class: `notice ${pay.kind}`, role: 'status' }, pay.text),
      h('div', { class: 'status-head' },
        h('div', { class: `status-icon ${tone}` }, icon(b.status === 'confirmed' || b.status === 'completed' ? 'check' : b.status === 'pending_payment' ? 'clock' : 'x')),
        h('h1', {}, heading), sub && h('p', { class: 'muted' }, sub), statusBadge(b.status)),
      h('dl', { class: 'dl' },
        row('خدمت', b.serviceName), row('پرسنل', b.staffName), row('نام', b.customerName),
        row('تاریخ', jalaliLong(b.date)), row('ساعت', `${fa(b.start)} تا ${fa(b.end)}`),
        row('مبلغ', money(b.price)), b.paid > 0 && row('پرداخت‌شده', money(b.paid))),
      h('div', { class: 'code-box' }, h('div', {}, h('div', { class: 'muted small' }, 'کد پیگیری'), h('span', { class: 'latin' }, b.code)), copyBtn),
      ...actions,
      b.business.address && h('p', { class: 'muted small' }, `نشانی: ${b.business.address}`),
      h('a', { class: 'btn block', href: '/' }, 'ثبت نوبت جدید'),
    ),
  );
}

async function load() {
  try {
    const [{ booking }, config] = await Promise.all([api(`/api/public/bookings/${encodeURIComponent(code)}`), api('/api/public/config')]);
    applyBrand(config.brandColor);
    render(booking);
  } catch (err) {
    clearInterval(timer);
    view.replaceChildren(h('div', { class: 'card stack' }, h('div', { class: 'form-error', role: 'alert' }, err.message), h('a', { class: 'btn', href: '/' }, 'بازگشت به صفحهٔ رزرو')));
  }
}

load();

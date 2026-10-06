import { $, api, applyBrand, fa, field, guarded, h, icon, jalaliLong, latin, money, openDialog, statusBadge, toast } from './common.js';

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

/**
 * لغو نوبت در دو مرحله: ۱) ارسال کد ۶ رقمی به شمارهٔ موبایل ثبت‌شده در نوبت، ۲) وارد کردن کد.
 * کد پیگیری به‌تنهایی کافی نیست؛ فقط کسی که به آن گوشی دسترسی دارد می‌تواند نوبت را لغو کند.
 */
function startCancel(b) {
  let countdown = null;
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const intro = h('p', {}, 'برای اطمینان از اینکه شما صاحب این نوبت هستید، یک کد ۶ رقمی به شمارهٔ ', h('b', { class: 'ltr' }, fa(b.phoneMasked)), ' پیامک می‌شود.');
  const otp = h('input', { class: 'input latin', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8, placeholder: '------', 'aria-label': 'کد تأیید', style: 'text-align:center;font-size:20px' });
  const codeField = h('div', { hidden: true }, field('کد تأیید', otp));
  const sendBtn = h('button', { class: 'btn primary', type: 'button' }, 'ارسال کد تأیید');
  const confirmBtn = h('button', { class: 'btn solid-danger', type: 'button', hidden: true }, 'تأیید و لغو نوبت');
  const closeBtn = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف');

  const showError = (msg) => { error.textContent = msg; error.hidden = false; };

  function startCountdown(seconds) {
    clearInterval(countdown);
    let left = seconds;
    const tick = () => {
      sendBtn.disabled = left > 0;
      sendBtn.textContent = left > 0 ? `ارسال دوباره (${fa(left)} ثانیه)` : 'ارسال دوبارهٔ کد';
      if (left-- <= 0) clearInterval(countdown);
    };
    tick();
    countdown = setInterval(tick, 1000);
  }

  function afterSent(seconds) {
    intro.replaceChildren('کد تأیید به شمارهٔ ', h('b', { class: 'ltr' }, fa(b.phoneMasked)), ' ارسال شد. تا ۵ دقیقه معتبر است.');
    codeField.hidden = false;
    confirmBtn.hidden = false;
    otp.focus();
    startCountdown(seconds);
  }

  sendBtn.addEventListener('click', () =>
    guarded(sendBtn, async () => {
      error.hidden = true;
      try {
        const res = await api(`/api/public/bookings/${encodeURIComponent(b.code)}/cancel-code`, { method: 'POST' });
        afterSent(res.retryAfterSec ?? 60);
      } catch (err) {
        showError(err.message);
        if (err.data?.retryAfterSec) afterSent(err.data.retryAfterSec); // کد قبلی هنوز معتبر است
      }
    }),
  );

  confirmBtn.addEventListener('click', () =>
    guarded(confirmBtn, async () => {
      error.hidden = true;
      try {
        await api(`/api/public/bookings/${encodeURIComponent(b.code)}/cancel`, { method: 'POST', body: { otp: latin(otp.value) } });
        dlg.close();
        toast('نوبت لغو شد.', 'ok');
        params.delete('new');
        params.delete('pay');
        await load();
      } catch (err) {
        showError(err.message);
      }
    }),
  );
  otp.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmBtn.click(); });

  const dlg = openDialog({
    title: 'لغو نوبت',
    body: [intro, codeField, error],
    footer: [sendBtn, confirmBtn, closeBtn],
    onClose: () => clearInterval(countdown),
  });
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
  if (b.canCancel && b.cancelNeedsCode) {
    const cancelBtn = h('button', { class: 'btn danger block', type: 'button', onclick: () => startCancel(b) }, 'لغو نوبت');
    actions.push(cancelBtn);
  } else if (b.canCancel) {
    // پیامک خاموش است و راه امنی برای تأیید هویت وجود ندارد؛ لغو آنلاین عمداً بسته است
    actions.push(h('p', { class: 'muted small' }, `برای لغو این نوبت لطفاً با ما تماس بگیرید${b.business.phone ? `: ${fa(b.business.phone)}` : '.'}`));
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
        row('خدمت', b.serviceName), row('پرسنل', b.staffName), row('شمارهٔ موبایل', h('span', { class: 'ltr' }, fa(b.phoneMasked))),
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

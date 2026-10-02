import { api, applyBrand, field, guarded, h, toast } from '/js/common.js';

// [کلید، برچسب، نوع، توضیح/گزینه‌ها، شرط نمایش]
const SECTIONS = [
  {
    title: 'اطلاعات کسب‌وکار',
    fields: [
      ['business_name', 'نام کسب‌وکار', 'text'],
      ['business_phone', 'تلفن تماس', 'tel'],
      ['business_address', 'نشانی', 'text'],
      ['business_about', 'توضیح کوتاه (زیر عنوان صفحهٔ رزرو)', 'textarea'],
      ['brand_color', 'رنگ اصلی سایت', 'color'],
    ],
  },
  {
    title: 'قوانین رزرو',
    fields: [
      ['slot_step_min', 'فاصلهٔ زمان‌های پیشنهادی (دقیقه)', 'number', 'مثلاً ۳۰ یعنی ۹:۰۰، ۹:۳۰، ۱۰:۰۰ و …'],
      ['min_notice_min', 'حداقل فاصله تا شروع نوبت (دقیقه)', 'number', 'مشتری نوبتی را که کمتر از این مقدار به شروعش مانده نمی‌تواند رزرو کند. ۶۰ = یک ساعت.'],
      ['max_days_ahead', 'حداکثر چند روز آینده قابل رزرو باشد', 'number'],
      ['cancel_before_hours', 'مهلت لغو آنلاین (ساعت قبل از نوبت)', 'number'],
      ['max_active_per_phone', 'حداکثر نوبت فعال برای هر شماره', 'number', 'برای جلوگیری از رزرو الکی و اشغال وقت‌ها.'],
      ['cancel_policy', 'متن قوانین لغو (به مشتری نمایش داده می‌شود)', 'textarea'],
    ],
  },
  {
    title: 'پرداخت آنلاین',
    fields: [
      ['payment_mode', 'دریافت پرداخت', 'select', [['none', 'بدون پرداخت آنلاین'], ['deposit', 'بیعانه (درصدی از مبلغ)'], ['full', 'کل مبلغ']]],
      ['deposit_percent', 'درصد بیعانه', 'number', null, (v) => v.payment_mode === 'deposit'],
      ['hold_min', 'مهلت پرداخت (دقیقه)', 'number', 'تا این مدت، زمان انتخاب‌شده برای مشتری نگه داشته می‌شود؛ بعد از آن آزاد می‌شود.', (v) => v.payment_mode !== 'none'],
      ['payment_gateway', 'درگاه پرداخت', 'select', [['mock', 'آزمایشی (فقط برای تست، پول واقعی نمی‌گیرد)'], ['zarinpal', 'زرین‌پال']], (v) => v.payment_mode !== 'none'],
      ['zarinpal_merchant_id', 'مرچنت‌کد زرین‌پال', 'secret', null, (v) => v.payment_mode !== 'none' && v.payment_gateway === 'zarinpal'],
      ['zarinpal_sandbox', 'استفاده از محیط آزمایشی زرین‌پال', 'checkbox', null, (v) => v.payment_mode !== 'none' && v.payment_gateway === 'zarinpal'],
    ],
  },
  {
    title: 'پیامک',
    fields: [
      ['sms_enabled', 'ارسال پیامک فعال باشد', 'checkbox'],
      ['sms_provider', 'سرویس پیامک', 'select', [['console', 'آزمایشی (فقط ثبت در فهرست پیامک‌ها)'], ['kavenegar', 'کاوه‌نگار']], (v) => v.sms_enabled],
      ['kavenegar_api_key', 'کلید API کاوه‌نگار', 'secret', null, (v) => v.sms_enabled && v.sms_provider === 'kavenegar'],
      ['kavenegar_sender', 'شمارهٔ خط ارسال‌کننده', 'text', 'اگر خالی باشد خط پیش‌فرض حساب شما استفاده می‌شود.', (v) => v.sms_enabled && v.sms_provider === 'kavenegar'],
      ['reminder_hours', 'یادآوری چند ساعت قبل از نوبت (۰ = خاموش)', 'number', null, (v) => v.sms_enabled],
      ['sms_tpl_confirm', 'متن پیامک تأیید نوبت', 'textarea', 'متغیرها: {name} {service} {business} {date} {weekday} {time} {code} {link}', (v) => v.sms_enabled],
      ['sms_tpl_reminder', 'متن پیامک یادآوری', 'textarea', null, (v) => v.sms_enabled],
      ['sms_tpl_cancel', 'متن پیامک لغو', 'textarea', null, (v) => v.sms_enabled],
    ],
  },
];

export async function render(root, app) {
  const { settings } = await api('/api/admin/settings');
  const inputs = new Map(); // key → { el, read(), wrap }

  function makeInput([key, , type, extra]) {
    const value = settings[key];
    if (type === 'checkbox') {
      const el = h('input', { type: 'checkbox', checked: Boolean(value), onchange: refresh });
      return { el, read: () => el.checked, label: false };
    }
    if (type === 'select') {
      const el = h('select', { class: 'input', value, onchange: refresh }, extra.map(([v, label]) => h('option', { value: v }, label)));
      return { el, read: () => el.value };
    }
    if (type === 'textarea') {
      const el = h('textarea', { class: 'input', maxlength: 2000 }, value ?? '');
      return { el, read: () => el.value };
    }
    if (type === 'secret') {
      const el = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'off', placeholder: settings[`${key}_set`] ? '•••••••• (ذخیره شده؛ برای تغییر مقدار جدید بنویسید)' : '' });
      return { el, read: () => el.value };
    }
    if (type === 'number') {
      const el = h('input', { class: 'input', type: 'text', inputmode: 'numeric', dir: 'ltr', value: String(value) });
      return { el, read: () => Number(String(el.value).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06f0).replace(/\D/g, '')) };
    }
    if (type === 'color') {
      const el = h('input', { type: 'color', value, style: 'width:64px;height:44px;padding:2px;border:1px solid var(--line-strong);border-radius:10px;background:#fff' });
      return { el, read: () => el.value };
    }
    const el = h('input', { class: 'input', type: type === 'tel' ? 'tel' : 'text', value: value ?? '', maxlength: 200, dir: type === 'tel' ? 'ltr' : null });
    return { el, read: () => el.value };
  }

  const warn = h('div', { class: 'stack' });

  function values() {
    const out = {};
    for (const [key, { read }] of inputs) out[key] = read();
    return out;
  }

  function refresh() {
    const v = values();
    for (const sec of SECTIONS) {
      for (const f of sec.fields) {
        const cond = f[4];
        inputs.get(f[0]).wrap.hidden = cond ? !cond(v) : false;
      }
    }
    warn.replaceChildren(
      ...[
        v.payment_mode !== 'none' && v.payment_gateway === 'mock' && h('div', { class: 'notice warn' }, 'درگاه پرداخت روی «آزمایشی» است؛ مشتری بدون پرداخت واقعی نوبتش تأیید می‌شود. پیش از راه‌اندازی واقعی، زرین‌پال را انتخاب کنید.'),
        v.sms_enabled && v.sms_provider === 'console' && h('div', { class: 'notice warn' }, 'سرویس پیامک روی «آزمایشی» است؛ پیامکی برای مشتری فرستاده نمی‌شود.'),
      ].filter(Boolean),
    );
  }

  const cards = SECTIONS.map((sec) =>
    h('section', { class: 'card settings-card' }, h('h2', {}, sec.title),
      sec.fields.map((f) => {
        const [key, label, type, extra] = f;
        const made = makeInput(f);
        inputs.set(key, made);
        const hint = typeof extra === 'string' ? extra : null;
        const wrap = type === 'checkbox'
          ? h('label', { class: 'check' }, made.el, label)
          : field(label, made.el, hint);
        made.wrap = wrap;
        return wrap;
      })),
  );

  const save = h('button', { class: 'btn primary', type: 'button' }, 'ذخیره تنظیمات');
  save.addEventListener('click', () =>
    guarded(save, async () => {
      const { settings: saved } = await api('/api/admin/settings', { method: 'PUT', body: { settings: values() } });
      Object.assign(settings, saved);
      applyBrand(saved.brand_color);
      app.config.brandColor = saved.brand_color;
      toast('تنظیمات ذخیره شد.', 'ok');
    }),
  );

  // ---------- تغییر گذرواژه ----------
  const cur = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'current-password' });
  const nxt = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const rep = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const changePw = h('button', { class: 'btn', type: 'button' }, 'تغییر گذرواژه');
  changePw.addEventListener('click', () =>
    guarded(changePw, async () => {
      if (nxt.value !== rep.value) return toast('تکرار گذرواژه با گذرواژهٔ جدید یکسان نیست.', 'bad');
      await api('/api/admin/password', { method: 'POST', body: { current: cur.value, next: nxt.value } });
      cur.value = nxt.value = rep.value = '';
      toast('گذرواژه تغییر کرد.', 'ok');
    }),
  );

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'تنظیمات')),
    h('div', { class: 'stack' },
      warn, ...cards,
      h('div', { class: 'save-bar' }, save),
      h('section', { class: 'card settings-card' }, h('h2', {}, 'حساب کاربری'),
        field('گذرواژهٔ فعلی', cur), h('div', { class: 'form-grid' }, field('گذرواژهٔ جدید (حداقل ۸ حرف)', nxt), field('تکرار گذرواژهٔ جدید', rep)), h('div', {}, changePw)),
    ),
  );
  refresh();
}

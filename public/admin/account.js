import { api, confirmDialog, field, guarded, h, openDialog, toast } from '/js/common.js';

export const ROLE_LABEL = { owner: 'مدیر کل', staff: 'منشی' };

/** گذرواژهٔ تصادفی خوانا (بدون حروف شبیه هم) برای گذرواژه‌های موقت */
export function generatePassword(length = 14) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * فرم تغییر گذرواژه؛ هم در صفحهٔ «تغییر اجباری» و هم در پنجرهٔ «حساب من» استفاده می‌شود.
 * onDone پس از موفقیت صدا زده می‌شود.
 */
export function passwordForm({ onDone, submitLabel = 'تغییر گذرواژه' }) {
  const current = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const repeat = h('input', { class: 'input', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const form = h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        if (next.value !== repeat.value) {
          error.textContent = 'تکرار گذرواژه با گذرواژهٔ جدید یکسان نیست.';
          error.hidden = false;
          return;
        }
        await guarded(submit, async () => {
          try {
            await api('/api/admin/password', { method: 'POST', body: { current: current.value, next: next.value } });
            toast('گذرواژه تغییر کرد.', 'ok');
            await onDone?.();
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          }
        });
      },
    },
    field('گذرواژهٔ فعلی', current),
    field('گذرواژهٔ جدید', next, 'حداقل ۱۰ حرف؛ نباید شامل نام کاربری یا ساده و تکراری باشد.'),
    field('تکرار گذرواژهٔ جدید', repeat),
    error,
    submit,
  );
  return { el: form, focus: () => current.focus() };
}

/** پنجرهٔ «حساب من»: اطلاعات کاربر، تغییر گذرواژه و خروج از دستگاه‌های دیگر */
export function openAccount(app) {
  const { admin } = app;
  const form = passwordForm({ onDone: () => dlg.close() });
  const others = h('button', { class: 'btn', type: 'button' }, 'خروج از دستگاه‌های دیگر');
  others.addEventListener('click', async () => {
    if (!(await confirmDialog('نشست این حساب روی همهٔ دستگاه‌های دیگر بسته شود؟ (همین مرورگر وارد می‌ماند)', { confirmText: 'بله، ببند' }))) return;
    await guarded(others, async () => {
      await api('/api/admin/logout-all', { method: 'POST' });
      toast('از همهٔ دستگاه‌های دیگر خارج شدید.', 'ok');
    });
  });
  const dlg = openDialog({
    title: 'حساب من',
    body: [
      h('div', { class: 'notice' }, `${admin.name} · `, h('span', { class: 'ltr' }, admin.username), ` · ${ROLE_LABEL[admin.role] ?? admin.role}`),
      h('h3', {}, 'تغییر گذرواژه'),
      form.el,
      h('h3', {}, 'امنیت نشست‌ها'),
      h('p', { class: 'muted small' }, 'اگر روی دستگاه دیگری (مثلاً کامپیوتر دیگر) وارد شده‌اید و آن را فراموش کرده‌اید، از اینجا همهٔ آن‌ها را ببندید. با تغییر گذرواژه هم همهٔ نشست‌های دیگر بسته می‌شود.'),
      h('div', {}, others),
    ],
  });
}

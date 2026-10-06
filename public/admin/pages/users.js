import { ROLE_LABEL, generatePassword } from '/admin/account.js';
import { api, field, guarded, h, icon, openDialog, toast } from '/js/common.js';

const when = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' });

const ACTIONS = {
  login_ok: ['ورود موفق', ''],
  login_failed: ['ورود ناموفق', 'bad'],
  logout: ['خروج', ''],
  logout_all: ['خروج از همهٔ دستگاه‌ها', ''],
  password_changed: ['تغییر گذرواژه', ''],
  user_created: ['ساخت کاربر', ''],
  user_updated: ['ویرایش کاربر', ''],
  user_password_reset: ['بازنشانی گذرواژهٔ کاربر', ''],
  settings_changed: ['تغییر تنظیمات', ''],
  cancel_code_sent: ['ارسال کد لغو نوبت به مشتری', ''],
  cancel_code_failed: ['کد لغوِ اشتباه (مشتری)', 'bad'],
  cancelled_by_customer: ['لغو نوبت توسط مشتری', ''],
};

export async function render(root, app) {
  const me = app.admin;
  const usersBox = h('div', { class: 'rows' });
  const auditBox = h('div');
  let roles = {};

  async function load() {
    const [u, a] = await Promise.all([api('/api/admin/users'), api('/api/admin/audit')]);
    roles = u.roles;
    drawUsers(u.users);
    drawAudit(a.events);
  }

  function drawUsers(users) {
    usersBox.replaceChildren(
      ...users.map((u) =>
        h(
          'article',
          { class: `item${u.active ? '' : ' off'}` },
          h(
            'div',
            {},
            h('div', { class: 'title' }, h('b', {}, u.name), h('span', { class: 'ltr muted' }, u.username), h('span', { class: `pill${u.role === 'owner' ? '' : ' muted'}` }, ROLE_LABEL[u.role] ?? u.role),
              !u.active && h('span', { class: 'pill warn' }, 'غیرفعال'), u.mustChangePassword && h('span', { class: 'pill warn' }, 'گذرواژهٔ موقت'), u.id === me.id && h('span', { class: 'pill' }, 'شما')),
            h('div', { class: 'meta' }, u.lastLoginAt ? `آخرین ورود: ${when.format(new Date(u.lastLoginAt))}` : 'هنوز وارد نشده است'),
          ),
          h(
            'div',
            { class: 'acts' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => edit(u) }, icon('edit'), 'ویرایش'),
            u.id !== me.id && h('button', { class: 'btn sm', type: 'button', onclick: () => resetPassword(u) }, 'بازنشانی گذرواژه'),
          ),
        ),
      ),
    );
  }

  function drawAudit(events) {
    if (!events.length) {
      auditBox.replaceChildren(h('div', { class: 'card empty' }, 'هنوز رویدادی ثبت نشده است.'));
      return;
    }
    auditBox.replaceChildren(
      h('div', { class: 'scroll-x' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, ['زمان', 'کاربر', 'رویداد', 'جزئیات', 'IP'].map((t) => h('th', {}, t)))),
          h('tbody', {}, events.map((e) => {
            const [label, tone] = ACTIONS[e.action] ?? [e.action, ''];
            return h('tr', {},
              h('td', { style: 'white-space:nowrap' }, when.format(new Date(e.at))),
              h('td', {}, e.username ? h('span', { class: 'ltr' }, e.username) : h('span', { class: 'muted' }, '—')),
              h('td', {}, h('span', { class: `badge ${tone === 'bad' ? 'no_show' : 'confirmed'}` }, label)),
              h('td', { class: 'clip' }, h('span', { class: 'ltr', title: e.detail }, e.detail)),
              h('td', {}, h('span', { class: 'ltr muted' }, e.ip)));
          })))),
    );
  }

  /** فیلد گذرواژهٔ موقت با دکمهٔ تولید تصادفی */
  function tempPasswordField(label = 'گذرواژهٔ موقت') {
    const input = h('input', { class: 'input latin', type: 'text', dir: 'ltr', autocomplete: 'off', spellcheck: false });
    const gen = h('button', { class: 'btn sm', type: 'button', onclick: () => { input.value = generatePassword(); } }, 'تولید گذرواژهٔ تصادفی');
    return { input, el: h('div', { class: 'stack', style: 'gap:8px' }, field(label, input, 'حداقل ۱۰ حرف. کاربر در اولین ورود باید آن را عوض کند.'), h('div', {}, gen)) };
  }

  function create() {
    const name = h('input', { class: 'input', maxlength: 60 });
    const username = h('input', { class: 'input', dir: 'ltr', maxlength: 32, autocomplete: 'off', placeholder: 'مثلاً sara' });
    const role = h('select', { class: 'input', value: 'staff' }, Object.entries(roles).map(([k, v]) => h('option', { value: k }, v)));
    const pw = tempPasswordField();
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'ساخت کاربر');
    const dlg = openDialog({
      title: 'کاربر جدید',
      body: [
        h('div', { class: 'notice' }, 'منشی فقط «نوبت‌ها» و «مشتریان» را می‌بیند. مدیر کل به همهٔ بخش‌ها (تنظیمات، پرسنل، کاربران و …) دسترسی دارد.'),
        h('div', { class: 'form-grid' }, field('نام', name), field('نام کاربری (انگلیسی)', username)),
        field('نقش', role),
        pw.el,
        error,
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () => guarded(save, async () => {
      error.hidden = true;
      try {
        await api('/api/admin/users', { method: 'POST', body: { name: name.value, username: username.value, role: role.value, password: pw.input.value } });
        dlg.close();
        toast('کاربر ساخته شد. گذرواژهٔ موقت را به او بدهید.', 'ok');
        await load();
      } catch (err) { error.textContent = err.message; error.hidden = false; }
    }));
  }

  function edit(u) {
    const self = u.id === me.id;
    const name = h('input', { class: 'input', value: u.name, maxlength: 60 });
    const role = h('select', { class: 'input', value: u.role, disabled: self }, Object.entries(roles).map(([k, v]) => h('option', { value: k }, v)));
    const active = h('input', { type: 'checkbox', checked: u.active, disabled: self });
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'ذخیره');
    const dlg = openDialog({
      title: `ویرایش ${u.username}`,
      body: [
        field('نام', name),
        field('نقش', role),
        h('label', { class: 'check' }, active, 'فعال (کاربر غیرفعال نمی‌تواند وارد شود و نشست‌هایش فوراً بسته می‌شود)'),
        self && h('p', { class: 'muted small' }, 'نقش و وضعیت حساب خودتان را نمی‌توانید تغییر دهید.'),
        error,
      ],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () => guarded(save, async () => {
      error.hidden = true;
      try {
        await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { name: name.value, role: role.value, active: active.checked } });
        dlg.close();
        toast('ذخیره شد.', 'ok');
        await load();
      } catch (err) { error.textContent = err.message; error.hidden = false; }
    }));
  }

  function resetPassword(u) {
    const pw = tempPasswordField('گذرواژهٔ موقت جدید');
    const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'بازنشانی گذرواژه');
    const dlg = openDialog({
      title: `بازنشانی گذرواژهٔ ${u.username}`,
      body: [h('div', { class: 'notice warn' }, 'همهٔ نشست‌های باز این کاربر بسته می‌شود و در ورود بعدی باید گذرواژهٔ شخصی تعیین کند.'), pw.el, error],
      footer: [save, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'انصراف')],
    });
    save.addEventListener('click', () => guarded(save, async () => {
      error.hidden = true;
      try {
        await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: { password: pw.input.value } });
        dlg.close();
        toast('گذرواژه بازنشانی شد. گذرواژهٔ موقت را به کاربر بدهید.', 'ok');
        await load();
      } catch (err) { error.textContent = err.message; error.hidden = false; }
    }));
  }

  root.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'کاربران و امنیت'), h('button', { class: 'btn primary', type: 'button', onclick: create }, icon('plus'), 'کاربر جدید')),
    h('div', { class: 'stack' },
      usersBox,
      h('h2', { style: 'margin-top:12px' }, 'گزارش امنیتی'),
      h('p', { class: 'muted small' }, 'آخرین ورودها (موفق و ناموفق)، تغییر گذرواژه و حساب‌ها، تغییر تنظیمات و رویدادهای لغو نوبت توسط مشتری. ورودهای ناموفق پشت‌سرهم از یک IP یعنی کسی در حال امتحان گذرواژه است.'),
      auditBox),
  );
  await load();
}

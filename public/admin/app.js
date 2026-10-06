import { $, ApiError, api, applyBrand, field, guarded, h, icon, showSpinner, toast } from '/js/common.js';
import { ROLE_LABEL, openAccount, passwordForm } from './account.js';

// owner: true یعنی فقط برای مدیر کل (سرور هم همین را اعمال می‌کند؛ اینجا فقط منو را مرتب می‌کنیم)
const PAGES = [
  { id: 'appointments', label: 'نوبت‌ها' },
  { id: 'services', label: 'خدمات', owner: true },
  { id: 'staff', label: 'پرسنل', owner: true },
  { id: 'timeoff', label: 'مرخصی و تعطیلات', owner: true },
  { id: 'customers', label: 'مشتریان' },
  { id: 'sms', label: 'پیامک‌ها', owner: true },
  { id: 'users', label: 'کاربران و امنیت', owner: true },
  { id: 'settings', label: 'تنظیمات', owner: true },
];
const allowedPages = () => PAGES.filter((p) => !p.owner || app.admin?.role === 'owner');

const app = { config: null, admin: null };
const root = $('#root');
let renderToken = 0;

// ---------- ورود ----------

function renderLogin(needsSetup) {
  document.title = 'ورود به پنل مدیریت';
  const username = h('input', { class: 'input', id: 'u', dir: 'ltr', autocomplete: 'username', required: true, autofocus: true });
  const password = h('input', { class: 'input', id: 'p', type: 'password', dir: 'ltr', autocomplete: 'current-password', required: true });
  const error = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn primary block', type: 'submit' }, 'ورود');

  const form = h(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        await guarded(submit, async () => {
          try {
            const { admin } = await api('/api/admin/login', { method: 'POST', body: { username: username.value, password: password.value } });
            app.admin = admin;
            boot();
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
          }
        });
      },
    },
    h('div', {}, h('h1', {}, app.config?.business.name ?? 'پنل مدیریت'), h('p', { class: 'muted' }, 'ورود به پنل مدیریت نوبت‌دهی')),
    needsSetup && h('div', { class: 'notice warn' }, 'هنوز حساب مدیری ساخته نشده است. در پوشهٔ پروژه این دستور را اجرا کنید: ', h('code', { class: 'ltr' }, 'npm run create-admin')),
    field('نام کاربری', username),
    field('گذرواژه', password),
    error,
    submit,
  );
  root.replaceChildren(h('div', { class: 'login' }, form));
}

// ---------- تغییر اجباری گذرواژهٔ موقت ----------

function renderForcedPasswordChange() {
  document.title = 'تعیین گذرواژهٔ جدید';
  const form = passwordForm({ onDone: boot, submitLabel: 'ذخیره و ورود به پنل' });
  root.replaceChildren(
    h('div', { class: 'login' },
      h('div', { class: 'card' },
        h('div', {}, h('h1', {}, 'تعیین گذرواژهٔ جدید'), h('p', { class: 'muted' }, `سلام ${app.admin.name}`)),
        h('div', { class: 'notice warn' }, 'گذرواژهٔ فعلی شما موقتی است و مدیر آن را می‌داند. برای ادامه، گذرواژهٔ شخصی خودتان را تعیین کنید.'),
        form.el,
        h('button', { class: 'btn ghost', type: 'button', onclick: logout }, 'خروج'))));
  form.focus();
}

// ---------- قاب اصلی ----------

function renderShell() {
  const links = allowedPages().map((p) => h('a', { href: `#/${p.id}`, dataset: { page: p.id } }, p.label));
  root.replaceChildren(
    h(
      'div',
      { class: 'shell' },
      h(
        'aside',
        { class: 'side' },
        h('div', { class: 'brand' }, app.config.business.name, h('small', {}, 'پنل مدیریت')),
        h('nav', { class: 'nav', 'aria-label': 'منوی اصلی' }, links),
        h(
          'div',
          { class: 'side-foot' },
          h('a', { href: '/', target: '_blank', rel: 'noopener' }, icon('calendar'), h('span', { class: 'txt' }, 'صفحهٔ رزرو مشتری')),
          h('button', { type: 'button', onclick: () => openAccount(app) }, icon('user'), h('span', { class: 'txt' }, `حساب من · ${ROLE_LABEL[app.admin.role] ?? ''}`)),
          h('button', { type: 'button', onclick: logout }, icon('logout'), h('span', { class: 'txt' }, `خروج (${app.admin.username})`)),
        ),
      ),
      h('main', { class: 'main', id: 'page', tabindex: '-1' }),
    ),
  );
}

async function logout() {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  app.admin = null;
  location.hash = '';
  renderLogin(false);
}

async function route() {
  if (!app.admin) return;
  // صفحه‌ای که این نقش به آن دسترسی ندارد به «نوبت‌ها» برمی‌گردد (سرور هم دسترسی را رد می‌کند)
  const requested = location.hash.slice(2);
  const id = allowedPages().some((p) => p.id === requested) ? requested : 'appointments';
  const page = PAGES.find((p) => p.id === id);
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.page === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${page.label} - ${app.config.business.name}`;

  const container = $('#page');
  const token = ++renderToken;
  showSpinner(container);
  try {
    const mod = await import(`./pages/${id}.js`);
    const fragment = h('div');
    await mod.render(fragment, app);
    if (token !== renderToken) return; // کاربر به صفحهٔ دیگری رفته
    container.replaceChildren(...fragment.childNodes);
  } catch (err) {
    if (token !== renderToken) return;
    if (err instanceof ApiError && (err.status === 401 || err.code === 'password_change_required')) return; // رویدادهای سراسری رسیدگی می‌کنند
    console.error(err);
    container.replaceChildren(h('div', { class: 'form-error', role: 'alert' }, err.message));
  }
}

async function boot() {
  try {
    const [session, config] = await Promise.all([api('/api/admin/session'), api('/api/public/config')]);
    app.config = config;
    applyBrand(config.brandColor);
    if (!session.admin) return renderLogin(session.needsSetup);
    app.admin = session.admin;
    if (session.admin.mustChangePassword) return renderForcedPasswordChange();
    renderShell();
    route();
  } catch (err) {
    root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card form-error' }, err.message)));
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('password-change-required', () => {
  if (app.admin && !app.admin.mustChangePassword) {
    app.admin.mustChangePassword = true;
    renderForcedPasswordChange();
  }
});
window.addEventListener('session-expired', () => {
  if (app.admin) {
    app.admin = null;
    toast('نشست شما پایان یافت. دوباره وارد شوید.', 'bad');
    renderLogin(false);
  }
});

boot();

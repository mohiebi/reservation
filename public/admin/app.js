import { $, ApiError, api, applyBrand, field, guarded, h, icon, showSpinner, toast } from '/js/common.js';

const PAGES = [
  { id: 'appointments', label: 'نوبت‌ها' },
  { id: 'services', label: 'خدمات' },
  { id: 'staff', label: 'پرسنل' },
  { id: 'timeoff', label: 'مرخصی و تعطیلات' },
  { id: 'customers', label: 'مشتریان' },
  { id: 'sms', label: 'پیامک‌ها' },
  { id: 'settings', label: 'تنظیمات' },
];

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

// ---------- قاب اصلی ----------

function renderShell() {
  const links = PAGES.map((p) => h('a', { href: `#/${p.id}`, dataset: { page: p.id } }, p.label));
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
  const id = PAGES.some((p) => p.id === location.hash.slice(2)) ? location.hash.slice(2) : 'appointments';
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
    if (err instanceof ApiError && err.status === 401) return renderLogin(false);
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
    renderShell();
    route();
  } catch (err) {
    root.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card form-error' }, err.message)));
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('session-expired', () => {
  if (app.admin) {
    app.admin = null;
    toast('نشست شما پایان یافت. دوباره وارد شوید.', 'bad');
    renderLogin(false);
  }
});

boot();

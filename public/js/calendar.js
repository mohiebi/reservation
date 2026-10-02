import { api, fa, h, icon, jalaliLong } from './common.js';

const DOW = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/**
 * تقویم شمسی.
 *  - initial: تاریخ ISO که ماه اولیه از روی آن تعیین می‌شود
 *  - enabledFor(jy, jm) → Promise<Set<ISO>|null>: روزهای قابل انتخاب؛ null یعنی همه (در بازهٔ min/max)
 *  - minDate / maxDate: محدودهٔ مجاز (ISO)
 */
export function createCalendar({ initial, selected = null, today, minDate = null, maxDate = null, enabledFor = null, onSelect }) {
  let view = null; // { jy, jm }
  let current = selected;
  let ticket = 0;
  const root = h('div', { class: 'cal' });

  async function draw(query) {
    const mine = ++ticket;
    root.classList.add('cal-loading');
    let grid;
    try {
      grid = await api(`/api/public/calendar?${query}`);
      view = { jy: grid.jy, jm: grid.jm };
      const enabled = enabledFor ? await enabledFor(grid.jy, grid.jm) : null;
      if (mine !== ticket) return; // درخواست قدیمی‌تر
      paint(grid, enabled);
    } catch (err) {
      if (mine === ticket) root.replaceChildren(h('div', { class: 'form-error' }, err.message));
    } finally {
      if (mine === ticket) root.classList.remove('cal-loading');
    }
  }

  function paint(grid, enabled) {
    const first = grid.days[0].date;
    const last = grid.days.at(-1).date;
    const prevDisabled = minDate != null && minDate >= first;
    const nextDisabled = maxDate != null && maxDate <= last;

    const cells = [...DOW.map((d) => h('div', { class: 'cal-dow', 'aria-hidden': 'true' }, d))];
    for (let i = 0; i < grid.firstWeekday; i++) cells.push(h('div'));
    for (const day of grid.days) {
      const inRange = (!minDate || day.date >= minDate) && (!maxDate || day.date <= maxDate);
      const allowed = inRange && (enabled == null || enabled.has(day.date));
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: `cal-day${day.date === today ? ' today' : ''}${enabled?.has(day.date) ? ' has' : ''}`,
            disabled: !allowed,
            'aria-pressed': String(day.date === current),
            'aria-label': jalaliLong(day.date),
            onclick: () => {
              current = day.date;
              syncPressed();
              onSelect?.(day.date);
            },
            dataset: { date: day.date },
          },
          fa(day.jd),
        ),
      );
    }

    root.replaceChildren(
      h(
        'div',
        { class: 'cal-head' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'ماه قبل', disabled: prevDisabled, onclick: () => draw(`jy=${grid.prev.jy}&jm=${grid.prev.jm}`) }, icon('right')),
        h('div', { class: 'cal-title', 'aria-live': 'polite' }, `${grid.monthName} ${fa(grid.jy)}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'ماه بعد', disabled: nextDisabled, onclick: () => draw(`jy=${grid.next.jy}&jm=${grid.next.jm}`) }, icon('left')),
      ),
      h('div', { class: 'cal-grid' }, cells),
    );
  }

  function syncPressed() {
    for (const b of root.querySelectorAll('.cal-day')) b.setAttribute('aria-pressed', String(b.dataset.date === current));
  }

  draw(`date=${initial}`);

  return {
    el: root,
    setSelected(iso) {
      current = iso;
      syncPressed();
    },
    refresh() {
      return view ? draw(`jy=${view.jy}&jm=${view.jm}`) : draw(`date=${initial}`);
    },
  };
}

/** فیلد تاریخ جمع‌شونده برای فرم‌ها: یک دکمه که تقویم را باز و بسته می‌کند */
export function dateField({ today, value, minDate = null, maxDate = null, onChange }) {
  let current = value;
  const label = h('span', { class: 'grow' }, current ? jalaliLong(current) : 'انتخاب تاریخ');
  const holder = h('div', { hidden: true });
  const button = h(
    'button',
    { type: 'button', class: 'input row', 'aria-expanded': 'false', style: 'justify-content:flex-start;cursor:pointer;text-align:start', onclick: toggle },
    icon('calendar'),
    label,
  );
  let calendar = null;

  function toggle() {
    const opening = holder.hidden;
    holder.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
    if (opening && !calendar) {
      calendar = createCalendar({
        initial: current ?? today,
        selected: current,
        today,
        minDate,
        maxDate,
        onSelect(iso) {
          current = iso;
          label.textContent = jalaliLong(iso);
          holder.hidden = true;
          button.setAttribute('aria-expanded', 'false');
          onChange?.(iso);
        },
      });
      holder.append(calendar.el);
    }
  }

  return {
    el: h('div', { class: 'stack', style: 'gap:8px' }, button, holder),
    get value() {
      return current;
    },
    set(iso) {
      current = iso;
      label.textContent = jalaliLong(iso);
      calendar?.setSelected(iso);
    },
  };
}

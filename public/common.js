'use strict';
// Small helpers shared by the family page and the admin dashboard.

const App = (() => {
  let cfg = { currency: '₹', locale: 'en-IN' };
  const ready = fetch('/api/config')
    .then((r) => r.json())
    .then((c) => { cfg = c; })
    .catch(() => {});

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const sum = (list) => list.reduce((s, e) => s + e.amount, 0);

  function money(n) {
    const v = Number(n) || 0;
    const whole = Math.abs(v - Math.round(v)) < 0.005;
    return cfg.currency + v.toLocaleString(cfg.locale, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }

  function prettyDate(s, { short = false } = {}) {
    const t = todayStr();
    if (s === t) return 'Today';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (s === ymd(y)) return 'Yesterday';
    const d = parseYmd(s);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, {
      weekday: short ? undefined : 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric',
    });
  }

  // '2026-10' -> 'October 2026'
  function monthLabel(m, { short = false } = {}) {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' });
  }

  const addMonths = (m, by) => {
    const [y, mo] = m.split('-').map(Number);
    return ymd(new Date(y, mo - 1 + by, 1)).slice(0, 7);
  };

  // Everything the budget screens need, for one person's expenses and their monthly budget.
  function budgetStats(expenses, budget, month = todayStr().slice(0, 7), today = todayStr()) {
    const [y, mo] = month.split('-').map(Number);
    const days = new Date(y, mo, 0).getDate();
    const isCurrent = month === today.slice(0, 7);
    const elapsed = isCurrent ? Number(today.slice(8, 10)) : days; // days gone, including today
    const inMonth = expenses.filter((e) => e.date.startsWith(month));
    const spent = sum(inMonth);
    const left = budget - spent;
    const daysLeft = isCurrent ? days - elapsed + 1 : 0;
    return {
      month, budget, spent, left, days, elapsed, daysLeft, isCurrent,
      count: inMonth.length,
      todaySpent: sum(expenses.filter((e) => e.date === today)),
      hasBudget: budget > 0,
      over: budget > 0 && left < 0,
      pct: budget > 0 ? (spent / budget) * 100 : 0,
      perDayLeft: left > 0 && daysLeft > 0 ? left / daysLeft : 0,
      avgPerDay: spent / Math.max(1, elapsed),
      projected: (spent / Math.max(1, elapsed)) * days,
    };
  }

  async function api(url, opts = {}) {
    let res;
    try {
      res = await fetch(url, {
        credentials: 'same-origin',
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      });
    } catch {
      const e = new Error('No internet connection. Please try again.');
      e.status = 0;
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) {
      const e = new Error((data && data.error) || 'Something went wrong. Please try again.');
      e.status = res.status;
      throw e;
    }
    return data;
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }

  let toastTimer;
  function toast(msg, bad = false) {
    let el = document.getElementById('toast');
    if (!el) {
      el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(el);
    }
    el.textContent = msg;
    el.classList.toggle('bad', bad);
    void el.offsetWidth; // replay the transition
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), bad ? 5000 : 3200);
  }

  function viewPhoto(src, caption) {
    const dlg = h('dialog', { class: 'viewer' },
      h('img', { src, alt: caption || 'Photo' }),
      caption ? h('div', { class: 'cap' }, caption) : null,
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close'),
    );
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    dlg.showModal();
  }

  // One expense row. opts: onDelete (shows Remove), showDate (default true), showMember (admin view).
  function entryRow(e, opts = {}) {
    const thumb = e.thumb
      ? h('button', {
          class: 'thumb', style: `background-image:url('${e.thumb}')`, 'aria-label': 'View photo',
          onclick: () => viewPhoto(e.photo || e.thumb, [e.note, money(e.amount)].filter(Boolean).join(' — ')),
        })
      : h('div', { class: 'thumb none', 'aria-hidden': 'true' }, '\u{1F9FE}');
    const when = [opts.showMember ? e.memberName : null, opts.showDate === false ? null : prettyDate(e.date)]
      .filter(Boolean).join(' · ');
    return h('div', { class: 'entry' + (opts.fresh ? ' fresh' : '') },
      thumb,
      h('div', { class: 'body' },
        h('div', { class: 'note' + (e.note ? '' : ' empty') }, e.note || 'No note'),
        h('div', { class: 'when' }, when),
        opts.onDelete ? h('button', { class: 'link danger small', onclick: () => opts.onDelete(e) }, 'Remove') : null,
      ),
      h('div', { class: 'amt' }, money(e.amount)),
    );
  }

  return {
    ready, money, api, h, toast, viewPhoto, entryRow, ymd, todayStr, parseYmd, prettyDate,
    monthLabel, addMonths, budgetStats, sum,
  };
})();

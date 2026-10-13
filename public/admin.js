'use strict';

(async function () {
  await App.ready;
  const $ = (id) => document.getElementById(id);
  const { h, money, api, toast, ymd, todayStr } = App;

  let expenses = [];
  let viewMonth = todayStr().slice(0, 7);
  let selectedDay = null;

  const sum = (list) => list.reduce((s, e) => s + e.amount, 0);
  const monthLabel = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };
  const shiftMonth = (m, by) => {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + by, 1);
    return ymd(d).slice(0, 7);
  };

  // ---------- sign in ----------

  function show(which) {
    $('login').hidden = which !== 'login';
    $('dash').hidden = which !== 'dash';
  }

  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('loginError');
    const btn = ev.target.querySelector('button');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Opening…';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ pin: $('pin').value }) });
      $('pin').value = '';
      await boot();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Open';
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  $('copy').addEventListener('click', async () => {
    const input = $('momLink');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    toast('Link copied');
  });

  // ---------- dashboard ----------

  function renderStats() {
    const today = todayStr();
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = ymd(monday);
    const month = today.slice(0, 7);
    $('sToday').textContent = money(sum(expenses.filter((e) => e.date === today)));
    $('sWeek').textContent = money(sum(expenses.filter((e) => e.date >= weekStart && e.date <= today)));
    $('sMonth').textContent = money(sum(expenses.filter((e) => e.date.startsWith(month))));
    $('sAll').textContent = money(sum(expenses));
  }

  function renderMonth() {
    const inMonth = expenses.filter((e) => e.date.startsWith(viewMonth));
    const [y, mo] = viewMonth.split('-').map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const isCurrent = viewMonth === todayStr().slice(0, 7);
    const daysElapsed = isCurrent ? new Date().getDate() : daysInMonth;
    const total = sum(inMonth);

    $('monthName').textContent = monthLabel(viewMonth);
    $('next').disabled = isCurrent;
    $('kTotal').textContent = money(total);
    $('kCount').textContent = inMonth.length;
    $('kAvg').textContent = money(total / Math.max(1, daysElapsed));
    $('kMax').textContent = inMonth.length ? money(Math.max(...inMonth.map((e) => e.amount))) : money(0);

    // daily chart
    const perDay = new Array(daysInMonth).fill(0);
    const countDay = new Array(daysInMonth).fill(0);
    for (const e of inMonth) {
      const d = Number(e.date.slice(8, 10)) - 1;
      perDay[d] += e.amount;
      countDay[d]++;
    }
    const peak = Math.max(...perDay, 1);
    const chart = $('chart');
    const labels = $('chartLabels');
    chart.style.gridTemplateColumns = labels.style.gridTemplateColumns = `repeat(${daysInMonth}, 1fr)`;
    chart.replaceChildren();
    labels.replaceChildren();
    const readout = $('readout');

    function pick(d) {
      selectedDay = selectedDay === d ? null : d;
      chart.querySelectorAll('.bar').forEach((b, i) => b.classList.toggle('sel', i === selectedDay));
      if (selectedDay === null) {
        readout.textContent = 'Tap a bar to see that day.';
      } else {
        const date = `${viewMonth}-${String(d + 1).padStart(2, '0')}`;
        const n = countDay[d];
        readout.textContent = `${App.prettyDate(date)}: ${money(perDay[d])}` + (n ? ` (${n} ${n === 1 ? 'entry' : 'entries'})` : ' — nothing spent');
      }
    }

    perDay.forEach((v, i) => {
      const bar = h('button', {
        class: 'bar' + (v ? '' : ' zero'),
        style: `height:${v ? Math.max(4, (v / peak) * 100) : 2}%`,
        'aria-label': `${i + 1}: ${money(v)}`,
        onclick: () => pick(i),
      });
      chart.append(h('div', { class: 'col' }, bar));
      const day = i + 1;
      labels.append(h('span', null, day === 1 || day % 5 === 0 || day === daysInMonth ? String(day) : ''));
    });
    selectedDay = null;
    readout.textContent = inMonth.length ? 'Tap a bar to see that day.' : 'Nothing spent this month yet.';

    // entries grouped by day
    $('listTitle').textContent = `Everything in ${monthLabel(viewMonth)}`;
    const box = $('entries');
    box.replaceChildren();
    if (!inMonth.length) {
      box.append(h('div', { class: 'empty-state' }, 'No expenses this month.'));
      return;
    }
    const byDate = new Map();
    for (const e of inMonth) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    for (const [date, list] of byDate) {
      box.append(h('div', { class: 'daygroup' },
        h('div', { class: 'dayhead' }, h('span', null, App.prettyDate(date)), h('span', null, money(sum(list)))),
        list.map((e) => App.entryRow(e, { showDate: false, onDelete: remove })),
      ));
    }
  }

  function renderMonths() {
    const totals = new Map();
    for (const e of expenses) {
      const m = e.date.slice(0, 7);
      totals.set(m, (totals.get(m) || 0) + e.amount);
    }
    const months = [...totals.keys()].sort().reverse().slice(0, 12);
    $('monthsCard').hidden = months.length < 2;
    const peak = Math.max(...totals.values(), 1);
    const box = $('months');
    box.replaceChildren();
    for (const m of months) {
      box.append(h('button', {
        class: 'row' + (m === viewMonth ? ' sel' : ''),
        onclick: () => { viewMonth = m; renderMonth(); renderMonths(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      },
        h('span', { class: 'name' }, monthLabel(m)),
        h('span', { class: 'track' }, h('span', { class: 'fill', style: `display:block;width:${(totals.get(m) / peak) * 100}%` })),
        h('span', { class: 'total' }, money(totals.get(m))),
      ));
    }
  }

  async function remove(e) {
    const what = [e.note, money(e.amount)].filter(Boolean).join(' — ');
    if (!confirm(`Remove this expense?\n\n${what}`)) return;
    try {
      await api('/api/expenses/' + e.id, { method: 'DELETE' });
      await load();
      toast('Removed');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function load() {
    expenses = (await api('/api/expenses')).expenses;
    renderStats();
    renderMonth();
    renderMonths();
  }

  $('prev').addEventListener('click', () => { viewMonth = shiftMonth(viewMonth, -1); renderMonth(); renderMonths(); });
  $('next').addEventListener('click', () => {
    if (viewMonth < todayStr().slice(0, 7)) { viewMonth = shiftMonth(viewMonth, 1); renderMonth(); renderMonths(); }
  });

  async function boot() {
    try {
      const me = await api('/api/admin/me');
      $('momLink').value = `${location.origin}/?key=${me.accessKey}`;
      await load();
      show('dash');
    } catch (err) {
      show('login');
      if (err.status !== 401) toast(err.message, true);
    }
  }

  boot();
})();

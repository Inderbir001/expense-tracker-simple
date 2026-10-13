'use strict';

(async function () {
  await App.ready;
  const $ = (id) => document.getElementById(id);
  const { h, money, api, toast, ymd, todayStr } = App;

  let members = []; // everyone the admin manages
  let expenses = []; // everyone's expenses
  let who = 'all'; // 'all' or a member id (or 'admin')
  let viewMonth = todayStr().slice(0, 7);
  let selectedDay = null;
  let editing = null;

  const sum = App.sum;
  const mine = () => (who === 'all' ? expenses : expenses.filter((e) => e.memberId === who));
  const active = () => members.filter((m) => m.active);

  // ---------- sign out ----------

  $('logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  $('copy').addEventListener('click', async () => {
    const input = $('siteLink');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    toast('Address copied');
  });

  // ---------- menu + pages (hamburger) ----------

  const PAGES = { overview: 'pageOverview', expenses: 'pageExpenses', members: 'pageMembers', share: 'pageShare' };
  const TITLES = { overview: 'Overview', expenses: 'All expenses', members: 'Family members', share: 'Share & export' };
  const FILTERED = new Set(['overview', 'expenses']); // pages that use the person + month filters

  function setDrawer(open) {
    $('drawer').hidden = !open;
    $('menuBtn').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('no-scroll', open);
  }
  $('menuBtn').addEventListener('click', () => setDrawer($('drawer').hidden));
  $('drawerBackdrop').addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });

  function route() {
    const page = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
    Object.entries(PAGES).forEach(([key, id]) => { $(id).hidden = key !== page; });
    $('filters').hidden = !FILTERED.has(page);
    $('appTitle').textContent = TITLES[page];
    document.querySelectorAll('.drawer a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
    setDrawer(false);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ---------- who chips ----------

  function renderChips() {
    const box = $('chips');
    box.replaceChildren();
    const add = (id, label) => box.append(h('button', {
      class: 'chip' + (who === id ? ' on' : ''), role: 'tab', 'aria-selected': String(who === id),
      onclick: () => { who = id; selectedDay = null; renderAll(); },
    }, label));
    add('all', 'Everyone');
    members.forEach((m) => { if (m.active || expenses.some((e) => e.memberId === m.id)) add(m.id, m.name + (m.active ? '' : ' (off)')); });
    if (expenses.some((e) => e.memberId === 'admin')) add('admin', 'Admin');
    if (!members.length) box.append(h('span', { class: 'muted small' }, 'Add your first family member below.'));
  }

  // ---------- numbers ----------

  function renderStats() {
    const list = mine();
    const today = todayStr();
    const now = new Date();
    const weekStart = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
    const month = today.slice(0, 7);
    $('sToday').textContent = money(sum(list.filter((e) => e.date === today)));
    $('sWeek').textContent = money(sum(list.filter((e) => e.date >= weekStart && e.date <= today)));
    $('sMonth').textContent = money(sum(list.filter((e) => e.date.startsWith(month))));
    $('sAll').textContent = money(sum(list));
  }

  function meter(pct) {
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return h('div', { class: 'meter ' + cls }, h('div', { style: `width:${Math.min(100, pct)}%` }));
  }

  // Budget, spent, left per person for the selected month.
  function renderBudgets() {
    const box = $('budgets');
    box.replaceChildren();
    const rows = (who === 'all' ? active() : members.filter((m) => m.id === who));
    if (who === 'admin' || (!rows.length && who === 'all')) {
      box.append(h('div', { class: 'empty-state' }, members.length ? 'Nothing to show.' : 'No family members yet. Add one below.'));
      return;
    }
    let totalBudget = 0;
    let totalSpent = 0;
    rows.forEach((m) => {
      const s = App.budgetStats(expenses.filter((e) => e.memberId === m.id), m.budget, viewMonth);
      totalBudget += m.budget;
      totalSpent += s.spent;
      box.append(h('div', { class: 'brow' },
        h('div', { class: 'bhead' },
          h('strong', null, m.name),
          h('span', { class: 'muted small' }, s.hasBudget ? `${Math.round(s.pct)}% used` : 'No budget set')),
        s.hasBudget ? meter(s.pct) : null,
        h('div', { class: 'bnums' },
          h('div', null, h('span', { class: 'k' }, 'Budget '), h('b', null, s.hasBudget ? money(s.budget) : '—')),
          h('div', null, h('span', { class: 'k' }, 'Spent '), h('b', null, money(s.spent))),
          h('div', null, h('span', { class: 'k' }, s.over ? 'Over by ' : 'Left '),
            h('b', { class: s.hasBudget ? (s.over ? 'bad' : 'good') : '' }, s.hasBudget ? money(Math.abs(s.left)) : '—')),
        )));
    });
    if (who === 'all' && rows.length > 1) {
      const left = totalBudget - totalSpent;
      box.append(h('div', { class: 'brow total' },
        h('div', { class: 'bhead' }, h('strong', null, 'Whole family'),
          h('span', { class: 'muted small' }, totalBudget > 0 ? `${Math.round((totalSpent / totalBudget) * 100)}% used` : '')),
        totalBudget > 0 ? meter((totalSpent / totalBudget) * 100) : null,
        h('div', { class: 'bnums' },
          h('div', null, h('span', { class: 'k' }, 'Budget '), h('b', null, totalBudget > 0 ? money(totalBudget) : '—')),
          h('div', null, h('span', { class: 'k' }, 'Spent '), h('b', null, money(totalSpent))),
          h('div', null, h('span', { class: 'k' }, left < 0 ? 'Over by ' : 'Left '),
            h('b', { class: totalBudget > 0 ? (left < 0 ? 'bad' : 'good') : '' }, totalBudget > 0 ? money(Math.abs(left)) : '—')),
        )));
    }
  }

  function renderMonth() {
    const inMonth = mine().filter((e) => e.date.startsWith(viewMonth));
    const [y, mo] = viewMonth.split('-').map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const isCurrent = viewMonth === todayStr().slice(0, 7);
    const daysElapsed = isCurrent ? new Date().getDate() : daysInMonth;
    const total = sum(inMonth);

    $('monthName').textContent = App.monthLabel(viewMonth);
    $('next').disabled = isCurrent;
    $('kTotal').textContent = money(total);
    $('kCount').textContent = inMonth.length;
    $('kAvg').textContent = money(total / Math.max(1, daysElapsed));
    $('kMax').textContent = inMonth.length ? money(Math.max(...inMonth.map((e) => e.amount))) : money(0);

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
      chart.append(h('div', { class: 'col' }, h('button', {
        class: 'bar' + (v ? '' : ' zero'),
        style: `height:${v ? Math.max(4, (v / peak) * 100) : 2}%`,
        'aria-label': `${i + 1}: ${money(v)}`,
        onclick: () => pick(i),
      })));
      const day = i + 1;
      labels.append(h('span', null, day === 1 || day % 5 === 0 || day === daysInMonth ? String(day) : ''));
    });
    selectedDay = null;
    readout.textContent = inMonth.length ? 'Tap a bar to see that day.' : 'Nothing spent this month yet.';

    // entries grouped by day
    const who2 = who === 'all' ? 'Everyone' : (members.find((m) => m.id === who) || { name: 'Admin' }).name;
    $('listTitle').textContent = `${who2} — ${App.monthLabel(viewMonth)}`;
    const box = $('entries');
    box.replaceChildren();
    if (!inMonth.length) { box.append(h('div', { class: 'empty-state' }, 'No expenses this month.')); return; }
    const byDate = new Map();
    for (const e of inMonth) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    for (const [date, list] of byDate) {
      box.append(h('div', { class: 'daygroup' },
        h('div', { class: 'dayhead' }, h('span', null, App.prettyDate(date)), h('span', null, money(sum(list)))),
        list.map((e) => App.entryRow(e, { showDate: false, showMember: who === 'all', onDelete: remove })),
      ));
    }
  }

  function renderMonths() {
    const totals = new Map();
    for (const e of mine()) {
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
        onclick: () => { viewMonth = m; renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
      },
        h('span', { class: 'name' }, App.monthLabel(m)),
        h('span', { class: 'track' }, h('span', { class: 'fill', style: `display:block;width:${(totals.get(m) / peak) * 100}%` })),
        h('span', { class: 'total' }, money(totals.get(m))),
      ));
    }
  }

  // ---------- family members ----------

  function renderMembers() {
    const box = $('memberList');
    box.replaceChildren();
    if (!members.length) { box.append(h('div', { class: 'empty-state' }, 'No one yet. Add your first family member below.')); return; }
    const month = todayStr().slice(0, 7);
    members.forEach((m) => {
      const s = App.budgetStats(expenses.filter((e) => e.memberId === m.id), m.budget, month);
      box.append(h('div', { class: 'member' + (m.active ? '' : ' off') },
        h('div', { class: 'avatar' }, m.name.trim().charAt(0).toUpperCase()),
        h('div', { class: 'minfo' },
          h('strong', null, m.name, m.active ? '' : ' (switched off)'),
          h('div', { class: 'muted small' },
            (m.budget > 0 ? `Budget ${money(m.budget)}/month` : 'No budget') + ` · spent ${money(s.spent)} this month`)),
        h('button', { class: 'btn small ghost', onclick: () => openEdit(m) }, 'Edit'),
      ));
    });
  }

  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    btn.textContent = busy ? 'Please wait…' : label;
  }

  $('addForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('addError');
    err.hidden = true;
    const btn = $('addBtn');
    setBusy(btn, true);
    try {
      const { member } = await api('/api/admin/members', {
        method: 'POST',
        body: JSON.stringify({ name: $('mName').value, pin: $('mPin').value, budget: $('mBudget').value }),
      });
      $('mName').value = $('mPin').value = $('mBudget').value = '';
      toast(`✓ ${member.name} added. They sign in with their name and PIN.`);
      await load();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      setBusy(btn, false, 'Add family member');
    }
  });

  function openEdit(m) {
    editing = m;
    $('editTitle').textContent = `Edit ${m.name}`;
    $('eName').value = m.name;
    $('eBudget').value = m.budget || '';
    $('ePin').value = '';
    $('eActive').checked = m.active;
    $('editError').hidden = true;
    $('editDlg').showModal();
  }
  $('eCancel').addEventListener('click', () => $('editDlg').close());

  $('eDelete').addEventListener('click', async () => {
    if (!confirm(`Delete ${editing.name} for good?

This only works for someone who has no expenses yet. Otherwise switch them off instead.`)) return;
    const err = $('editError');
    err.hidden = true;
    try {
      await api('/api/admin/members/' + editing.id, { method: 'DELETE' });
      $('editDlg').close();
      toast('Deleted');
      await load();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });

  $('editForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('editError');
    err.hidden = true;
    const btn = $('eSave');
    setBusy(btn, true);
    try {
      const body = { name: $('eName').value, budget: $('eBudget').value === '' ? 0 : $('eBudget').value, active: $('eActive').checked };
      if ($('ePin').value.trim()) body.pin = $('ePin').value.trim();
      await api('/api/admin/members/' + editing.id, { method: 'PATCH', body: JSON.stringify(body) });
      $('editDlg').close();
      toast('✓ Saved');
      await load();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      setBusy(btn, false, 'Save');
    }
  });

  // ---------- removing an expense ----------

  async function remove(e) {
    const what = [e.memberName, e.note, money(e.amount)].filter(Boolean).join(' — ');
    if (!confirm(`Remove this expense?\n\n${what}`)) return;
    try {
      await api('/api/expenses/' + e.id, { method: 'DELETE' });
      await load();
      toast('Removed');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- load + navigation ----------

  function renderAll() {
    const n = active().length;
    $('drawerInfo').textContent = n ? `${n} family member${n === 1 ? '' : 's'}` : 'No family members yet';
    renderChips();
    renderStats();
    renderBudgets();
    renderMonth();
    renderMonths();
    renderMembers();
  }

  async function load() {
    const [m, e] = await Promise.all([api('/api/admin/members'), api('/api/expenses')]);
    members = m.members;
    expenses = e.expenses;
    if (who !== 'all' && who !== 'admin' && !members.some((x) => x.id === who)) who = 'all';
    renderAll();
  }

  $('prev').addEventListener('click', () => { viewMonth = App.addMonths(viewMonth, -1); renderAll(); });
  $('next').addEventListener('click', () => {
    if (viewMonth < todayStr().slice(0, 7)) { viewMonth = App.addMonths(viewMonth, 1); renderAll(); }
  });

  async function boot() {
    try {
      const me = await api('/api/me');
      if (me.role !== 'admin') { location.replace('/'); return; }
    } catch {
      location.replace('/?admin=1');
      return;
    }
    $('siteLink').value = location.origin + '/';
    try {
      await load();
      $('dash').hidden = false;
      route();
    } catch (err) {
      toast(err.message, true);
    }
  }

  boot();
})();

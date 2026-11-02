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
    await Notify.goodbye();
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

  const PAGES = { overview: 'pageOverview', expenses: 'pageExpenses', approvals: 'pageApprovals', addexpense: 'pageAddexpense', messages: 'pageMessages', ration: 'pageRation', members: 'pageMembers', share: 'pageShare' };
  const TITLES = { overview: 'Overview', expenses: 'All expenses', approvals: 'Approvals', addexpense: 'Add expense', messages: 'Messages', ration: 'Ration list', members: 'Family members', share: 'Share & export' };
  let ration = null;
  let messages = null;

  // numbers from the notification check: menu badge and the card on the overview
  function onNews(data) {
    $('msgBadge').hidden = data.messages === 0;
    $('msgBadge').textContent = String(data.messages);
    const med = data.medicine ? ` \u00B7 \u{1F48A} ${data.medicine} medicine request${data.medicine === 1 ? '' : 's'}` : '';
    $('miniMessages').hidden = data.messages === 0 && data.medicine === 0;
    $('miniMessagesTitle').textContent = `${data.messages} unread message${data.messages === 1 ? '' : 's'}${med}`;
    if (!$('pageMessages').hidden && messages) messages.refresh();
    const waiting = data.approvals || 0;
    $('apBadge').hidden = waiting === 0;
    $('apBadge').textContent = String(waiting);
    $('miniApprovals').hidden = waiting === 0;
    $('miniApprovalsTitle').textContent = `${waiting} expense${waiting === 1 ? '' : 's'} waiting for approval`;
    if (waiting !== lastWaiting) { lastWaiting = waiting; if (!$('pageApprovals').hidden) load(); }
  }
  let lastWaiting = null;

  function setRationCount(n) {
    $('rationBadge').hidden = n === 0;
    $('rationBadge').textContent = String(n);
    $('miniRation').hidden = n === 0;
    $('miniRationTitle').textContent = `${n} item${n === 1 ? '' : 's'} on the ration list`;
  }
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
    const [hashPage, hashArg] = location.hash.slice(1).split('/');
    const page = PAGES[hashPage] ? hashPage : 'overview';
    Object.entries(PAGES).forEach(([key, id]) => { $(id).hidden = key !== page; });
    $('filters').hidden = !FILTERED.has(page);
    $('appTitle').textContent = TITLES[page];
    document.querySelectorAll('.drawer a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
    setDrawer(false);
    window.scrollTo(0, 0);
    if (page === 'ration' && ration) ration.refresh();
    if (page === 'messages' && messages) { if (hashArg) messages.open(hashArg); else messages.home(); messages.refresh(); }
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
    const inMonthAll = mine().filter((e) => e.date.startsWith(viewMonth));
    const inMonth = inMonthAll.filter((e) => e.status !== 'rejected'); // what counts
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
    if (!inMonthAll.length) { box.append(h('div', { class: 'empty-state' }, 'No expenses this month.')); return; }
    const byDate = new Map();
    for (const e of inMonthAll) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    for (const [date, list] of byDate) {
      box.append(h('div', { class: 'daygroup' },
        h('div', { class: 'dayhead' }, h('span', null, App.prettyDate(date)), h('span', null, money(sum(list)))),
        list.map((e) => App.entryRow(e, { showDate: false, showMember: who === 'all', onDelete: remove, onEdit: edit })),
      ));
    }
  }

  function renderMonths() {
    const totals = new Map();
    for (const e of mine()) {
      if (e.status === 'rejected') continue;
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

  const edit = (e) => ExpenseEditor.open(e, { isAdmin: true, onSaved: () => load() });

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

  // ---------- approvals: approve or reject what the family added ----------

  let apTab = 'waiting';

  function budgetLine(e) {
    const m = members.find((x) => x.id === e.memberId);
    if (!m || !(m.budget > 0)) return null;
    const s = App.budgetStats(expenses.filter((x) => x.memberId === m.id), m.budget, e.date.slice(0, 7));
    return h('div', { class: 'muted small' }, `${m.name}: ${money(s.spent)} of ${money(s.budget)} used in ${App.monthLabel(s.month)}${s.over ? ' (over budget)' : ''}`);
  }

  async function review(e, decision, note) {
    try {
      await api('/api/expenses/' + e.id + '/review', { method: 'POST', body: JSON.stringify({ decision, note }) });
      toast(decision === 'approved' ? '✓ Approved' : '✗ Rejected, they will be told');
      await load();
      Notify.refresh();
    } catch (err) { toast(err.message, true); }
  }

  // a reject button that asks for an optional reason right there (no pop-up)
  function rejectControl(e, label) {
    const reason = h('input', { type: 'text', maxlength: 200, placeholder: 'Reason (optional), e.g. not needed', 'aria-label': 'Reason' });
    const box = h('div', { class: 'rejectbox', hidden: true }, reason,
      h('div', { class: 'abtns' },
        h('button', { class: 'btn danger', onclick: () => review(e, 'rejected', reason.value) }, 'Confirm reject'),
        h('button', { class: 'btn ghost', onclick: () => { box.hidden = true; } }, 'Cancel')));
    const open = h('button', { class: 'btn ghost danger', onclick: () => { box.hidden = !box.hidden; if (!box.hidden) reason.focus(); } }, label);
    return { open, box };
  }

  function approvalCard(e) {
    const rej = rejectControl(e, '✗ Reject');
    return h('section', { class: 'card approval' },
      h('div', { class: 'ahead' }, h('strong', null, e.memberName), h('span', { class: 'amt' }, money(e.amount))),
      h('div', { class: 'muted small' }, App.prettyDate(e.date) + (e.edited ? ' · edited' : '')),
      e.note ? h('div', { class: 'anote' }, e.note) : null,
      e.thumb ? h('button', { class: 'bphoto', style: "background-image:url('" + e.thumb + "')", 'aria-label': 'Open photo',
        onclick: () => App.viewPhoto(e.photo || e.thumb, [e.note, money(e.amount)].filter(Boolean).join(' — ')) }) : null,
      budgetLine(e),
      h('div', { class: 'abtns' }, h('button', { class: 'btn', onclick: () => review(e, 'approved') }, '✓ Approve'), rej.open),
      rej.box);
  }

  function renderApprovals() {
    const root = $('pageApprovals');
    const waiting = expenses.filter((e) => e.status === 'pending');
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const reviewed = expenses.filter((e) => e.status !== 'pending' && e.reviewedAt && Date.parse(e.reviewedAt) > cutoff)
      .sort((a, b) => (a.reviewedAt < b.reviewedAt ? 1 : -1));

    const tab = (key, label, count) => h('button', { class: apTab === key ? 'on' : '', role: 'tab', onclick: () => { apTab = key; renderApprovals(); } }, label, count ? h('span', { class: 'badge' }, String(count)) : null);
    const view = h('div');

    if (apTab === 'waiting') {
      if (!waiting.length) {
        view.append(h('div', { class: 'card empty-state' }, 'Nothing is waiting for approval. \u{1F389}'));
      } else {
        view.append(h('div', { class: 'card ractionsbar' },
          h('button', { class: 'btn', onclick: async () => {
            if (!confirm('Approve all ' + waiting.length + ' expenses?')) return;
            try { await api('/api/expenses/approve-all', { method: 'POST' }); toast('✓ All approved'); await load(); Notify.refresh(); } catch (err) { toast(err.message, true); }
          } }, '✓ Approve all ' + waiting.length)));
        waiting.forEach((e) => view.append(approvalCard(e)));
      }
    } else if (!reviewed.length) {
      view.append(h('div', { class: 'card empty-state' }, 'Nothing reviewed in the last 30 days.'));
    } else {
      const card = h('section', { class: 'card' });
      reviewed.forEach((e) => {
        const rej = rejectControl(e, 'Change to ✗ Reject');
        card.append(h('div', { class: 'rev' },
          App.entryRow(e, { showMember: true, showApproved: true }),
          e.status === 'approved' ? h('div', null, rej.open, rej.box)
            : h('button', { class: 'btn small', onclick: () => review(e, 'approved') }, 'Change to ✓ Approve')));
      });
      view.append(card);
    }
    root.replaceChildren(h('div', { class: 'seg', role: 'tablist' }, tab('waiting', '⏳ Waiting', waiting.length), tab('done', 'Reviewed')), view);
  }

  // ---------- add an expense for someone (it is approved straight away) ----------

  const addForm = { photo: null };

  function renderAddExpense() {
    const root = $('pageAddexpense');
    if (root.dataset.ready === members.map((m) => m.id + m.active).join()) return; // keep what is being typed
    root.dataset.ready = members.map((m) => m.id + m.active).join();
    const people = active();
    const who = h('select', { 'aria-label': 'Who is this for?' }, people.map((m) => h('option', { value: m.id }, m.name)));
    const amount = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': 'Amount' });
    const note = h('textarea', { rows: 2, maxlength: 500, placeholder: 'e.g. Electricity bill', 'aria-label': 'Note' });
    const date = h('input', { type: 'date', value: todayStr(), max: todayStr(), 'aria-label': 'Date' });
    const preview = h('div', { class: 'chat-preview', hidden: true });
    const fileGal = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const err = h('p', { class: 'error', role: 'alert', hidden: true });
    const save = h('button', { type: 'submit', class: 'btn' }, 'Add expense');

    function paint() {
      preview.hidden = !addForm.photo;
      preview.replaceChildren();
      if (addForm.photo) preview.append(h('div', { class: 'pv' }, h('img', { src: addForm.photo.thumb || addForm.photo.photo, alt: 'Photo' }),
        h('button', { type: 'button', class: 'link danger small', onclick: () => { addForm.photo = null; paint(); } }, 'Remove photo')));
    }
    fileGal.addEventListener('change', async () => {
      const f = fileGal.files[0]; fileGal.value = '';
      if (!f) return;
      try { addForm.photo = await Camera.fromFile(f); paint(); } catch { toast('Sorry, that photo could not be opened.', true); }
    });

    const form = h('form', { class: 'card', novalidate: true },
      people.length ? null : h('p', { class: 'muted' }, 'Add a family member first (Family members), then you can add expenses for them.'),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Who is it for?'), who),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Photo ', h('span', { class: 'opt' }, '(bill, item, optional)')),
        h('div', { class: 'crow' },
          h('button', { type: 'button', class: 'cbtn', onclick: async () => {
            try { const d = await Camera.take(); if (d) { addForm.photo = d; paint(); } } catch { fileGal.click(); }
          } }, '\u{1F4F7} Camera'),
          h('button', { type: 'button', class: 'cbtn', onclick: () => fileGal.click() }, '\u{1F5BC} Photos')),
        preview, fileGal),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'How much?'), amount),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Note ', h('span', { class: 'opt' }, '(optional)')), note),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Date'), date),
      err, save);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const n = Number(amount.value.replace(/[,\s]/g, '').replace(/[^\d.]/g, ''));
      if (!people.length) { err.textContent = 'Add a family member first.'; err.hidden = false; return; }
      if (!(n > 0)) { err.textContent = 'Please type how much it cost.'; err.hidden = false; amount.focus(); return; }
      save.disabled = true; save.textContent = 'Saving…';
      try {
        await api('/api/expenses', { method: 'POST', body: JSON.stringify({
          memberId: who.value, amount: n, note: note.value, date: date.value || todayStr(),
          photo: addForm.photo && addForm.photo.photo, thumb: addForm.photo && addForm.photo.thumb,
        }) });
        const name = (people.find((m) => m.id === who.value) || {}).name;
        amount.value = ''; note.value = ''; date.value = todayStr(); addForm.photo = null; paint();
        toast('✓ Added ' + money(n) + ' for ' + name + '. They have been told.');
        await load();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
      finally { save.disabled = false; save.textContent = 'Add expense'; }
    });
    root.replaceChildren(form);
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
    renderApprovals();
    renderAddExpense();
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
      ration = Ration.mount($('pageRation'), { isAdmin: true, onCount: setRationCount });
      messages = Messages.mount($('pageMessages'), { isAdmin: true, onChange: () => Notify.refresh() });
      Notify.mount({ slot: $('bellSlot'), onData: onNews });
      route();
    } catch (err) {
      toast(err.message, true);
    }
  }

  boot();
})();

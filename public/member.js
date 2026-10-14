'use strict';

(async function () {
  await App.ready;
  const $ = (id) => document.getElementById(id);
  const { h, money, api, toast } = App;

  let me = null; // { id, name, budget }
  let expenses = []; // this person's own expenses
  let freshId = null;
  let saving = false;
  let photoData = null; // { photo, thumb } data URLs
  let listMonth = App.todayStr().slice(0, 7);
  let started = false;

  $('cur').textContent = money(0).replace(/[\d.,\s]+$/, '') || '₹';

  const show = (id) => ['viewLogin', 'viewApp'].forEach((v) => { $(v).hidden = v !== id; });

  // =====================================================================
  // Sign in: tap your name, enter your PIN. Logins last a year.
  // =====================================================================

  let selected = null;
  const LAST_KEY = 'expense-last-person';
  const remembered = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };

  function pickPerson(person) {
    selected = person;
    $('pickCard').hidden = true;
    $('pinCard').hidden = false;
    $('pinWho').textContent = person.id === 'admin' ? 'Admin sign in' : `Hi ${person.name}!`;
    $('pinError').hidden = true;
    $('pin').value = '';
    $('pin').focus();
  }

  async function showLogin() {
    show('viewLogin');
    $('pickCard').hidden = false;
    $('pinCard').hidden = true;
    let members = [];
    try { members = (await api('/api/members/public')).members; } catch (err) { toast(err.message, true); }
    const last = remembered();
    const box = $('people');
    box.replaceChildren();
    members.forEach((m) => {
      box.append(h('button', { type: 'button', class: 'person' + (m.id === last ? ' last' : ''), onclick: () => pickPerson(m) },
        h('span', { class: 'avatar' }, m.name.trim().charAt(0).toUpperCase()),
        h('span', { class: 'pname' }, m.name)));
    });
    $('noPeople').hidden = members.length > 0;
    if (new URLSearchParams(location.search).has('admin')) pickPerson({ id: 'admin', name: 'Admin' });
  }

  $('adminLink').addEventListener('click', () => pickPerson({ id: 'admin', name: 'Admin' }));
  $('pinBack').addEventListener('click', () => { selected = null; $('pickCard').hidden = false; $('pinCard').hidden = true; });

  $('pinCard').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('pinGo');
    const err = $('pinError');
    err.hidden = true;
    if (!$('pin').value.trim()) { err.textContent = 'Please type your PIN.'; err.hidden = false; return; }
    btn.disabled = true;
    btn.textContent = 'Opening…';
    try {
      const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ memberId: selected.id, pin: $('pin').value }) });
      try { if (selected.id !== 'admin') localStorage.setItem(LAST_KEY, selected.id); } catch { /* ignore */ }
      if (res.role === 'admin') { location.href = '/admin'; return; }
      await boot();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      $('pin').value = '';
      $('pin').focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Open';
    }
  });

  $('signOut').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  // =====================================================================
  // Menu + pages
  // =====================================================================

  const PAGES = { add: 'pageAdd', list: 'pageList', budget: 'pageBudget', ration: 'pageRation' };
  const TITLES = { add: 'Add expense', list: 'My expenses', budget: 'My budget', ration: 'Ration list' };
  let ration = null;

  function setRationCount(n) {
    $('rationBadge').hidden = n === 0;
    $('rationBadge').textContent = String(n);
    $('miniRationText').textContent = n ? `${n} item${n === 1 ? '' : 's'} to order. Tap to add more.` : 'Add what we need from the shop';
  }

  function setDrawer(open) {
    $('drawer').hidden = !open;
    $('menuBtn').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('no-scroll', open);
  }
  $('menuBtn').addEventListener('click', () => setDrawer($('drawer').hidden));
  $('drawerBackdrop').addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });

  function route() {
    const page = PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'add';
    Object.entries(PAGES).forEach(([key, id]) => { $(id).hidden = key !== page; });
    $('appTitle').textContent = TITLES[page];
    document.querySelectorAll('.drawer a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
    setDrawer(false);
    window.scrollTo(0, 0);
    if (page === 'list') renderList();
    if (page === 'budget') renderBudget();
    if (page === 'ration' && ration) ration.refresh();
  }
  window.addEventListener('hashchange', route);

  // =====================================================================
  // Budget
  // =====================================================================

  function renderMini() {
    const el = $('miniBudget');
    const s = App.budgetStats(expenses, me.budget);
    el.hidden = false;
    el.replaceChildren();
    if (!s.hasBudget) {
      el.append(
        h('div', { class: 'k' }, 'Spent this month'),
        h('div', { class: 'big-num' }, money(s.spent)),
        h('div', { class: 'muted small' }, 'No budget set yet'),
      );
      return;
    }
    el.append(
      h('div', { class: 'k' }, s.over ? 'Over budget by' : 'Left this month'),
      h('div', { class: 'big-num' + (s.over ? ' bad' : '') }, money(Math.abs(s.left))),
      bar(s.pct),
      h('div', { class: 'muted small' }, `${money(s.spent)} of ${money(s.budget)} used · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`),
    );
  }

  function bar(pct) {
    const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
    return h('div', { class: 'meter ' + cls, role: 'img', 'aria-label': `${Math.round(pct)}% of budget used` },
      h('div', { style: `width:${Math.min(100, pct)}%` }));
  }

  function renderBudget() {
    const s = App.budgetStats(expenses, me.budget);
    const hero = $('budgetHero');
    hero.replaceChildren();

    if (!s.hasBudget) {
      hero.append(
        h('div', { class: 'k' }, `Spent in ${App.monthLabel(s.month)}`),
        h('div', { class: 'big-num' }, money(s.spent)),
        h('p', { class: 'muted' }, 'No budget has been set for you yet. You can still add expenses. Ask the admin to set a monthly budget for you.'),
      );
    } else {
      const days = `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}`;
      const slowDown = s.isCurrent && s.projected > s.budget;
      let msg;
      let tone = '';
      if (s.over) { msg = `You are ${money(-s.left)} over your budget for this month.`; tone = ' bad'; }
      else if (s.pct >= 80) { msg = `Careful: ${Math.round(s.pct)}% used. Try to keep to about ${money(s.perDayLeft)} a day for the next ${days}.`; tone = ' warn'; }
      else if (slowDown) { msg = `Heads up: at this pace you will go over by ${money(s.projected - s.budget)}. Try to keep to about ${money(s.perDayLeft)} a day for the next ${days}.`; tone = ' warn'; }
      else msg = `You are on track. You can spend about ${money(s.perDayLeft)} a day for the next ${days}.`;
      hero.append(
        h('div', { class: 'k' }, `${App.monthLabel(s.month)} budget`),
        h('div', { class: 'big-num' }, money(s.budget)),
        bar(s.pct),
        h('div', { class: 'budget-split' },
          h('div', null, h('div', { class: 'k' }, 'Spent'), h('div', { class: 'v' }, money(s.spent))),
          h('div', null, h('div', { class: 'k' }, s.over ? 'Over by' : 'Left'), h('div', { class: 'v' + (s.over ? ' bad' : ' good') }, money(Math.abs(s.left)))),
          h('div', null, h('div', { class: 'k' }, 'Used'), h('div', { class: 'v' }, Math.round(s.pct) + '%')),
        ),
        h('p', { class: 'budget-msg' + tone }, msg),
      );
    }

    const grid = $('budgetGrid');
    grid.replaceChildren();
    const cell = (k, v) => h('div', { class: 'cell' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
    grid.append(
      cell('Spent today', money(s.todaySpent)),
      cell('Average per day', money(s.avgPerDay)),
      cell('Days left', String(s.daysLeft)),
      cell('Entries this month', String(s.count)),
    );
    if (s.hasBudget) {
      grid.append(
        cell('Safe to spend per day', s.over ? money(0) : money(s.perDayLeft)),
        cell('At this pace', s.projected > s.budget ? `${money(s.projected)} (over by ${money(s.projected - s.budget)})` : money(s.projected)),
      );
    }

    // last 6 months
    const hist = $('history');
    hist.replaceChildren();
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(App.addMonths(App.todayStr().slice(0, 7), -i));
    const spentBy = months.map((m) => App.sum(expenses.filter((e) => e.date.startsWith(m))));
    const peak = Math.max(me.budget, ...spentBy, 1);
    months.forEach((m, i) => {
      const over = me.budget > 0 && spentBy[i] > me.budget;
      hist.append(h('div', { class: 'hist-row' },
        h('span', { class: 'name' }, App.monthLabel(m, { short: true })),
        h('span', { class: 'track' },
          h('span', { class: 'fill' + (over ? ' over' : ''), style: `width:${(spentBy[i] / peak) * 100}%` }),
          me.budget > 0 ? h('span', { class: 'mark', style: `left:${(me.budget / peak) * 100}%`, title: 'Budget' }) : null),
        h('span', { class: 'total' }, money(spentBy[i]))));
    });
    if (me.budget > 0) hist.append(h('p', { class: 'muted small' }, 'The thin line marks your monthly budget. Red means you went over.'));
  }

  // =====================================================================
  // Lists
  // =====================================================================

  const RECENT = 5;

  function renderRecent() {
    const box = $('recent');
    box.replaceChildren();
    if (!expenses.length) box.append(h('div', { class: 'empty-state' }, 'Nothing here yet. Your first expense will show up here.'));
    expenses.slice(0, RECENT).forEach((e) => box.append(App.entryRow(e, { fresh: e.id === freshId, onDelete: remove })));
    $('seeAll').hidden = expenses.length <= RECENT;
    $('recentCard').hidden = false;
  }

  function renderList() {
    const isCurrent = listMonth === App.todayStr().slice(0, 7);
    $('listMonth').textContent = App.monthLabel(listMonth);
    $('nextMonth').disabled = isCurrent;
    const inMonth = expenses.filter((e) => e.date.startsWith(listMonth));
    $('listTotal').textContent = money(App.sum(inMonth));
    $('listCount').textContent = String(inMonth.length);
    const box = $('listEntries');
    box.replaceChildren();
    if (!inMonth.length) { box.append(h('div', { class: 'empty-state' }, 'No expenses in this month.')); return; }
    let lastDate = null;
    for (const e of inMonth) {
      if (e.date !== lastDate) {
        const dayTotal = App.sum(inMonth.filter((x) => x.date === e.date));
        box.append(h('div', { class: 'dayhead' }, h('span', null, App.prettyDate(e.date)), h('span', null, money(dayTotal))));
        lastDate = e.date;
      }
      box.append(App.entryRow(e, { showDate: false, onDelete: remove }));
    }
  }

  $('prevMonth').addEventListener('click', () => { listMonth = App.addMonths(listMonth, -1); renderList(); });
  $('nextMonth').addEventListener('click', () => {
    if (listMonth < App.todayStr().slice(0, 7)) { listMonth = App.addMonths(listMonth, 1); renderList(); }
  });

  async function remove(e) {
    const what = [e.note, money(e.amount)].filter(Boolean).join(' — ');
    if (!confirm(`Remove this expense?\n\n${what}`)) return;
    try {
      await api('/api/expenses/' + e.id, { method: 'DELETE' });
      toast('Removed');
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function load() {
    try {
      expenses = (await api('/api/expenses')).expenses;
    } catch (err) {
      if (err.status === 401) { location.reload(); return; }
      toast(err.message, true);
      return;
    }
    renderMini();
    renderRecent();
    if (!$('pageList').hidden) renderList();
    if (!$('pageBudget').hidden) renderBudget();
  }

  // =====================================================================
  // Photo (in-app camera; full-size photos crash low-memory phones, so keep things small)
  // =====================================================================

  const MAX_SIDE = 1600;

  function toJpeg(src, maxSide, quality) {
    const w = src.videoWidth || src.width || src.naturalWidth;
    const hgt = src.videoHeight || src.height || src.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w, hgt));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(hgt * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { url: c.toDataURL('image/jpeg', quality), canvas: c };
  }

  function makePhotoData(src) {
    const big = toJpeg(src, MAX_SIDE, 0.82);
    const small = toJpeg(big.canvas, 240, 0.7);
    big.canvas.width = big.canvas.height = 0; // give the memory back
    return { photo: big.url, thumb: small.url };
  }

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try {
        const opts = { imageOrientation: 'from-image' };
        if (file.size > 700 * 1024) Object.assign(opts, { resizeWidth: MAX_SIDE, resizeQuality: 'medium' });
        return await createImageBitmap(file, opts);
      } catch { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function onPhoto(file) {
    if (!file) return;
    try {
      const bmp = await loadBitmap(file);
      photoData = makePhotoData(bmp);
      if (bmp.close) bmp.close();
      showPhoto();
      saveDraft();
    } catch {
      photoData = null;
      showPhoto();
      showError('Sorry, that photo could not be opened. Please try another one.');
    }
  }

  function showPhoto() {
    const pick = $('photoPick');
    pick.querySelector('img')?.remove();
    const has = !!photoData;
    pick.classList.toggle('has-photo', has);
    pick.querySelector('.big').hidden = has;
    pick.querySelector('.t').hidden = has;
    $('photoActions').hidden = !has;
    $('galleryRow').hidden = has;
    if (has) pick.prepend(h('img', { src: photoData.photo, alt: 'Your photo' }));
    $('photoCapture').value = '';
    $('photoGallery').value = '';
  }

  let stream = null;

  function closeCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('camVideo').srcObject = null;
    $('cam').hidden = true;
  }

  async function openCamera() {
    if (photoData) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Please use "Use phone camera app" or "Choose from gallery" below the photo box.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch {
      toast('The camera is blocked. Allow it in the browser, or use "Use phone camera app" below.', true);
      return;
    }
    const v = $('camVideo');
    v.srcObject = stream;
    $('cam').hidden = false;
    try { await v.play(); } catch { /* autoplay is already on */ }
  }

  $('photoPick').addEventListener('click', openCamera);
  $('camCancel').addEventListener('click', closeCamera);
  $('camShutter').addEventListener('click', () => {
    const v = $('camVideo');
    if (!v.videoWidth) return; // camera not ready yet
    photoData = makePhotoData(v);
    closeCamera();
    showPhoto();
    saveDraft();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('cam').hidden) closeCamera(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeCamera(); });
  window.addEventListener('pagehide', closeCamera);

  $('photoCapture').addEventListener('change', (e) => onPhoto(e.target.files[0]));
  $('photoGallery').addEventListener('change', (e) => onPhoto(e.target.files[0]));
  $('removePhoto').addEventListener('click', () => { photoData = null; showPhoto(); saveDraft(); });

  // =====================================================================
  // Date, draft and the form
  // =====================================================================

  function setDate(value) {
    $('date').value = value;
    $('dateLabel').textContent = App.prettyDate(value);
  }
  setDate(App.todayStr());
  $('changeDate').addEventListener('click', () => {
    const d = $('date');
    d.hidden = !d.hidden;
    if (!d.hidden) { d.max = App.todayStr(); d.focus(); }
  });
  $('date').addEventListener('change', (e) => { setDate(e.target.value || App.todayStr()); saveDraft(); });

  // The draft (amount, note, date, photo) survives a page reload. One per person, so a shared phone is safe.
  const draftKey = () => 'expense-draft-v2-' + me.id;

  function saveDraft() {
    if (!me) return;
    const draft = { savedAt: Date.now(), amount: $('amount').value, note: $('note').value, date: $('date').value };
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ ...draft, photoData }));
    } catch {
      try { localStorage.setItem(draftKey(), JSON.stringify(draft)); } catch { /* storage unavailable */ }
    }
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch { /* ignore */ }
  }

  function restoreDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(draftKey())); } catch { /* none */ }
    if (!d || Date.now() - d.savedAt > 12 * 3600 * 1000) return;
    $('amount').value = d.amount || '';
    $('note').value = d.note || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date || '') && d.date <= App.todayStr()) setDate(d.date);
    const p = d.photoData;
    if (p && typeof p.photo === 'string' && p.photo.startsWith('data:image/jpeg;base64,')) {
      photoData = { photo: p.photo, thumb: typeof p.thumb === 'string' ? p.thumb : null };
      showPhoto();
    }
  }

  $('amount').addEventListener('input', saveDraft);
  $('note').addEventListener('input', saveDraft);

  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  function parseAmount(text) {
    const cleaned = text.replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saving) return;
    showError('');
    const amount = parseAmount($('amount').value);
    if (!(amount > 0)) {
      showError('Please type how much it cost.');
      $('amount').focus();
      return;
    }
    saving = true;
    const btn = $('save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const { expense } = await api('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          note: $('note').value,
          date: $('date').value,
          photo: photoData && photoData.photo,
          thumb: photoData && photoData.thumb,
        }),
      });
      freshId = expense.id;
      clearDraft();
      $('amount').value = '';
      $('note').value = '';
      photoData = null;
      showPhoto();
      setDate(App.todayStr());
      $('date').hidden = true;
      await load();
      const s = App.budgetStats(expenses, me.budget);
      toast(!s.hasBudget ? '✓ Saved!' : s.over ? `✓ Saved. You are ${money(-s.left)} over budget.` : `✓ Saved! ${money(s.left)} left this month.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err.status === 401) { location.reload(); return; }
      showError(err.message + ' Your entry is still here — just press Save again.');
    } finally {
      saving = false;
      btn.disabled = false;
      btn.textContent = 'Save expense';
    }
  });

  // =====================================================================
  // Start
  // =====================================================================

  async function boot() {
    try {
      const res = await api('/api/me');
      if (res.role === 'admin') { location.replace('/admin'); return; }
      me = res.member;
    } catch (err) {
      if (err.status && err.status !== 401) toast(err.message, true);
      await showLogin();
      return;
    }
    if (started) { location.reload(); return; }
    started = true;
    $('whoChip').textContent = me.name;
    $('drawerName').textContent = me.name;
    $('drawerAvatar').textContent = me.name.trim().charAt(0).toUpperCase();
    $('drawerBudget').textContent = me.budget > 0 ? `Budget ${money(me.budget)} / month` : 'No budget set';
    show('viewApp');
    ration = Ration.mount($('pageRation'), { isAdmin: false, myId: me.id, onCount: setRationCount });
    restoreDraft();
    await load();
    route();
  }

  boot();
})();

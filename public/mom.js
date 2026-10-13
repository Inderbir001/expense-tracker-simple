'use strict';

(async function () {
  await App.ready;
  const $ = (id) => document.getElementById(id);
  const { h, money, api, toast } = App;

  const PAGE = 10;
  let expenses = [];
  let shown = PAGE;
  let photoData = null; // { photo, thumb } data URLs
  let freshId = null;
  let saving = false;

  $('cur').textContent = money(0).replace(/[\d.,\s]+$/, '') || '₹';

  // ---------- photo: shrink big phone photos before upload ----------

  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function drawScaled(src, maxSide, quality) {
    const w = src.width || src.naturalWidth;
    const hgt = src.height || src.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w, hgt));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(hgt * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }

  async function onPhoto(file) {
    if (!file) return;
    try {
      const bmp = await loadBitmap(file);
      photoData = { photo: drawScaled(bmp, 1600, 0.82), thumb: drawScaled(bmp, 240, 0.7) };
      showPhoto();
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
    if (has) pick.prepend(h('img', { src: photoData.photo, alt: 'Your photo' }));
    $('photo').value = '';
  }

  $('photo').addEventListener('change', (e) => onPhoto(e.target.files[0]));
  $('removePhoto').addEventListener('click', () => { photoData = null; showPhoto(); });

  // ---------- date ----------

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
  $('date').addEventListener('change', (e) => setDate(e.target.value || App.todayStr()));

  // ---------- form ----------

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
      $('amount').value = '';
      $('note').value = '';
      photoData = null;
      showPhoto();
      setDate(App.todayStr());
      $('date').hidden = true;
      toast('✓ Saved!');
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err.status === 401) return lock();
      showError(err.message + ' Your entry is still here — just press Save again.');
    } finally {
      saving = false;
      btn.disabled = false;
      btn.textContent = 'Save expense';
    }
  });

  // ---------- list ----------

  function render() {
    const today = App.todayStr();
    const month = today.slice(0, 7);
    let t = 0;
    let m = 0;
    for (const e of expenses) {
      if (e.date === today) t += e.amount;
      if (e.date.startsWith(month)) m += e.amount;
    }
    $('todayTotal').textContent = money(t);
    $('monthTotal').textContent = money(m);
    $('summaryCard').hidden = false;

    const list = $('list');
    list.replaceChildren();
    if (!expenses.length) {
      list.append(h('div', { class: 'empty-state' }, 'Nothing here yet. Your first expense will show up here.'));
    }
    expenses.slice(0, shown).forEach((e) => {
      list.append(App.entryRow(e, { fresh: e.id === freshId, onDelete: remove }));
    });
    $('more').hidden = expenses.length <= shown;
    $('listCard').hidden = false;
  }

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

  $('more').addEventListener('click', () => { shown += PAGE; render(); });

  function lock() {
    $('app').hidden = true;
    $('locked').hidden = false;
  }

  async function load() {
    try {
      expenses = (await api('/api/expenses')).expenses;
      render();
    } catch (err) {
      if (err.status === 401) lock();
      else toast(err.message, true);
    }
  }

  load();
})();

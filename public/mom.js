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

  // ---------- photo ----------
  // Phones with little memory crash ("Aw, Snap!") if a full-size camera photo is decoded, so:
  //  - the in-app camera grabs a video frame (about 2 megapixels) instead of a 12-50 MP photo
  //  - big photos picked from the gallery are decoded already shrunk

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

  // ---- in-app camera: live preview + shutter, so she never leaves the page ----
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

  // ---------- draft: survive a page reload (typed text + photo) ----------

  const DRAFT_KEY = 'expense-draft-v1';

  function saveDraft() {
    const draft = { savedAt: Date.now(), amount: $('amount').value, note: $('note').value, date: $('date').value };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, photoData }));
    } catch {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { /* storage unavailable */ }
    }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }

  function restoreDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { /* none */ }
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
  $('date').addEventListener('change', (e) => { setDate(e.target.value || App.todayStr()); saveDraft(); });

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
      clearDraft();
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

  restoreDraft();
  load();
})();

'use strict';
// Small helpers shared by Mom's page and the dashboard.

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
    // force reflow so the transition replays
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), bad ? 5000 : 2600);
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

  // One expense row, used by both pages. opts.onDelete shows a Remove button.
  function entryRow(e, opts = {}) {
    const thumb = e.thumb
      ? h('button', {
          class: 'thumb', style: `background-image:url('${e.thumb}')`, 'aria-label': 'View photo',
          onclick: () => viewPhoto(e.photo || e.thumb, [e.note, money(e.amount)].filter(Boolean).join(' — ')),
        })
      : h('div', { class: 'thumb none', 'aria-hidden': 'true' }, '\u{1F9FE}');
    return h('div', { class: 'entry' + (opts.fresh ? ' fresh' : '') },
      thumb,
      h('div', { class: 'body' },
        h('div', { class: 'note' + (e.note ? '' : ' empty') }, e.note || 'No note'),
        h('div', { class: 'when' }, opts.showDate === false ? '' : prettyDate(e.date)),
        opts.onDelete ? h('button', { class: 'link danger small', onclick: () => opts.onDelete(e) }, 'Remove') : null,
      ),
      h('div', { class: 'amt' }, money(e.amount)),
    );
  }

  return { ready, money, api, h, toast, viewPhoto, entryRow, ymd, todayStr, parseYmd, prettyDate };
})();

'use strict';
// The notification bell (inside the app) and phone notifications (push), shared by both apps.
//   Notify.mount({ slot, onData })   puts a bell in `slot` and starts checking for news
//   Notify.refresh()                 check now
//   Notify.goodbye()                 call before signing out so the next person on this phone gets their own

const Notify = (() => {
  const { h, api, toast } = App;

  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  const b64ToBytes = (b64) => {
    const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };

  async function registration() {
    if (!pushSupported()) return null;
    try { return (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js')); } catch { return null; }
  }

  async function currentSubscription() {
    const reg = await registration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function enablePush() {
    if (!pushSupported()) throw new Error('This phone or browser cannot show notifications here.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications were not allowed.');
    const reg = await registration();
    if (!reg) throw new Error('Could not start notifications.');
    await navigator.serviceWorker.ready;
    const { publicKey, supported } = await api('/api/push/key');
    if (!supported) throw new Error('Notifications are not available on the server.');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  }

  // If notifications are already allowed on this phone, make sure the current person owns the subscription.
  async function resync() {
    try {
      if (!pushSupported() || Notification.permission !== 'granted') return;
      const sub = await currentSubscription();
      if (sub) await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
    } catch { /* not critical */ }
  }

  async function goodbye() {
    try {
      const sub = await currentSubscription();
      if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } catch { /* ignore */ }
  }

  function ago(iso) {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  const ICON = { message: '\u{1F4AC}', ration: '\u{1F6D2}', budget: '\u{1F4B0}', test: '\u{1F514}' };

  function mount({ slot, onData = () => {} }) {
    let data = { items: [], unread: 0, messages: 0, medicine: 0 };
    let lastUnread = null;
    let sheet = null;

    const badge = h('span', { class: 'bell-badge', hidden: true });
    const bell = h('button', { type: 'button', class: 'bell-btn', 'aria-label': 'Notifications', onclick: () => openSheet() }, '\u{1F514}', badge);
    slot.replaceChildren(bell);

    function paintBadge() {
      badge.hidden = data.unread === 0;
      badge.textContent = data.unread > 9 ? '9+' : String(data.unread);
    }

    async function refresh() {
      try {
        const res = await api('/api/notifications');
        const gotNew = lastUnread !== null && res.unread > lastUnread;
        data = res;
        lastUnread = res.unread;
        paintBadge();
        onData(data);
        if (gotNew && !sheet) {
          const latest = res.items.find((i) => !i.read);
          if (latest) toast(`${ICON[latest.kind] || '\u{1F514}'} ${latest.title}: ${latest.body}`.slice(0, 110));
        }
        if (sheet) renderSheet();
      } catch (err) {
        if (err.status === 401) location.reload();
      }
    }

    async function markAllRead() {
      try { await api('/api/notifications/read', { method: 'POST' }); } catch { /* ignore */ }
      await refresh();
    }

    // ---- the panel ----
    async function pushCard() {
      if (!pushSupported()) {
        return h('div', { class: 'pushcard' },
          h('strong', null, 'Phone notifications'),
          h('p', { class: 'muted small' }, 'This browser cannot show them. On an iPhone: open the site in Safari, tap Share, choose "Add to Home Screen", then open the app from the new icon and come back here.'));
      }
      if (Notification.permission === 'denied') {
        return h('div', { class: 'pushcard' },
          h('strong', null, 'Phone notifications are blocked'),
          h('p', { class: 'muted small' }, 'Open your browser settings for this website and allow notifications, then come back here.'));
      }
      const sub = Notification.permission === 'granted' ? await currentSubscription() : null;
      if (sub) {
        return h('div', { class: 'pushcard on' },
          h('strong', null, '✓ Phone notifications are on'),
          h('button', { class: 'link', onclick: async () => {
            try { await api('/api/push/test', { method: 'POST' }); toast('Test sent. It should arrive in a moment.'); await refresh(); } catch (e) { toast(e.message, true); }
          } }, 'Send a test'));
      }
      return h('div', { class: 'pushcard' },
        h('strong', null, 'Get notified on this phone'),
        h('p', { class: 'muted small' }, 'Be told when a message or an update arrives, even when the app is closed.'),
        h('button', { class: 'btn', onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try { await enablePush(); toast('✓ Notifications are on'); await api('/api/push/test', { method: 'POST' }).catch(() => {}); } catch (err) { toast(err.message, true); }
          await refresh();
        } }, '\u{1F514} Turn on notifications'));
    }

    async function renderSheet() {
      if (!sheet) return;
      const card = await pushCard();
      const list = h('div', { class: 'notelist' });
      if (!data.items.length) list.append(h('div', { class: 'empty-state' }, 'No notifications yet.'));
      data.items.forEach((n) => list.append(h('button', {
        class: 'note' + (n.read ? '' : ' unread'),
        onclick: async () => {
          closeSheet();
          if (!n.read) { await api('/api/notifications/read', { method: 'POST' }).catch(() => {}); refresh(); }
          if (n.url) location.href = n.url;
        },
      },
        h('span', { class: 'nico' }, ICON[n.kind] || '\u{1F514}'),
        h('span', { class: 'ntext' }, h('strong', null, n.title), h('span', { class: 'small' }, n.body), h('span', { class: 'muted small' }, ago(n.createdAt))))));
      sheet.querySelector('.sheet-body').replaceChildren(card, h('div', { class: 'sheet-actions' },
        h('h2', null, 'Recent'),
        data.unread ? h('button', { class: 'link', onclick: markAllRead }, 'Mark all read') : null), list);
    }

    function closeSheet() {
      if (!sheet) return;
      sheet.remove();
      sheet = null;
      document.body.classList.remove('no-scroll');
    }

    function openSheet() {
      if (sheet) return;
      sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Notifications' },
        h('div', { class: 'sheet-backdrop', onclick: closeSheet }),
        h('div', { class: 'sheet-panel' },
          h('div', { class: 'sheet-head' }, h('h2', null, 'Notifications'), h('button', { class: 'link', onclick: closeSheet }, 'Close')),
          h('div', { class: 'sheet-body' })));
      document.body.append(sheet);
      document.body.classList.add('no-scroll');
      renderSheet();
    }

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { if (!document.hidden) refresh(); }, 45000);

    registration();
    resync();
    refresh();
    return { refresh, open: openSheet };
  }

  let instance = null;
  return {
    mount: (opts) => { instance = mount(opts); return instance; },
    refresh: () => (instance ? instance.refresh() : Promise.resolve()),
    goodbye,
  };
})();

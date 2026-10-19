'use strict';
// Messages with photos (medicine strips, prescriptions, anything), shared by the family app and the admin dashboard.
//   Messages.mount(container, { isAdmin, onChange })  -> { refresh, open(threadId) }
// Each family member has one private thread with the admin. Members see just their own; the admin sees an inbox.

const Messages = (() => {
  const { h, api, toast } = App;

  const timeText = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const dayKey = (iso) => App.ymd(new Date(iso));
  const dayText = (iso) => App.prettyDate(dayKey(iso));

  function mount(root, { isAdmin = false, onChange = () => {} } = {}) {
    let threads = []; // admin: everyone you can talk to
    let thread = isAdmin ? null : 'me'; // the open conversation
    let threadName = '';
    let messages = [];
    let attach = null; // { photo, thumb }
    let medicine = false;
    let sending = false;
    let firstLoad = true;

    const inbox = h('div', { hidden: !isAdmin });
    const chat = h('div', { hidden: isAdmin });
    root.replaceChildren(inbox, chat);

    // ---------- the chat screen ----------
    const head = h('div', { class: 'chat-head' });
    const list = h('div', { class: 'chat-list', 'aria-live': 'polite' });

    const fileCam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const fileGal = h('input', { type: 'file', accept: 'image/*', hidden: true });
    fileCam.addEventListener('change', () => useFile(fileCam));
    fileGal.addEventListener('change', () => useFile(fileGal));

    const quick = isAdmin ? null : h('div', { class: 'quick' },
      h('button', { type: 'button', class: 'btn', onclick: () => takePhoto(true) }, '\u{1F48A} Send medicine photo'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => takePhoto(false) }, '\u{1F4F7} Send a photo'));

    const preview = h('div', { class: 'chat-preview', hidden: true });
    const text = h('textarea', { rows: 2, maxlength: 1000, placeholder: isAdmin ? 'Write a reply…' : 'Write a message…', 'aria-label': 'Message' });
    const medBtn = h('button', { type: 'button', class: 'cbtn', 'aria-pressed': 'false', onclick: () => { medicine = !medicine; paintComposer(); } }, '\u{1F48A} Medicine');
    const sendBtn = h('button', { type: 'button', class: 'btn small', onclick: send }, 'Send');
    const composer = h('div', { class: 'composer' },
      preview,
      text,
      h('div', { class: 'crow' },
        isAdmin ? null : h('button', { type: 'button', class: 'cbtn', onclick: () => takePhoto(false) }, '\u{1F4F7} Camera'),
        h('button', { type: 'button', class: 'cbtn', onclick: () => fileGal.click() }, '\u{1F5BC} Photos'),
        isAdmin ? null : medBtn,
        sendBtn),
      fileCam, fileGal);

    chat.append(head, ...(quick ? [quick] : []), list, composer);

    function paintComposer() {
      preview.hidden = !attach && !medicine;
      preview.replaceChildren();
      if (attach) {
        preview.append(h('div', { class: 'pv' },
          h('img', { src: attach.thumb || attach.photo, alt: 'Photo to send' }),
          h('button', { type: 'button', class: 'link danger small', onclick: () => { attach = null; paintComposer(); } }, 'Remove photo')));
      }
      if (medicine) preview.append(h('div', { class: 'medchip' }, '\u{1F48A} Sending as a medicine request'));
      medBtn.classList.toggle('on', medicine);
      medBtn.setAttribute('aria-pressed', String(medicine));
    }

    async function useFile(input) {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      try { attach = await Camera.fromFile(file); paintComposer(); }
      catch { toast('Sorry, that photo could not be opened. Please try another one.', true); }
    }

    async function takePhoto(asMedicine) {
      if (asMedicine) medicine = true;
      try {
        const data = await Camera.take();
        if (data) attach = data; else if (asMedicine && !attach && !text.value.trim()) medicine = false;
      } catch (err) {
        toast(err.code === 'blocked' ? 'The camera is blocked, so your photos will open instead.' : 'Choose a photo from your phone.');
        fileGal.click();
      }
      paintComposer();
      if (attach) text.focus();
    }

    async function send() {
      if (sending) return;
      const body = {
        text: text.value.trim(),
        photo: attach && attach.photo, thumb: attach && attach.thumb,
        tag: medicine ? 'medicine' : undefined,
        thread: isAdmin ? thread : undefined,
      };
      if (!body.text && !body.photo) { toast('Write something or add a photo first.', true); return; }
      sending = true;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      try {
        await api('/api/messages', { method: 'POST', body: JSON.stringify(body) });
        text.value = '';
        attach = null;
        medicine = false;
        paintComposer();
        await load(true);
        onChange();
      } catch (err) {
        toast(err.message + ' Your message is still here.', true);
      } finally {
        sending = false;
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    }

    async function remove(m) {
      if (!confirm('Delete this message?')) return;
      try { await api('/api/messages/' + m.id, { method: 'DELETE' }); await load(); } catch (err) { toast(err.message, true); }
    }

    async function toggleDone(m) {
      try { await api('/api/messages/' + m.id, { method: 'PATCH', body: JSON.stringify({ done: !m.done }) }); toast(m.done ? 'Marked as not done' : '✓ Marked done, they will be told'); await load(); onChange(); }
      catch (err) { toast(err.message, true); }
    }

    function bubble(m) {
      const mine = isAdmin ? m.from === 'admin' : m.from === 'member';
      const caption = [m.text, m.tag === 'medicine' ? '\u{1F48A} Medicine request' : ''].filter(Boolean).join(' — ');
      return h('div', { class: 'bubble ' + (mine ? 'mine' : 'theirs') + (m.tag === 'medicine' ? ' med' : '') },
        m.tag === 'medicine' ? h('div', { class: 'medtag' }, m.done ? '\u{1F48A} Medicine request · ✓ Done' : '\u{1F48A} Medicine request') : null,
        m.thumb ? h('button', { class: 'bphoto', style: `background-image:url('${m.thumb}')`, 'aria-label': 'Open photo', onclick: () => App.viewPhoto(m.photo || m.thumb, caption) }) : null,
        m.text ? h('div', { class: 'btext' }, m.text) : null,
        h('div', { class: 'bmeta small' },
          timeText(m.createdAt), mine && m.readAt ? ' · Seen' : '',
          mine ? h('button', { class: 'link small', onclick: () => remove(m) }, 'Delete') : null),
        isAdmin && m.tag === 'medicine' ? h('button', { class: 'btn small' + (m.done ? ' ghost' : ''), onclick: () => toggleDone(m) }, m.done ? 'Undo done' : '✓ Done') : null);
    }

    function renderChat(stickToBottom) {
      head.replaceChildren();
      if (isAdmin) {
        head.append(h('button', { class: 'link', onclick: backToInbox }, '← All people'), h('strong', null, threadName));
      }
      list.replaceChildren();
      if (!messages.length) {
        list.append(h('div', { class: 'empty-state' }, isAdmin ? 'No messages yet. Say hello below.' : 'No messages yet. Send a photo of a medicine, or write a note, and the admin will see it.'));
      }
      let last = null;
      for (const m of messages) {
        const key = dayKey(m.createdAt);
        if (key !== last) { list.append(h('div', { class: 'dayline' }, h('span', null, dayText(m.createdAt)))); last = key; }
        list.append(bubble(m));
      }
      if (stickToBottom) requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: firstLoad ? 'auto' : 'smooth' }));
    }

    async function load(forceBottom = false) {
      if (isAdmin && !thread) return;
      try {
        const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
        const res = await api('/api/messages' + (isAdmin ? '?thread=' + encodeURIComponent(thread) : ''));
        messages = res.messages;
        if (isAdmin) threadName = res.name || threadName;
        renderChat(forceBottom || firstLoad || nearBottom);
        firstLoad = false;
        const unread = messages.some((m) => !m.readAt && (isAdmin ? m.from === 'member' : m.from === 'admin'));
        if (unread && !root.hidden && !document.hidden) {
          await api('/api/messages/read', { method: 'POST', body: JSON.stringify({ thread: isAdmin ? thread : undefined }) }).catch(() => {});
          onChange();
        }
      } catch (err) {
        if (err.status === 401) { location.reload(); return; }
        toast(err.message, true);
      }
    }

    // ---------- the admin inbox ----------
    function renderInbox() {
      inbox.replaceChildren();
      if (!threads.length) { inbox.append(h('div', { class: 'card empty-state' }, 'Add family members first, then their messages will show up here.')); return; }
      const card = h('section', { class: 'card inboxcard' });
      threads.forEach((t) => {
        const preview = !t.last ? 'No messages yet'
          : (t.last.from === 'admin' ? 'You: ' : '') + (t.last.tag === 'medicine' ? '\u{1F48A} ' : '') + (t.last.text || (t.last.hasPhoto ? '\u{1F4F7} Photo' : ''));
        card.append(h('button', { class: 'threadrow', onclick: () => openThread(t.id, t.name) },
          h('span', { class: 'avatar' }, t.name.trim().charAt(0).toUpperCase()),
          h('span', { class: 'tinfo' },
            h('strong', null, t.name, t.active ? '' : ' (off)'),
            h('span', { class: 'muted small tprev' }, preview),
            t.medicinePending ? h('span', { class: 'medchip small' }, `\u{1F48A} ${t.medicinePending} medicine request${t.medicinePending === 1 ? '' : 's'}`) : null),
          h('span', { class: 'tmeta' },
            t.last ? h('span', { class: 'muted small' }, App.prettyDate(dayKey(t.last.createdAt), { short: true })) : null,
            t.unread ? h('span', { class: 'badge' }, String(t.unread)) : null)));
      });
      inbox.append(card);
    }

    async function loadThreads() {
      try { threads = (await api('/api/messages/threads')).threads; renderInbox(); }
      catch (err) { if (err.status === 401) location.reload(); else toast(err.message, true); }
    }

    function openThread(id, name) {
      thread = id;
      threadName = name || '';
      messages = [];
      firstLoad = true;
      inbox.hidden = true;
      chat.hidden = false;
      renderChat(false);
      load(true);
    }

    function backToInbox() {
      thread = null;
      chat.hidden = true;
      inbox.hidden = false;
      loadThreads();
      onChange();
    }

    function refresh() {
      if (!isAdmin) return load();
      return thread ? load() : loadThreads();
    }

    setInterval(() => { if (!root.hidden && !document.hidden) refresh(); }, 20000);

    paintComposer();
    if (isAdmin) loadThreads(); else if (!root.hidden) load(true);

    return {
      refresh,
      // open a person's conversation (admin), e.g. from a notification
      open: async (id) => {
        if (!isAdmin) return refresh();
        if (!threads.length) await loadThreads();
        const t = threads.find((x) => x.id === id);
        if (t) openThread(t.id, t.name);
        return null;
      },
      home: () => { if (isAdmin && thread) backToInbox(); },
    };
  }

  return { mount };
})();

'use strict';
// The app's brain: login, family members, budgets, expenses, photos. It doesn't care where data is
// stored (see store-*.js) or how it is hosted (server.js locally, api/index.js on Vercel).
//
// People: one admin (PIN from the ADMIN_PIN setting) and any number of family members (each with
// their own PIN and monthly budget, managed by the admin). Everyone uses the same website address,
// taps their name and enters their PIN. Logins last a year and renew themselves while in use.

const crypto = require('crypto');

const MAX_BODY = 12 * 1024 * 1024;
const MAX_PHOTO = 8 * 1024 * 1024;
const PHOTO_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const SESSION_SECONDS = 365 * 24 * 3600;
const LOCK_MAX = 8; // wrong PINs allowed ...
const LOCK_WINDOW = 15 * 60 * 1000; // ... within this window, then that person is locked until it passes
const MEMBERS_TTL = 10 * 1000;

const ADMIN_ID = 'admin';

function createApp({ store, config, currency = '₹', locale = 'en-IN' }) {
  // ---------- small helpers ----------

  const fail = (status, message) => Object.assign(new Error(message), { status });
  const hmac = (text) => crypto.createHmac('sha256', config.secret).update(text).digest('hex');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function safeEqual(a, b) {
    const A = Buffer.from(String(a));
    const B = Buffer.from(String(b));
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  }

  function send(res, status, body, headers = {}) {
    const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, {
      'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(isObj ? JSON.stringify(body) : body);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let tooBig = false;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { tooBig = true; return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (tooBig) reject(fail(413, 'That photo is too big.'));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', reject);
    });
  }

  async function readJsonBody(req) {
    // Vercel may already have parsed the body for us.
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
        try { return JSON.parse(String(req.body) || '{}'); } catch { throw fail(400, 'Bad request.'); }
      }
      if (typeof req.body === 'object') return req.body;
    }
    const raw = await readBody(req);
    try { return JSON.parse(raw || '{}'); } catch { throw fail(400, 'Bad request.'); }
  }

  function decodeImage(dataUrl, { jpegOnly = false } = {}) {
    if (typeof dataUrl !== 'string') return null;
    const m = /^data:image\/(jpeg|png|webp);base64,/.exec(dataUrl.slice(0, 40));
    if (!m) return null;
    const buf = Buffer.from(dataUrl.slice(m[0].length), 'base64');
    if (buf.length < 16 || buf.length > MAX_PHOTO) return null;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
    const isWebp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    const ext = isJpeg ? 'jpg' : isPng ? 'png' : isWebp ? 'webp' : null;
    if (!ext || (jpegOnly && ext !== 'jpg')) return null;
    return { buf, ext };
  }

  const isRealDate = (s) =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

  // "Today" in India. Only used when the phone sent no valid date.
  const fallbackToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ---------- PINs ----------

  function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
    return { salt, hash: crypto.scryptSync(pin, salt, 32).toString('hex') };
  }

  function pinMatches(member, pin) {
    if (!member.pin) return false;
    return safeEqual(crypto.scryptSync(pin, member.pin.salt, 32).toString('hex'), member.pin.hash);
  }

  // ---------- family members (cached briefly so every request doesn't hit storage) ----------

  let cache = null;

  async function getMembers() {
    if (cache && Date.now() - cache.at < MEMBERS_TTL) return cache.list;
    const doc = await store.getDoc('members', { members: [] });
    cache = { at: Date.now(), list: doc.members || [] };
    return cache.list;
  }

  // fn(list) must return the new list (and may throw fail(...) to refuse).
  async function changeMembers(fn) {
    const doc = await store.updateDoc('members', { members: [] }, (d) => ({ members: fn(d.members || []) }));
    cache = { at: Date.now(), list: doc.members };
    return doc.members;
  }

  const memberView = (m) => ({ id: m.id, name: m.name, budget: m.budget || 0, active: m.active !== false, createdAt: m.createdAt });

  function cleanName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 30) throw fail(400, 'Please type a name (up to 30 letters).');
    return name;
  }

  function cleanPin(value) {
    const pin = String(value || '').trim();
    if (!/^\d{4,8}$/.test(pin)) throw fail(400, 'The PIN must be 4 to 8 digits.');
    return pin;
  }

  function cleanBudget(value) {
    if (value === '' || value === null || value === undefined) return 0;
    const n = Math.round(Number(value) * 100) / 100;
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw fail(400, 'Please enter a valid budget (or 0 for none).');
    return n;
  }

  // ---------- sessions (a signed cookie that stays valid for a year and renews while used) ----------

  const adminVersion = () => crypto.createHash('sha256').update('admin|' + config.adminPin).digest('hex').slice(0, 10);

  function makeSession(role, memberId, version) {
    const exp = Date.now() + SESSION_SECONDS * 1000;
    const payload = `${role}.${memberId}.${exp}.${version}`;
    return `${payload}.${hmac(payload)}`;
  }

  function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 1) continue;
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
    }
    return out;
  }

  function cookieHeader(req, value, maxAgeSec) {
    const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket && req.socket.encrypted);
    return `session=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  // Returns { role: 'admin' } or { role: 'member', member } or null.
  async function whoIs(req) {
    const token = cookies(req).session;
    if (!token) return null;
    const cut = token.lastIndexOf('.');
    if (cut < 0) return null;
    const payload = token.slice(0, cut);
    if (!safeEqual(token.slice(cut + 1), hmac(payload))) return null;
    const [role, memberId, exp, version] = payload.split('.');
    if (!(Number(exp) > Date.now())) return null;
    if (role === 'admin') return version === adminVersion() ? { role: 'admin' } : null;
    if (role !== 'member') return null;
    const member = (await getMembers()).find((m) => m.id === memberId && m.active !== false);
    return member && member.sessionVersion === version ? { role: 'member', member } : null;
  }

  // ---------- sign-in lockout (stored, so it holds across servers) ----------

  const recent = (list) => (Array.isArray(list) ? list : []).filter((t) => t > Date.now() - LOCK_WINDOW);

  async function lockedFor(key) {
    const state = await store.getDoc('state', {});
    const fails = recent(state.fails && state.fails[key]);
    return fails.length >= LOCK_MAX ? Math.max(1, Math.ceil((fails[0] + LOCK_WINDOW - Date.now()) / 60000)) : 0;
  }

  const recordFail = (key) =>
    store.updateDoc('state', {}, (s) => {
      s.fails = s.fails || {};
      s.fails[key] = [...recent(s.fails[key]), Date.now()];
      return s;
    });

  const clearFails = (key) =>
    store.updateDoc('state', {}, (s) => {
      if (s.fails) delete s.fails[key];
      return s;
    });

  // ---------- expenses ----------

  async function nameOf(memberId) {
    if (memberId === ADMIN_ID) return 'Admin';
    const m = (await getMembers()).find((x) => x.id === memberId);
    return m ? m.name : 'Unknown';
  }

  async function listExpenses(who) {
    const members = await getMembers();
    const names = new Map(members.map((m) => [m.id, m.name]));
    names.set(ADMIN_ID, 'Admin');
    return (await store.getDoc('expenses', []))
      .filter((e) => !e.deleted && (who.role === 'admin' || e.memberId === who.member.id))
      .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
      .map((e) => ({
        id: e.id,
        amount: e.amount,
        note: e.note,
        date: e.date,
        memberId: e.memberId || null,
        memberName: names.get(e.memberId) || '—',
        photo: e.photo ? '/photos/' + e.photo : null,
        thumb: e.thumb ? '/photos/' + e.thumb : e.photo ? '/photos/' + e.photo : null,
        createdAt: e.createdAt,
      }));
  }

  // ---------- routes ----------

  async function handleApi(req, res, pathname) {
    const method = req.method;

    // ---- public ----
    if (pathname === '/api/config' && method === 'GET') {
      return send(res, 200, { currency, locale });
    }

    if (pathname === '/api/members/public' && method === 'GET') {
      const list = (await getMembers())
        .filter((m) => m.active !== false)
        .map((m) => ({ id: m.id, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return send(res, 200, { members: list });
    }

    if (pathname === '/api/login' && method === 'POST') {
      const body = await readJsonBody(req);
      const id = String(body.memberId || '');
      const pin = String(body.pin || '').trim();
      const wait = await lockedFor(id);
      if (wait) return send(res, 429, { error: `Too many wrong tries. Please wait about ${wait} minute${wait === 1 ? '' : 's'}.` });

      let session = null;
      let name = null;
      if (id === ADMIN_ID) {
        if (safeEqual(pin, config.adminPin)) { session = makeSession('admin', ADMIN_ID, adminVersion()); name = 'Admin'; }
      } else {
        const m = (await getMembers()).find((x) => x.id === id && x.active !== false);
        if (m && pinMatches(m, pin)) { session = makeSession('member', m.id, m.sessionVersion); name = m.name; }
      }
      if (!session) {
        await recordFail(id.slice(0, 40));
        await sleep(600); // slows down guessing
        return send(res, 401, { error: 'Wrong PIN. Please try again.' });
      }
      await clearFails(id);
      return send(res, 200, { ok: true, role: id === ADMIN_ID ? 'admin' : 'member', name },
        { 'Set-Cookie': cookieHeader(req, session, SESSION_SECONDS) });
    }

    if (pathname === '/api/logout' && method === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }

    // ---- everything below needs a login ----
    const who = await whoIs(req);
    if (!who) return send(res, 401, { error: 'Please sign in.' });
    const isAdmin = who.role === 'admin';

    if (pathname === '/api/me' && method === 'GET') {
      const mine = isAdmin ? ADMIN_ID : who.member.id;
      const renewed = makeSession(who.role, mine, isAdmin ? adminVersion() : who.member.sessionVersion);
      return send(res, 200,
        isAdmin
          ? { role: 'admin', name: 'Admin' }
          : { role: 'member', member: { id: who.member.id, name: who.member.name, budget: who.member.budget || 0 } },
        { 'Set-Cookie': cookieHeader(req, renewed, SESSION_SECONDS) });
    }

    if (pathname === '/api/expenses' && method === 'GET') {
      return send(res, 200, { expenses: await listExpenses(who) });
    }

    if (pathname === '/api/expenses' && method === 'POST') {
      const body = await readJsonBody(req);
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
        return send(res, 400, { error: 'Please enter how much it cost.' });
      }
      let memberId = isAdmin ? ADMIN_ID : who.member.id;
      if (isAdmin && body.memberId && body.memberId !== ADMIN_ID) {
        if (!(await getMembers()).some((m) => m.id === body.memberId)) return send(res, 400, { error: 'Unknown family member.' });
        memberId = body.memberId;
      }
      const id = crypto.randomBytes(8).toString('hex');
      let photo = null;
      let thumb = null;
      if (body.photo) {
        const img = decodeImage(body.photo);
        if (!img) return send(res, 400, { error: 'That photo could not be used. Please try another.' });
        const t = body.thumb ? decodeImage(body.thumb, { jpegOnly: true }) : null;
        photo = `${id}.${img.ext}`;
        await store.putPhoto(photo, img.buf);
        if (t) {
          thumb = `${id}_t.jpg`;
          await store.putPhoto(thumb, t.buf);
        }
      }
      const expense = {
        id,
        memberId,
        amount,
        note: String(body.note || '').trim().slice(0, 500),
        date: isRealDate(body.date) ? body.date : fallbackToday(),
        photo,
        thumb,
        createdAt: new Date().toISOString(),
        deleted: false,
      };
      await store.updateDoc('expenses', [], (list) => { list.push(expense); return list; });
      return send(res, 201, {
        expense: {
          id, amount, note: expense.note, date: expense.date, memberId, memberName: await nameOf(memberId),
          photo: photo && '/photos/' + photo, thumb: thumb ? '/photos/' + thumb : photo && '/photos/' + photo,
          createdAt: expense.createdAt,
        },
      });
    }

    const del = /^\/api\/expenses\/([a-f0-9]{16})$/.exec(pathname);
    if (del && method === 'DELETE') {
      // Soft delete: it disappears from totals and lists, but the record and photo stay in storage.
      let found = false;
      await store.updateDoc('expenses', [], (list) => {
        found = false;
        const e = list.find((x) => x.id === del[1] && !x.deleted);
        if (e && (isAdmin || e.memberId === who.member.id)) {
          found = true;
          e.deleted = true;
          e.deletedAt = new Date().toISOString();
        }
        return list;
      });
      return found ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Not found.' });
    }

    // ---- admin only ----
    if (!pathname.startsWith('/api/admin/')) return send(res, 404, { error: 'Not found.' });
    if (!isAdmin) return send(res, 403, { error: 'Only the admin can do that.' });

    if (pathname === '/api/admin/members' && method === 'GET') {
      return send(res, 200, { members: (await getMembers()).map(memberView) });
    }

    if (pathname === '/api/admin/members' && method === 'POST') {
      const body = await readJsonBody(req);
      const name = cleanName(body.name);
      const pin = cleanPin(body.pin);
      const budget = cleanBudget(body.budget);
      const member = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        pin: hashPin(pin),
        sessionVersion: crypto.randomBytes(6).toString('hex'),
        budget,
        active: true,
        createdAt: new Date().toISOString(),
      };
      await changeMembers((list) => {
        if (list.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw fail(409, 'Someone with that name already exists.');
        return [...list, member];
      });
      return send(res, 201, { member: memberView(member) });
    }

    const edit = /^\/api\/admin\/members\/([a-f0-9]{16})$/.exec(pathname);
    if (edit && method === 'PATCH') {
      const body = await readJsonBody(req);
      const changes = {};
      if (body.name !== undefined) changes.name = cleanName(body.name);
      if (body.budget !== undefined) changes.budget = cleanBudget(body.budget);
      if (body.active !== undefined) changes.active = !!body.active;
      if (body.pin !== undefined && body.pin !== '') changes.pin = hashPin(cleanPin(body.pin));
      let updated = null;
      await changeMembers((list) => {
        const i = list.findIndex((m) => m.id === edit[1]);
        if (i < 0) throw fail(404, 'Family member not found.');
        if (changes.name && list.some((m, j) => j !== i && m.name.toLowerCase() === changes.name.toLowerCase())) {
          throw fail(409, 'Someone with that name already exists.');
        }
        const next = { ...list[i], ...changes };
        // A new PIN, or switching someone off, signs them out everywhere.
        if (changes.pin || changes.active === false) next.sessionVersion = crypto.randomBytes(6).toString('hex');
        updated = next;
        return list.map((m, j) => (j === i ? next : m));
      });
      // sign-in lockout no longer applies once the admin has set a new PIN
      if (changes.pin) await clearFails(edit[1]);
      return send(res, 200, { member: memberView(updated) });
    }

    if (edit && method === 'DELETE') {
      // Only people with no (remaining) expenses can be deleted; everyone else is switched off so history is kept.
      const used = (await store.getDoc('expenses', [])).some((e) => e.memberId === edit[1] && !e.deleted);
      if (used) throw fail(409, 'This person has expenses, so they can only be switched off, not deleted.');
      await changeMembers((list) => {
        if (!list.some((m) => m.id === edit[1])) throw fail(404, 'Family member not found.');
        return list.filter((m) => m.id !== edit[1]);
      });
      return send(res, 200, { ok: true });
    }

    if (pathname === '/api/admin/export' && method === 'GET') {
      const rows = [['Date', 'Member', 'Amount', 'Note', 'Has photo', 'Added at']];
      (await listExpenses(who))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1))
        .forEach((e) => rows.push([e.date, e.memberName, e.amount, e.note, e.photo ? 'yes' : 'no', e.createdAt]));
      const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
      return send(res, 200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="expenses-${fallbackToday()}.csv"`,
      });
    }

    return send(res, 404, { error: 'Not found.' });
  }

  // Returns true if the request was handled here, false if the caller should serve it (static files / 404).
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      // Old "?key=" links from before everyone shared one address: just go to the sign-in page.
      if (pathname === '/api/enter') {
        send(res, 302, '', { Location: '/' });
        return true;
      }

      const photo = /^\/(?:photos|api\/photo)\/([a-f0-9]{16}(?:_t)?\.(jpg|png|webp))$/.exec(pathname);
      if (photo) {
        if (!(await whoIs(req))) { send(res, 401, 'Please sign in.'); return true; }
        const buf = await store.getPhoto(photo[1]);
        if (!buf) { send(res, 404, 'Not found'); return true; }
        send(res, 200, buf, {
          'Content-Type': PHOTO_MIME[photo[2]],
          'Cache-Control': 'private, max-age=31536000, immutable',
        });
        return true;
      }

      if (pathname.startsWith('/api/')) {
        await handleApi(req, res, pathname);
        return true;
      }
      return false;
    } catch (err) {
      if (!err.status) console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong. Please try again.' });
      return true;
    }
  }

  return { handle };
}

module.exports = { createApp };

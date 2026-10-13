'use strict';
// The app's brain: API routes, login, photo handling. It doesn't care where data is stored (see store-*.js)
// or how it is hosted (server.js locally, api/[...slug].js on Vercel).

const crypto = require('crypto');

const MAX_BODY = 12 * 1024 * 1024;
const MAX_PHOTO = 8 * 1024 * 1024;
const PHOTO_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function createApp({ store, config, currency = '₹', locale = 'en-IN' }) {
  // ---------- auth ----------
  // Mom opens a secret link once (/?key=...) and gets a year-long cookie.
  // You sign in to /admin with a PIN. Your cookie also works on Mom's pages.

  const sign = (label) => crypto.createHmac('sha256', config.secret).update(label).digest('hex');
  const momToken = () => sign('mom:' + config.accessKey);
  const adminToken = () => sign('admin:' + config.adminPin);

  function safeEqual(a, b) {
    const A = Buffer.from(String(a));
    const B = Buffer.from(String(b));
    return A.length === B.length && crypto.timingSafeEqual(A, B);
  }

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 1) continue;
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
    }
    return out;
  }

  function roleOf(req) {
    const c = parseCookies(req);
    if (c.admin && safeEqual(c.admin, adminToken())) return 'admin';
    if (c.mom && safeEqual(c.mom, momToken())) return 'mom';
    return null;
  }

  function cookieHeader(req, name, value, maxAgeSec) {
    const secure = req.headers['x-forwarded-proto'] === 'https' || (req.socket && req.socket.encrypted);
    return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  const attempts = new Map(); // ip -> { count, resetAt }  (best effort; per server instance)
  function loginAllowed(req) {
    const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
    const now = Date.now();
    let a = attempts.get(ip);
    if (!a || a.resetAt < now) { a = { count: 0, resetAt: now + 10 * 60 * 1000 }; attempts.set(ip, a); }
    a.count++;
    return a.count <= 8;
  }

  // ---------- helpers ----------

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
        if (tooBig) reject(Object.assign(new Error('That photo is too big.'), { status: 413 }));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', reject);
    });
  }

  async function readJsonBody(req) {
    const bad = () => Object.assign(new Error('Bad request.'), { status: 400 });
    // Vercel may already have parsed the body for us.
    if (req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
        try { return JSON.parse(String(req.body) || '{}'); } catch { throw bad(); }
      }
      if (typeof req.body === 'object') return req.body;
    }
    const raw = await readBody(req);
    try { return JSON.parse(raw || '{}'); } catch { throw bad(); }
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

  // "Today" in India, since that is where Mom is. Only used when the phone sent no valid date.
  function fallbackToday() {
    return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  }

  const publicView = (e) => ({
    id: e.id,
    amount: e.amount,
    note: e.note,
    date: e.date,
    photo: e.photo ? '/photos/' + e.photo : null,
    thumb: e.thumb ? '/photos/' + e.thumb : e.photo ? '/photos/' + e.photo : null,
    createdAt: e.createdAt,
  });

  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- routes ----------

  async function handleApi(req, res, pathname) {
    const role = roleOf(req);
    const method = req.method;

    if (pathname === '/api/config' && method === 'GET') {
      return send(res, 200, { currency, locale });
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
      if (!loginAllowed(req)) return send(res, 429, { error: 'Too many tries. Please wait a few minutes.' });
      const body = await readJsonBody(req);
      if (!safeEqual(String(body.pin || '').trim(), config.adminPin)) {
        await sleep(800); // slows down guessing
        return send(res, 401, { error: 'Wrong PIN.' });
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, 'admin', adminToken(), 90 * 86400) });
    }

    if (pathname === '/api/admin/logout' && method === 'POST') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, 'admin', '', 0) });
    }

    if (pathname === '/api/admin/me' && method === 'GET') {
      if (role !== 'admin') return send(res, 401, { error: 'Please sign in.' });
      return send(res, 200, { ok: true, accessKey: config.accessKey });
    }

    if (pathname === '/api/admin/export' && method === 'GET') {
      if (role !== 'admin') return send(res, 401, 'Please sign in.');
      const rows = [['Date', 'Amount', 'Note', 'Has photo', 'Added at']];
      (await store.list())
        .filter((e) => !e.deleted)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1))
        .forEach((e) => rows.push([e.date, e.amount, e.note, e.photo ? 'yes' : 'no', e.createdAt]));
      const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
      return send(res, 200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="expenses-${fallbackToday()}.csv"`,
      });
    }

    if (!pathname.startsWith('/api/expenses')) return send(res, 404, { error: 'Not found.' });
    if (!role) return send(res, 401, { error: 'Please open the link you were given.' });

    if (pathname === '/api/expenses' && method === 'GET') {
      const list = (await store.list())
        .filter((e) => !e.deleted)
        .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
        .map(publicView);
      return send(res, 200, { expenses: list });
    }

    if (pathname === '/api/expenses' && method === 'POST') {
      const body = await readJsonBody(req);
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
        return send(res, 400, { error: 'Please enter how much it cost.' });
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
        amount,
        note: String(body.note || '').trim().slice(0, 500),
        date: isRealDate(body.date) ? body.date : fallbackToday(),
        photo,
        thumb,
        createdAt: new Date().toISOString(),
        deleted: false,
      };
      await store.update((list) => { list.push(expense); return list; });
      return send(res, 201, { expense: publicView(expense) });
    }

    const del = /^\/api\/expenses\/([a-f0-9]{16})$/.exec(pathname);
    if (del && method === 'DELETE') {
      // Soft delete: it disappears from totals and lists, but the record and photo stay in storage.
      let found = false;
      await store.update((list) => {
        const e = list.find((x) => x.id === del[1] && !x.deleted);
        if (e) {
          found = true;
          e.deleted = true;
          e.deletedAt = new Date().toISOString();
        }
        return list;
      });
      return found ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Not found.' });
    }

    return send(res, 404, { error: 'Not found.' });
  }

  // Returns true if the request was handled here, false if the caller should serve it (static files / 404).
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      // Mom's one-time link: sets her cookie, then sends her to the app.
      if (pathname === '/api/enter' || (pathname === '/' && url.searchParams.has('key'))) {
        const ok = safeEqual(url.searchParams.get('key') || '', config.accessKey);
        send(res, ok ? 302 : 403, ok ? '' : 'That link is not correct.', ok
          ? { Location: '/', 'Set-Cookie': cookieHeader(req, 'mom', momToken(), 365 * 86400) }
          : {});
        return true;
      }

      const photo = /^\/(?:photos|api\/photo)\/([a-f0-9]{16}(?:_t)?\.(jpg|png|webp))$/.exec(pathname);
      if (photo) {
        if (!roleOf(req)) { send(res, 401, 'Please open the link you were given.'); return true; }
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

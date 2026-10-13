'use strict';
// Mom's Expense Tracker - tiny zero-dependency server.
// Stores everything in ./data (expenses.json + photos/). Back that folder up and you've backed up everything.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = path.join(DATA_DIR, 'expenses.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CURRENCY = process.env.CURRENCY || '₹'; // ₹
const LOCALE = process.env.LOCALE || 'en-IN';
const MAX_BODY = 12 * 1024 * 1024;
const MAX_PHOTO = 8 * 1024 * 1024;

fs.mkdirSync(PHOTO_DIR, { recursive: true });

// ---------- storage ----------

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read ' + file + ':', err.message);
    return fallback;
  }
}

function loadConfig() {
  const cfg = readJson(CONFIG_FILE, {});
  let changed = false;
  if (!cfg.secret) { cfg.secret = crypto.randomBytes(32).toString('hex'); changed = true; }
  if (!cfg.accessKey) { cfg.accessKey = crypto.randomBytes(9).toString('base64url'); changed = true; }
  if (!cfg.adminPin) { cfg.adminPin = String(crypto.randomInt(100000, 1000000)); changed = true; }
  if (changed) writeJson(CONFIG_FILE, cfg);
  return {
    secret: cfg.secret,
    accessKey: process.env.ACCESS_KEY || cfg.accessKey,
    adminPin: process.env.ADMIN_PIN || cfg.adminPin,
  };
}

const cfg = loadConfig();
let expenses = readJson(DB_FILE, []);
const saveExpenses = () => writeJson(DB_FILE, expenses);

// ---------- auth ----------
// Mom gets a long secret link once (/?key=...) which sets a year-long cookie.
// You get a PIN for the dashboard (/admin). Your cookie also works on Mom's pages.

const sign = (label) => crypto.createHmac('sha256', cfg.secret).update(label).digest('hex');
const momToken = () => sign('mom:' + cfg.accessKey);
const adminToken = () => sign('admin:' + cfg.adminPin);

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
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

const attempts = new Map(); // ip -> { count, resetAt }
function loginAllowed(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || a.resetAt < now) { a = { count: 0, resetAt: now + 10 * 60 * 1000 }; attempts.set(ip, a); }
  a.count++;
  return a.count <= 8;
}

// ---------- helpers ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const payload = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
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
  const raw = await readBody(req);
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Bad request.'), { status: 400 }); }
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

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

// ---------- routes ----------

async function handleApi(req, res, url) {
  const role = roleOf(req);
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/config' && method === 'GET') {
    return send(res, 200, { currency: CURRENCY, locale: LOCALE });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!loginAllowed(req)) return send(res, 429, { error: 'Too many tries. Please wait a few minutes.' });
    const body = await readJsonBody(req);
    if (!safeEqual(String(body.pin || '').trim(), cfg.adminPin)) return send(res, 401, { error: 'Wrong PIN.' });
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, 'admin', adminToken(), 90 * 86400) });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, 'admin', '', 0) });
  }

  if (pathname === '/api/admin/me' && method === 'GET') {
    if (role !== 'admin') return send(res, 401, { error: 'Please sign in.' });
    return send(res, 200, { ok: true, accessKey: cfg.accessKey });
  }

  if (pathname === '/api/admin/export.csv' && method === 'GET') {
    if (role !== 'admin') return send(res, 401, 'Please sign in.');
    const rows = [['Date', 'Amount', 'Note', 'Has photo', 'Added at']];
    expenses
      .filter((e) => !e.deleted)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1))
      .forEach((e) => rows.push([e.date, e.amount, e.note, e.photo ? 'yes' : 'no', e.createdAt]));
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="expenses-${localToday()}.csv"`,
    });
  }

  if (!pathname.startsWith('/api/expenses')) return send(res, 404, { error: 'Not found.' });
  if (!role) return send(res, 401, { error: 'Please open the link you were given.' });

  if (pathname === '/api/expenses' && method === 'GET') {
    const list = expenses
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
      photo = `${id}.${img.ext}`;
      fs.writeFileSync(path.join(PHOTO_DIR, photo), img.buf);
      const t = body.thumb ? decodeImage(body.thumb, { jpegOnly: true }) : null;
      if (t) {
        thumb = `${id}_t.jpg`;
        fs.writeFileSync(path.join(PHOTO_DIR, thumb), t.buf);
      }
    }
    const expense = {
      id,
      amount,
      note: String(body.note || '').trim().slice(0, 500),
      date: isRealDate(body.date) ? body.date : localToday(),
      photo,
      thumb,
      createdAt: new Date().toISOString(),
      deleted: false,
    };
    expenses.push(expense);
    saveExpenses();
    return send(res, 201, { expense: publicView(expense) });
  }

  const del = /^\/api\/expenses\/([a-f0-9]{16})$/.exec(pathname);
  if (del && method === 'DELETE') {
    // Soft delete: it disappears from totals and lists, but the record and photo stay on disk.
    const e = expenses.find((x) => x.id === del[1] && !x.deleted);
    if (!e) return send(res, 404, { error: 'Not found.' });
    e.deleted = true;
    e.deletedAt = new Date().toISOString();
    saveExpenses();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found.' });
}

function serveFile(res, file, headers = {}) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...headers });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (pathname.startsWith('/api/')) return handleApi(req, res, url);

  // Mom's one-time link: /?key=...  ->  sets cookie and goes to the app.
  if (pathname === '/' && url.searchParams.has('key')) {
    const ok = safeEqual(url.searchParams.get('key'), cfg.accessKey);
    return send(res, ok ? 302 : 403, ok ? '' : 'That link is not correct.', ok
      ? { Location: '/', 'Set-Cookie': cookieHeader(req, 'mom', momToken(), 365 * 86400) }
      : {});
  }

  const photo = /^\/photos\/([a-f0-9]{16}(?:_t)?\.(?:jpg|png|webp))$/.exec(pathname);
  if (photo) {
    if (!roleOf(req)) return send(res, 401, 'Please open the link you were given.');
    return serveFile(res, path.join(PHOTO_DIR, photo[1]), { 'Cache-Control': 'private, max-age=31536000, immutable' });
  }

  let rel = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  return serveFile(res, file, { 'Cache-Control': 'no-cache' });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!err.status) console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong.' });
    });
  })
  .listen(PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    const hosts = ['localhost', ...ips];
    console.log('\n  Mom\'s Expense Tracker is running\n');
    console.log('  Mom opens (once, then bookmark / add to home screen):');
    hosts.forEach((h) => console.log(`    http://${h}:${PORT}/?key=${cfg.accessKey}`));
    console.log('\n  You open the dashboard:');
    hosts.forEach((h) => console.log(`    http://${h}:${PORT}/admin`));
    console.log(`    PIN: ${cfg.adminPin}`);
    console.log(`\n  Data is saved in: ${DATA_DIR}\n`);
  });

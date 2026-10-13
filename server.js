'use strict';
// Run the app on your own computer:  node server.js   (or double-click start.bat)
// Data is saved in ./data (expenses.json + photos/). On Vercel the app runs from api/[...slug].js instead.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { createApp } = require('./lib/app');
const { createFsStore } = require('./lib/store-fs');
const { loadLocalConfig } = require('./lib/config');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');

const config = loadLocalConfig(DATA_DIR);
const app = createApp({
  store: createFsStore(DATA_DIR),
  config,
  currency: process.env.CURRENCY || '₹',
  locale: process.env.LOCALE || 'en-IN',
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const rel = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

http
  .createServer(async (req, res) => {
    if (!(await app.handle(req, res))) serveStatic(req, res);
  })
  .listen(PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    const hosts = ['localhost', ...ips];
    console.log('\n  Family Expense Tracker is running\n');
    console.log('  Everyone opens the same address, taps their name and enters their PIN:');
    hosts.forEach((h) => console.log(`    http://${h}:${PORT}/`));
    console.log('\n  You sign in as "Admin" on that same page, with this PIN:');
    console.log(`    ${config.adminPin}`);
    console.log('  Then add family members from the admin dashboard.');
    console.log(`\n  Data is saved in: ${DATA_DIR}\n`);
  });

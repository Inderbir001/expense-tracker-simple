'use strict';
// Secrets: the admin PIN and a signing secret for login cookies.
// On Vercel they come from environment variables. Locally they are generated once into data/config.json.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ACCESS_KEY is now just a long random secret used to sign login cookies. Keep it unchanged,
// otherwise everyone is signed out. (Changing ADMIN_PIN only signs the admin out.)
function build(adminPin, seed, secret) {
  return {
    adminPin,
    secret: secret || crypto.createHash('sha256').update(`mom-expense-tracker|session|${seed}`).digest('hex'),
  };
}

// Returns { config } or { error } so callers can show a friendly message.
function configFromEnv(env = process.env) {
  const { ACCESS_KEY, ADMIN_PIN, SECRET } = env;
  if (!ACCESS_KEY || !ADMIN_PIN) {
    return { error: 'ACCESS_KEY and ADMIN_PIN are not set. Add them in Vercel: Project > Settings > Environment Variables, then redeploy.' };
  }
  if (ACCESS_KEY.length < 10) return { error: 'ACCESS_KEY is too short (use at least 10 characters).' };
  if (ADMIN_PIN.length < 4) return { error: 'ADMIN_PIN is too short (use at least 4 characters).' };
  return { config: build(ADMIN_PIN, ACCESS_KEY, SECRET) };
}

function loadLocalConfig(dataDir, env = process.env) {
  const file = path.join(dataDir, 'config.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  let changed = false;
  if (!saved.adminPin) { saved.adminPin = String(crypto.randomInt(100000, 1000000)); changed = true; }
  if (!saved.secret) { saved.secret = crypto.randomBytes(32).toString('hex'); changed = true; }
  if (changed) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  }
  return { adminPin: env.ADMIN_PIN || saved.adminPin, secret: saved.secret };
}

module.exports = { configFromEnv, loadLocalConfig };

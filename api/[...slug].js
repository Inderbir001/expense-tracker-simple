'use strict';
// Vercel entry point: every /api/* request (plus /photos/* and Mom's /?key= link) lands here.
// Data lives in Vercel Blob; the key and PIN come from environment variables.

const { createApp } = require('../lib/app');
const { createBlobStore } = require('../lib/store-blob');
const { configFromEnv } = require('../lib/config');

let app = null;

function problem(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: message }));
}

function getApp() {
  if (app) return { app };
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return { error: 'Storage is not connected yet. In Vercel open Storage, create a Private Blob store, connect it to this project, then redeploy.' };
  }
  const { config, error } = configFromEnv();
  if (error) return { error };
  app = createApp({
    store: createBlobStore(),
    config,
    currency: process.env.CURRENCY || '\u20B9',
    locale: process.env.LOCALE || 'en-IN',
  });
  return { app };
}

module.exports = async (req, res) => {
  const { app: ready, error } = getApp();
  if (error) return problem(res, 503, error);
  const handled = await ready.handle(req, res);
  if (!handled) problem(res, 404, 'Not found.');
};

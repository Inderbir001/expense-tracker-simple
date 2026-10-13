'use strict';
// Stores everything in Vercel Blob (a private store):
//   expenses.json   all expense entries
//   members.json    family members (names, hashed PINs, budgets)
//   state.json      small bits of state (sign-in lockouts)
//   photos/<name>   the photos and thumbnails
// Each JSON document is updated with an ETag check so two saves at once can't overwrite each other.

const MAX_TRIES = 12;
const CHECKED_TRIES = 4; // after this many failed ETag checks, stop checking and just overwrite

function createBlobStore({ sdk = require('@vercel/blob'), access = process.env.BLOB_ACCESS || 'private' } = {}) {
  async function toBuffer(stream) {
    return Buffer.from(await new Response(stream).arrayBuffer());
  }

  const isNotFound = (err) =>
    err && (err.name === 'BlobNotFoundError' || (sdk.BlobNotFoundError && err instanceof sdk.BlobNotFoundError));

  const isConflict = (err) =>
    err && (err.name === 'BlobPreconditionFailedError' ||
      (sdk.BlobPreconditionFailedError && err instanceof sdk.BlobPreconditionFailedError));

  // The ETag must come from head() (the API's own value, the one put() compares against).
  // The HTTP ETag header that get() returns is a different, CDN-level value and never matches.
  // Order matters: ETag first, then content. If the content is newer than the ETag the write is
  // refused (safe, we retry); the other way round could silently lose an update.
  async function read(path, fallback) {
    let etag = null;
    try {
      etag = (await sdk.head(path)).etag || null;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      return { value: fallback, etag: null };
    }
    const res = await sdk.get(path, { access, useCache: false });
    if (!res || res.statusCode !== 200) return { value: fallback, etag: null };
    const text = (await toBuffer(res.stream)).toString('utf8');
    let value = fallback;
    try { value = JSON.parse(text); } catch { /* keep fallback */ }
    return { value, etag };
  }

  const write = (path, data, options) =>
    sdk.put(path, JSON.stringify(data), {
      access,
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      ...options,
    });

  return {
    kind: 'Vercel Blob',

    async getDoc(name, fallback) {
      return (await read(name + '.json', fallback)).value;
    },

    // mutator(value) returns the new value. It may run more than once, so keep it free of side effects.
    async updateDoc(name, fallback, mutator) {
      const path = name + '.json';
      let lastError;
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        const { value, etag } = await read(path, fallback);
        const next = mutator(structuredClone(value));
        try {
          if (etag && attempt <= CHECKED_TRIES) {
            await write(path, next, { ifMatch: etag }); // updating: only if the ETag still matches
          } else if (etag) {
            await write(path, next); // the check keeps failing: don't let that block saving
          } else {
            await write(path, next, { allowOverwrite: false }); // creating: only if it still doesn't exist
          }
          return next;
        } catch (err) {
          lastError = err;
          // A conflict, or someone else created the file first: read again and retry.
          if (!isConflict(err) && (etag || (await read(path, null)).etag === null)) throw err;
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 90));
        }
      }
      throw lastError;
    },

    async putPhoto(name, buf) {
      await sdk.put('photos/' + name, buf, {
        access,
        contentType: name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 365 * 24 * 3600,
      });
    },

    async getPhoto(name) {
      const res = await sdk.get('photos/' + name, { access });
      if (!res || res.statusCode !== 200) return null;
      return toBuffer(res.stream);
    },
  };
}

module.exports = { createBlobStore };

'use strict';
// Stores everything in Vercel Blob (a private store):
//   expenses.json     the list of all entries (small; updated with an ETag check)
//   state.json        small bits of state (sign-in lockout)
//   photos/<name>     the photos and thumbnails

const INDEX = 'expenses.json';
const STATE = 'state.json';
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
  async function readIndex() {
    let etag = null;
    try {
      etag = (await sdk.head(INDEX)).etag || null;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      return { list: [], etag: null };
    }
    const res = await sdk.get(INDEX, { access, useCache: false });
    if (!res || res.statusCode !== 200) return { list: [], etag: null };
    const text = (await toBuffer(res.stream)).toString('utf8');
    return { list: JSON.parse(text || '[]'), etag };
  }

  const putIndex = (data, options) =>
    sdk.put(INDEX, JSON.stringify(data), {
      access,
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      ...options,
    });

  return {
    kind: 'Vercel Blob',

    async list() {
      return (await readIndex()).list;
    },

    // Read, change, write back only if nobody else changed it in between; retry otherwise.
    async update(mutator) {
      let lastError;
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        const { list, etag } = await readIndex();
        const next = mutator(list.slice());
        try {
          if (etag && attempt <= CHECKED_TRIES) {
            await putIndex(next, { ifMatch: etag }); // updating: only if the ETag still matches
          } else if (etag) {
            await putIndex(next); // the check keeps failing: don't let that block saving
          } else {
            await putIndex(next, { allowOverwrite: false }); // creating: only if it still doesn't exist
          }
          return next;
        } catch (err) {
          lastError = err;
          // A conflict, or someone else created the file first: read again and retry.
          if (!isConflict(err) && (etag || !(await readIndex()).etag)) throw err;
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 90));
        }
      }
      throw lastError;
    },

    async getState() {
      const res = await sdk.get(STATE, { access, useCache: false });
      if (!res || res.statusCode !== 200) return {};
      try { return JSON.parse((await toBuffer(res.stream)).toString('utf8')); } catch { return {}; }
    },

    async setState(state) {
      await sdk.put(STATE, JSON.stringify(state), {
        access,
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
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

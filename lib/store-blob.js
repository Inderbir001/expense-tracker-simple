'use strict';
// Stores everything in Vercel Blob (a private store):
//   expenses.json     the list of all entries (small; updated with optimistic concurrency)
//   photos/<name>     the photos and thumbnails

const INDEX = 'expenses.json';
const STATE = 'state.json';
const MAX_TRIES = 12;

function createBlobStore({ sdk = require('@vercel/blob'), access = process.env.BLOB_ACCESS || 'private' } = {}) {
  async function toBuffer(stream) {
    return Buffer.from(await new Response(stream).arrayBuffer());
  }

  async function readIndex() {
    const res = await sdk.get(INDEX, { access, useCache: false });
    if (!res || res.statusCode !== 200) return { list: [], etag: null };
    const text = (await toBuffer(res.stream)).toString('utf8');
    return { list: JSON.parse(text || '[]'), etag: res.blob.etag };
  }

  const isConflict = (err) =>
    err && (err.name === 'BlobPreconditionFailedError' ||
      (sdk.BlobPreconditionFailedError && err instanceof sdk.BlobPreconditionFailedError));

  return {
    kind: 'Vercel Blob',

    async list() {
      return (await readIndex()).list;
    },

    // Read, change, write back only if nobody else changed it in between (ETag check); retry otherwise.
    async update(mutator) {
      for (let attempt = 1; ; attempt++) {
        const { list, etag } = await readIndex();
        const next = mutator(list.slice());
        try {
          // Updating: only if the ETag still matches. Creating (first ever entry): only if it still doesn't exist.
          await sdk.put(INDEX, JSON.stringify(next), {
            access,
            contentType: 'application/json',
            addRandomSuffix: false,
            allowOverwrite: !!etag,
            cacheControlMaxAge: 60,
            ...(etag ? { ifMatch: etag } : {}),
          });
          return next;
        } catch (err) {
          if (attempt >= MAX_TRIES) throw err;
          // A conflict, or someone else created the file first: read again and retry.
          if (!isConflict(err) && (etag || !(await readIndex()).etag)) throw err;
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 90));
        }
      }
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

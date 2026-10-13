'use strict';
// Stores everything in a local folder: <dir>/expenses.json, members.json, state.json and <dir>/photos/*

const fs = require('fs');
const path = require('path');

function createFsStore(dataDir) {
  const photoDir = path.join(dataDir, 'photos');
  fs.mkdirSync(photoDir, { recursive: true });

  const docs = new Map();
  const fileOf = (name) => path.join(dataDir, name + '.json');

  function load(name, fallback) {
    if (!docs.has(name)) {
      let value = fallback;
      try {
        value = JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') console.error('Could not read ' + fileOf(name) + ':', err.message);
      }
      docs.set(name, value);
    }
    return docs.get(name);
  }

  return {
    kind: 'folder',
    where: dataDir,

    async getDoc(name, fallback) {
      return structuredClone(load(name, fallback));
    },

    // mutator(value) returns the new value. Runs synchronously, so there are no races in one process.
    async updateDoc(name, fallback, mutator) {
      const next = mutator(structuredClone(load(name, fallback)));
      const file = fileOf(name);
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, file);
      docs.set(name, next);
      return structuredClone(next);
    },

    async putPhoto(name, buf) {
      fs.writeFileSync(path.join(photoDir, name), buf);
    },

    async getPhoto(name) {
      try { return fs.readFileSync(path.join(photoDir, name)); } catch { return null; }
    },
  };
}

module.exports = { createFsStore };

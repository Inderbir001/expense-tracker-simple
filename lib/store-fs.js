'use strict';
// Stores everything in a local folder: <dir>/expenses.json and <dir>/photos/*

const fs = require('fs');
const path = require('path');

function createFsStore(dataDir) {
  const photoDir = path.join(dataDir, 'photos');
  const dbFile = path.join(dataDir, 'expenses.json');
  const stateFile = path.join(dataDir, 'state.json');
  fs.mkdirSync(photoDir, { recursive: true });

  let expenses = [];
  try {
    expenses = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read ' + dbFile + ':', err.message);
  }

  return {
    kind: 'folder',
    where: dataDir,

    async list() {
      return expenses;
    },

    // mutator(list) returns the new list. Runs synchronously, so there are no races in one process.
    async update(mutator) {
      expenses = mutator(expenses.slice());
      const tmp = dbFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(expenses, null, 2));
      fs.renameSync(tmp, dbFile);
      return expenses;
    },

    async getState() {
      try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; }
    },

    async setState(state) {
      fs.writeFileSync(stateFile, JSON.stringify(state));
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

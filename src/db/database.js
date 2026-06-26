'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// We use sql.js (pure WebAssembly SQLite) instead of the native better-sqlite3
// so there are NO build tools / Visual Studio required - npm install just works.
//
// sql.js keeps the whole DB in memory. We persist it to disk on every write
// and load it back on startup. A thin wrapper below recreates the
// better-sqlite3 synchronous API: db.prepare(sql).get()/.all()/.run(),
// and db.exec(sql) - so none of the service files need to change.
const initSqlJs = require('sql.js');

let SQL = null;        // the sql.js module
let rawDb = null;      // the underlying sql.js Database
let wrapper = null;    // our better-sqlite3-style wrapper
let saveTimer = null;

function dbPath() {
  const base = app ? app.getPath('userData') : __dirname;
  return path.join(base, 'nebula.db');
}

// Write the in-memory DB to disk (debounced to avoid thrashing).
function persist() {
  if (!rawDb) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = rawDb.export();
      fs.writeFileSync(dbPath(), Buffer.from(data));
    } catch (e) {
      console.error('Failed to persist DB:', e.message);
    }
  }, 50);
}

// Detects statements that mutate data so we know when to persist.
function isWrite(sql) {
  return /^\s*(insert|update|delete|create|drop|alter|replace)/i.test(sql);
}

// Builds a prepared-statement object mimicking better-sqlite3.
function makeStatement(sql) {
  return {
    // .get(...params) -> first row as object, or undefined
    get(...params) {
      const stmt = rawDb.prepare(sql);
      try {
        stmt.bind(flatten(params));
        const row = stmt.step() ? stmt.getAsObject() : undefined;
        return row;
      } finally {
        stmt.free();
      }
    },
    // .all(...params) -> array of row objects
    all(...params) {
      const stmt = rawDb.prepare(sql);
      const rows = [];
      try {
        stmt.bind(flatten(params));
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    },
    // .run(...params) -> executes a write
    run(...params) {
      const stmt = rawDb.prepare(sql);
      try {
        stmt.bind(flatten(params));
        stmt.step();
      } finally {
        stmt.free();
      }
      if (isWrite(sql)) persist();
      return { changes: rawDb.getRowsModified() };
    }
  };
}

// sql.js wants a flat array of bind params. Our callers pass positional args,
// and undefined must become null for binding.
function flatten(params) {
  return params.map((p) => (p === undefined ? null : p));
}

function buildWrapper() {
  return {
    prepare: (sql) => makeStatement(sql),
    exec: (sql) => { rawDb.exec(sql); persist(); },
    pragma: () => {} // no-op: sql.js doesn't need WAL and ignores most pragmas
  };
}

// IMPORTANT: sql.js loads asynchronously. main.js awaits initDatabase().
async function initDatabase() {
  if (wrapper) return wrapper;

  SQL = await initSqlJs({
    // Resolve the wasm file shipped inside the sql.js package.
    locateFile: (file) => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
  });

  const file = dbPath();
  if (fs.existsSync(file)) {
    rawDb = new SQL.Database(fs.readFileSync(file));
  } else {
    rawDb = new SQL.Database();
  }

  wrapper = buildWrapper();

  wrapper.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      theme TEXT DEFAULT 'dark',
      default_model TEXT,
      openrouter_key TEXT,
      temperature REAL DEFAULT 0.7
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT,
      mode TEXT DEFAULT 'normal',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory (
      chat_id TEXT PRIMARY KEY,
      summary TEXT DEFAULT '',
      updated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
  `);

  return wrapper;
}

function getDb() {
  if (!wrapper) {
    throw new Error('Database not initialized yet. initDatabase() must finish first.');
  }
  return wrapper;
}

module.exports = { initDatabase, getDb };

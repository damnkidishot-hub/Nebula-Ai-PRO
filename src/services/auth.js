'use strict';

const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db/database');

function register({ username, email, password, displayName }) {
  if (!username || !password) {
    return { ok: false, error: 'Username and password are required.' };
  }
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(username, email || '');
  if (existing) return { ok: false, error: 'Username or email already taken.' };

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();

  db.prepare(`INSERT INTO users (id, username, email, password_hash, display_name, avatar, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, username, email || null, hash, displayName || username, null, now);

  db.prepare('INSERT INTO settings (user_id, theme, temperature) VALUES (?, ?, ?)')
    .run(id, 'dark', 0.7);

  return { ok: true, user: publicUser(id) };
}

function login({ username, password }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(username, username);
  if (!row) return { ok: false, error: 'Invalid credentials.' };
  if (!bcrypt.compareSync(password, row.password_hash)) {
    return { ok: false, error: 'Invalid credentials.' };
  }
  return { ok: true, user: publicUser(row.id) };
}

function getProfile(userId) {
  const u = publicUser(userId);
  if (!u) return { ok: false, error: 'User not found.' };
  return { ok: true, user: u };
}

function updateProfile({ userId, displayName, avatar, email }) {
  const db = getDb();
  db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), avatar = COALESCE(?, avatar), email = COALESCE(?, email) WHERE id = ?')
    .run(displayName ?? null, avatar ?? null, email ?? null, userId);
  return { ok: true, user: publicUser(userId) };
}

function publicUser(userId) {
  const db = getDb();
  const u = db.prepare('SELECT id, username, email, display_name, avatar, created_at FROM users WHERE id = ?')
    .get(userId);
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.display_name,
    avatar: u.avatar,
    createdAt: u.created_at
  };
}

module.exports = { register, login, getProfile, updateProfile };

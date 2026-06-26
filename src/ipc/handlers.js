'use strict';

const { ipcMain, BrowserWindow } = require('electron');
const { v4: uuid } = require('uuid');
const { getDb } = require('../db/database');
const auth = require('../services/auth');
const { listModels, getModel } = require('../services/modelLoader');
const openrouter = require('../services/openrouter');
const localModel = require('../services/localModel');
const memory = require('../services/memory');

function registerIpcHandlers() {
  // ---------- Auth ----------
  ipcMain.handle('auth:register', (_e, data) => auth.register(data));
  ipcMain.handle('auth:login', (_e, data) => auth.login(data));
  ipcMain.handle('auth:profile', (_e, userId) => auth.getProfile(userId));
  ipcMain.handle('auth:updateProfile', (_e, data) => auth.updateProfile(data));

  // ---------- Models ----------
  ipcMain.handle('models:list', () => listModels());

  // ---------- Chats ----------
  ipcMain.handle('chats:list', (_e, userId) => {
    const db = getDb();
    const rows = db.prepare('SELECT id, title, model, mode, updated_at FROM chats WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId);
    return { ok: true, chats: rows };
  });

  ipcMain.handle('chats:create', (_e, { userId, title, model, mode }) => {
    const db = getDb();
    const id = uuid();
    const now = Date.now();
    db.prepare('INSERT INTO chats (id, user_id, title, model, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, title || 'New chat', model || null, mode || 'normal', now, now);
    return { ok: true, chat: { id, title: title || 'New chat', model, mode: mode || 'normal' } };
  });

  ipcMain.handle('chats:messages', (_e, chatId) => {
    const db = getDb();
    const rows = db.prepare('SELECT id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
      .all(chatId);
    return { ok: true, messages: rows };
  });

  ipcMain.handle('chats:rename', (_e, { chatId, title }) => {
    const db = getDb();
    db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), chatId);
    return { ok: true };
  });

  ipcMain.handle('chats:delete', (_e, chatId) => {
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
    db.prepare('DELETE FROM memory WHERE chat_id = ?').run(chatId);
    db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
    return { ok: true };
  });

  // ---------- Settings ----------
  ipcMain.handle('settings:get', (_e, userId) => {
    const db = getDb();
    let row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
    if (!row) {
      db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);
      row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
    }
    return { ok: true, settings: row };
  });

  ipcMain.handle('settings:save', (_e, { userId, theme, defaultModel, openrouterKey, temperature }) => {
    const db = getDb();
    db.prepare(`INSERT INTO settings (user_id, theme, default_model, openrouter_key, temperature)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  theme = excluded.theme,
                  default_model = excluded.default_model,
                  openrouter_key = excluded.openrouter_key,
                  temperature = excluded.temperature`)
      .run(userId, theme || 'dark', defaultModel || null, openrouterKey || null, temperature ?? 0.7);
    return { ok: true };
  });

  // ---------- Streaming chat ----------
  ipcMain.handle('chat:send', async (event, payload) => {
    const { chatId, userId, content, modelName, mode } = payload;
    const requestId = uuid();
    const db = getDb();
    const win = BrowserWindow.fromWebContents(event.sender);

    const send = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);

    // Persist the user message.
    const now = Date.now();
    db.prepare('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), chatId, 'user', content, now);
    db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, chatId);

    // Auto-title from first user message.
    const count = db.prepare('SELECT COUNT(*) c FROM messages WHERE chat_id = ?').get(chatId).c;
    if (count === 1) {
      db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(content.slice(0, 48), chatId);
    }

    // Resolve model + settings.
    const model = getModel(modelName);
    if (!model || model.type === 'invalid') {
      send('chat:error', { requestId, error: 'Selected model not found or invalid JSON in models/.' });
      return { ok: false, requestId };
    }
    const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId) || {};
    const temperature = settings.temperature ?? 0.7;

    const messages = memory.buildContext({ chatId, mode: mode || 'normal' });

    // Run the stream asynchronously so the IPC call returns the id quickly.
    (async () => {
      let full = '';
      try {
        const onToken = (delta) => {
          full += delta;
          send('chat:token', { requestId, delta });
        };

        if (model.type === 'local') {
          if (!localModel.available()) {
            throw new Error('Local models need node-llama-cpp. Run: npm install node-llama-cpp');
          }
          await localModel.streamChat({ ggufPath: model.ggufPath, messages, temperature, onToken });
        } else {
          const apiKey = model.api || settings.openrouter_key || process.env.OPENROUTER_API_KEY;
          await openrouter.streamChat({ apiKey, model: model.model, messages, temperature, onToken });
        }

        // Persist assistant reply + update memory.
        db.prepare('INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(uuid(), chatId, 'assistant', full, Date.now());
        memory.maybeSummarize(chatId);

        send('chat:done', { requestId, content: full });
      } catch (err) {
        send('chat:error', { requestId, error: err.message });
      }
    })();

    return { ok: true, requestId };
  });
}

module.exports = { registerIpcHandlers };

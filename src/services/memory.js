'use strict';

const { getDb } = require('../db/database');

// Memory strategy that keeps model context small:
//  - Keep only the last N raw turns verbatim.
//  - Older turns are folded into a rolling text summary stored per chat.
//  - The summary is injected as a system note so the AI "remembers".
const KEEP_RECENT = 8;        // raw messages kept in full
const SUMMARY_TRIGGER = 12;   // start summarizing once history exceeds this

function getSummary(chatId) {
  const db = getDb();
  const row = db.prepare('SELECT summary FROM memory WHERE chat_id = ?').get(chatId);
  return row ? row.summary : '';
}

function setSummary(chatId, summary) {
  const db = getDb();
  db.prepare(`INSERT INTO memory (chat_id, summary, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(chat_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`)
    .run(chatId, summary, Date.now());
}

// Builds the message array sent to the model, keeping it compact.
function buildContext({ chatId, mode }) {
  const db = getDb();
  const all = db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
    .all(chatId);

  const summary = getSummary(chatId);
  const recent = all.slice(-KEEP_RECENT);

  const systemParts = [];
  if (mode === 'agent') {
    systemParts.push('You are Nebula, an autonomous coding agent. Plan steps, then act. (Agent tools are added later.)');
  } else {
    systemParts.push('You are Nebula Code AI, a helpful coding assistant. Use markdown and fenced code blocks for code.');
  }
  if (summary) {
    systemParts.push('Conversation memory (earlier context, summarized):\n' + summary);
  }

  const messages = [{ role: 'system', content: systemParts.join('\n\n') }];
  for (const m of recent) messages.push({ role: m.role, content: m.content });
  return messages;
}

// Folds old messages into the rolling summary when history grows.
// Cheap, local, no extra API cost: a heuristic compression.
function maybeSummarize(chatId) {
  const db = getDb();
  const all = db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC')
    .all(chatId);
  if (all.length <= SUMMARY_TRIGGER) return;

  const old = all.slice(0, all.length - KEEP_RECENT);
  const prev = getSummary(chatId);

  const folded = old.map((m) => {
    const who = m.role === 'user' ? 'User' : 'AI';
    const text = m.content.replace(/\s+/g, ' ').trim().slice(0, 220);
    return `- ${who}: ${text}`;
  }).join('\n');

  const merged = [prev, folded].filter(Boolean).join('\n');
  // Cap summary length so it never bloats context.
  setSummary(chatId, merged.slice(-4000));
}

module.exports = { buildContext, maybeSummarize, getSummary, setSummary };

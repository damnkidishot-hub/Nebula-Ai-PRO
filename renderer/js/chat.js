const $ = (id) => document.getElementById(id);
const user = Session.requireAuth();

let state = {
  chats: [], currentChatId: null, models: [], selectedModel: null,
  mode: 'normal', streaming: false, activeRequest: null, autoScroll: true
};

async function init() {
  $('navAvatar').textContent = initials(user.displayName || user.username);
  if (user.avatar) { $('navAvatar').style.backgroundImage = `url(${user.avatar})`; $('navAvatar').textContent = ''; }
  $('navWho').innerHTML = `<strong>${escapeHtml(user.displayName || user.username)}</strong><br><small>@${escapeHtml(user.username)}</small>`;
  await loadModels();
  await loadChats();
  bindUI();
  bindStream();
  bindShortcuts();
}

// ---------- Models ----------
async function loadModels() {
  const res = await window.nebula.listModels();
  state.models = res.models || [];
  const settings = await window.nebula.getSettings(user.id);
  const def = settings.settings?.default_model;
  state.selectedModel = def && state.models.find(m => m.name === def)
    ? def : (state.models.find(m => m.type !== 'invalid')?.name || null);
  renderModelDropdown();
  updateModelLabel();
}
function renderModelDropdown() {
  const dd = $('modelDropdown');
  if (!state.models.length) { dd.innerHTML = '<div class="opt">No models. Add JSON files to models/</div>'; return; }
  dd.innerHTML = state.models.map(m => {
    const sel = m.name === state.selectedModel ? 'sel' : '';
    const sub = m.type === 'invalid' ? 'Invalid JSON' : `${m.type} · ${escapeHtml(m.model || '')}`;
    const warn = m.type === 'local' && m.exists === false ? ' (gguf missing)' : '';
    return `<div class="opt ${sel}" data-model="${escapeHtml(m.name)}">${escapeHtml(m.name)}<small>${sub}${warn}</small></div>`;
  }).join('');
  dd.querySelectorAll('.opt[data-model]').forEach(o => o.addEventListener('click', () => {
    state.selectedModel = o.dataset.model; updateModelLabel(); renderModelDropdown(); dd.classList.remove('open');
  }));
}
function updateModelLabel() { $('modelLabel').textContent = state.selectedModel || 'Select model'; }

// ---------- Chats (grouped + searchable) ----------
async function loadChats() {
  const res = await window.nebula.listChats(user.id);
  state.chats = res.chats || [];
  renderChatList();
}
function groupByDay(chats) {
  const now = Date.now(), day = 864e5, groups = {};
  for (const c of chats) {
    const age = now - c.updated_at;
    const key = age < day ? 'Today' : age < 2 * day ? 'Yesterday' : age < 7 * day ? 'This week' : 'Older';
    (groups[key] = groups[key] || []).push(c);
  }
  return groups;
}
function renderChatList(filter = '') {
  const list = $('chatList');
  const f = filter.toLowerCase();
  const filtered = state.chats.filter(c => c.title.toLowerCase().includes(f));
  const groups = groupByDay(filtered);
  let html = '';
  for (const day of ['Today', 'Yesterday', 'This week', 'Older']) {
    if (!groups[day]) continue;
    html += `<div class="chat-day">${day}</div>`;
    html += groups[day].map(c => {
      const active = c.id === state.currentChatId ? 'active' : '';
      return `<div class="chat-item ${active}" data-id="${c.id}" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}<button class="del" data-del="${c.id}">✕</button></div>`;
    }).join('');
  }
  list.innerHTML = html || '<div class="chat-day">No chats</div>';
  list.querySelectorAll('.chat-item').forEach(el => el.addEventListener('click', (e) => {
    if (e.target.dataset.del) return; openChat(el.dataset.id);
  }));
  list.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.nebula.deleteChat(el.dataset.del);
    if (state.currentChatId === el.dataset.del) { state.currentChatId = null; showEmpty(); }
    await loadChats(); toast('Chat deleted');
  }));
}

async function openChat(chatId) {
  state.currentChatId = chatId;
  const chat = state.chats.find(c => c.id === chatId);
  $('chatTitle').textContent = chat ? chat.title : 'Chat';
  if (chat?.mode) setMode(chat.mode);
  renderChatList($('chatSearch').value);
  const res = await window.nebula.getMessages(chatId);
  clearMessages();
  (res.messages || []).forEach(m => appendMessage(m.role, m.content));
}

function clearMessages() { $('messages').innerHTML = ''; }
function showEmpty() {
  $('chatTitle').textContent = 'New chat';
  $('messages').innerHTML = `<div class="empty" id="emptyState"><div class="big">How can I help you build today?</div>
    <div>Pick a model, choose a mode, and start chatting.</div></div>`;
}

// ---------- Messages ----------
function appendMessage(role, content) {
  $('emptyState')?.remove();
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  const av = role === 'user' ? (initials(user.displayName || user.username)) : 'N';
  const tools = role === 'assistant'
    ? `<button class="msg-tool" data-act="copy">Copy</button><button class="msg-tool" data-act="regen">Regenerate</button>`
    : `<button class="msg-tool" data-act="edit">Edit</button><button class="msg-tool" data-act="copy">Copy</button>`;
  row.innerHTML = `<div class="bubble-avatar">${av}</div>
    <div style="flex:1;min-width:0"><div class="bubble">${renderMarkdown(content)}</div>
    <div class="msg-tools">${tools}</div></div>`;
  row._raw = content;
  $('messages').appendChild(row);
  wireMsgTools(row);
  if (state.autoScroll) scrollDown();
  return row.querySelector('.bubble');
}
function wireMsgTools(row) {
  row.querySelectorAll('.msg-tool').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'copy') { navigator.clipboard.writeText(row._raw); toast('Copied to clipboard', 'ok'); }
    if (act === 'edit') { $('input').value = row._raw; $('input').focus(); autoGrow(); toast('Loaded into composer to edit & resend'); }
    if (act === 'regen') regenerate();
  }));
}
function scrollDown() { const m = $('messages'); m.scrollTop = m.scrollHeight; }

// Track manual scroll so we don't yank the user back down (Feature: auto-scroll lock).
$('messages')?.addEventListener('scroll', () => {
  const m = $('messages');
  state.autoScroll = m.scrollHeight - m.scrollTop - m.clientHeight < 80;
});

// ---------- Send + stream ----------
async function send(textOverride) {
  const input = $('input');
  const text = (textOverride ?? input.value).trim();
  if (!text || state.streaming) return;
  if (!state.selectedModel) { toast('Select a model first (add JSON to models/)', 'error'); return; }

  if (!state.currentChatId) {
    const res = await window.nebula.createChat({ userId: user.id, title: 'New chat', model: state.selectedModel, mode: state.mode });
    state.currentChatId = res.chat.id; await loadChats();
  }

  appendMessage('user', text);
  input.value = ''; autoGrow(); updateCharCount();
  state.autoScroll = true;

  const bubble = appendMessage('assistant', '');
  bubble.innerHTML = '<span class="typing"></span>';
  let acc = '';
  state.streaming = true; toggleSend(true);

  const res = await window.nebula.sendMessage({
    chatId: state.currentChatId, userId: user.id, content: text,
    modelName: state.selectedModel, mode: state.mode
  });
  state.activeRequest = res.requestId;
  state.activeBubble = bubble;
  state.pushToken = (d) => { acc += d; bubble.innerHTML = renderMarkdown(acc) + '<span class="typing"></span>'; if (state.autoScroll) scrollDown(); };
  state.finish = (final) => { const t = final || acc; bubble.innerHTML = renderMarkdown(t); bubble.closest('.msg-row')._raw = t; };
}

async function regenerate() {
  // Resend the last user message (Feature: regenerate response).
  const rows = [...$('messages').querySelectorAll('.msg-row.user')];
  const lastUser = rows[rows.length - 1];
  if (lastUser) send(lastUser._raw);
}

function bindStream() {
  window.nebula.onToken(({ requestId, delta }) => { if (requestId === state.activeRequest) state.pushToken(delta); });
  window.nebula.onDone(async ({ requestId, content }) => {
    if (requestId !== state.activeRequest) return;
    state.finish(content); endStream();
    await loadChats();
    const chat = state.chats.find(c => c.id === state.currentChatId);
    if (chat) $('chatTitle').textContent = chat.title;
  });
  window.nebula.onError(({ requestId, error }) => {
    if (requestId !== state.activeRequest) return;
    state.activeBubble.innerHTML = `<p style="color:var(--danger)">⚠ ${escapeHtml(error)}</p>`;
    endStream(); toast(error, 'error');
  });
}
function endStream() { state.streaming = false; toggleSend(false); state.activeRequest = null; }
function toggleSend(streaming) {
  const b = $('sendBtn');
  b.disabled = false;
  b.textContent = streaming ? '■' : '↑';
  b.title = streaming ? 'Stop' : 'Send';
}

// ---------- Mode ----------
function setMode(mode) {
  state.mode = mode;
  $('modeLabel').textContent = mode === 'agent' ? 'Agent' : 'Normal';
  $('modeDropdown').querySelectorAll('.opt').forEach(o => o.classList.toggle('sel', o.dataset.mode === mode));
}

// ---------- Export (Feature: export chat as Markdown) ----------
async function exportChat() {
  if (!state.currentChatId) { toast('Open a chat first', 'error'); return; }
  const res = await window.nebula.getMessages(state.currentChatId);
  const chat = state.chats.find(c => c.id === state.currentChatId);
  const md = `# ${chat?.title || 'Chat'}\n\n` + (res.messages || [])
    .map(m => `**${m.role === 'user' ? 'You' : 'Nebula'}:**\n\n${m.content}`).join('\n\n---\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(chat?.title || 'chat').replace(/[^\w]+/g, '-')}.md`;
  a.click(); toast('Exported as Markdown', 'ok');
}

// ---------- UI helpers ----------
function autoGrow() { const i = $('input'); i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 200) + 'px'; }
function updateCharCount() { $('charCount').textContent = $('input').value.length; }

function bindUI() {
  const toggle = (pill, dd) => $(pill).addEventListener('click', (e) => { if (e.target.closest('.dropdown')) return; $(dd).classList.toggle('open'); });
  toggle('modelPill', 'modelDropdown'); toggle('modePill', 'modeDropdown');
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#modelPill')) $('modelDropdown').classList.remove('open');
    if (!e.target.closest('#modePill')) $('modeDropdown').classList.remove('open');
  });
  $('modeDropdown').querySelectorAll('.opt').forEach(o => o.addEventListener('click', () => { setMode(o.dataset.mode); $('modeDropdown').classList.remove('open'); }));

  $('newChat').addEventListener('click', () => { state.currentChatId = null; showEmpty(); renderChatList(); bindSuggest(); });
  $('chatSearch').addEventListener('input', (e) => renderChatList(e.target.value));
  $('toggleSidebar').addEventListener('click', () => $('sidebar').classList.toggle('collapsed'));
  $('themeBtn').addEventListener('click', () => { const next = Theme.get() === 'dark' ? 'light' : 'dark'; Theme.apply(next); toast('Theme: ' + next); });
  $('exportBtn').addEventListener('click', exportChat);
  $('logoutBtn').addEventListener('click', () => { Session.clear(); location.href = 'login.html'; });

  $('sendBtn').addEventListener('click', () => { if (state.streaming) { toast('Stopping...'); endStream(); } else send(); });
  const input = $('input');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { autoGrow(); updateCharCount(); });
  bindSuggest();
}

function bindSuggest() {
  document.querySelectorAll('#suggest .card-s').forEach(c => c.addEventListener('click', () => {
    $('input').value = c.dataset.q; $('input').focus(); autoGrow(); updateCharCount();
  }));
}

// ---------- Keyboard shortcuts + command palette ----------
function bindShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('chatSearch').focus(); }
    if (mod && e.key === 'Enter') { e.preventDefault(); send(); }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); $('sidebar').classList.toggle('collapsed'); }
    if (e.key === 'Escape' && state.streaming) endStream();
  });
}

init();

// Shared client-side helpers (loaded on every page).
const Session = {
  get() {
    try { return JSON.parse(localStorage.getItem('nebula_user') || 'null'); }
    catch { return null; }
  },
  set(user) { localStorage.setItem('nebula_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('nebula_user'); },
  requireAuth() {
    const u = this.get();
    if (!u) { location.href = 'login.html'; return null; }
    return u;
  }
};

// ---------- Theme (Feature: light/dark/system) ----------
const Theme = {
  apply(mode) {
    const m = mode || localStorage.getItem('nebula_theme') || 'dark';
    const resolved = m === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : m;
    document.documentElement.setAttribute('data-theme', resolved);
    localStorage.setItem('nebula_theme', m);
  },
  get() { return localStorage.getItem('nebula_theme') || 'dark'; }
};
Theme.apply();

function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
}

// Subtle background mesh (replaces the loud aurora).
function injectBackground() {
  if (document.querySelector('.bg-mesh')) return;
  const a = document.createElement('div');
  a.className = 'bg-mesh';
  a.innerHTML = '<span></span><span></span>';
  document.body.prepend(a);
}
document.addEventListener('DOMContentLoaded', injectBackground);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Languages we can render in a live preview iframe.
const PREVIEWABLE = new Set(['html', 'htm', 'xml', 'svg', 'css', 'js', 'javascript', 'jsx', 'react', 'tsx']);

// Lightweight inline-markdown for a single text segment (no code fences here).
function inlineMd(t) {
  t = escapeHtml(t);
  t = t.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}

// Block-level markdown: headings, lists, blockquotes, paragraphs.
function blockMd(text) {
  const lines = text.split('\n');
  let html = '', listOpen = false, listType = '';
  const closeList = () => { if (listOpen) { html += `</${listType}>`; listOpen = false; } };

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList(); const lvl = m[1].length;
      html += `<h${lvl} class="md-h">${inlineMd(m[2])}</h${lvl}>`;
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      if (!listOpen || listType !== 'ul') { closeList(); listType = 'ul'; listOpen = true; html += '<ul>'; }
      html += `<li>${inlineMd(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      if (!listOpen || listType !== 'ol') { closeList(); listType = 'ol'; listOpen = true; html += '<ol>'; }
      html += `<li>${inlineMd(m[1])}</li>`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList(); html += `<blockquote>${inlineMd(m[1])}</blockquote>`;
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList(); html += `<p>${inlineMd(line)}</p>`;
    }
  }
  closeList();
  return html;
}

// Full markdown -> HTML with code blocks + optional preview button.
function renderMarkdown(text) {
  const parts = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    parts.push({ type: 'code', lang: (m[1] || 'text').toLowerCase(), value: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });

  return parts.map(p => {
    if (p.type === 'code') {
      const code = p.value.replace(/\n$/, '');
      const escaped = escapeHtml(code);
      const canPreview = PREVIEWABLE.has(p.lang);
      const data = encodeURIComponent(code);
      const previewBtn = canPreview
        ? `<button class="code-btn preview" onclick="openPreview('${p.lang}', this)">▶ Preview</button>`
        : '';
      return `<div class="code-block" data-lang="${escapeHtml(p.lang)}" data-code="${data}">
        <div class="code-head">
          <span class="lang">${escapeHtml(p.lang)}</span>
          <div class="code-actions">${previewBtn}
            <button class="code-btn" onclick="copyCode(this)">Copy</button>
          </div>
        </div>
        <pre><code>${escaped}</code></pre></div>`;
    }
    return blockMd(p.value);
  }).join('');
}

function copyCode(btn) {
  const code = decodeURIComponent(btn.closest('.code-block').dataset.code);
  navigator.clipboard.writeText(code);
  const orig = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => (btn.textContent = orig), 1400);
}

// ---------- Live preview (Feature: HTML/CSS/JS/React/SVG preview canvas) ----------
// Wraps a code snippet into a runnable HTML document, then shows it in a
// sandboxed iframe inside a slide-in panel.
function buildPreviewDoc(lang, code) {
  if (lang === 'css') {
    return `<!doctype html><html><head><style>${code}</style></head>
      <body><h1>Heading</h1><p>Paragraph text with a <a href="#">link</a> and a
      <button>button</button>.</p><div class="box">.box</div></body></html>`;
  }
  if (lang === 'js' || lang === 'javascript') {
    return `<!doctype html><html><body><div id="app"></div>
      <script>try{${code}}catch(e){document.body.innerHTML='<pre style="color:red">'+e+'</pre>'}<\/script></body></html>`;
  }
  if (lang === 'jsx' || lang === 'react' || lang === 'tsx') {
    return `<!doctype html><html><head>
      <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"><\/script>
      <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"><\/script>
      <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script></head>
      <body><div id="root"></div>
      <script type="text/babel" data-presets="react">
        try {
          ${code}
          const el = typeof App !== 'undefined' ? React.createElement(App) : null;
          if (el) ReactDOM.createRoot(document.getElementById('root')).render(el);
        } catch(e){ document.body.innerHTML='<pre style="color:red">'+e+'</pre>'; }
      <\/script></body></html>`;
  }
  // html, htm, xml, svg -> render as-is
  return code;
}

function openPreview(lang, btn) {
  const code = decodeURIComponent(btn.closest('.code-block').dataset.code);
  const doc = buildPreviewDoc(lang, code);
  showPreviewPanel(doc, lang);
}

function showPreviewPanel(srcdoc, lang) {
  let panel = document.getElementById('previewPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'previewPanel';
    panel.className = 'preview-panel';
    panel.innerHTML = `
      <div class="preview-head">
        <span>Live preview · <b id="previewLang"></b></span>
        <div>
          <button class="code-btn" id="previewReload">Reload</button>
          <button class="code-btn" id="previewClose">Close</button>
        </div>
      </div>
      <iframe id="previewFrame" sandbox="allow-scripts allow-modals"></iframe>`;
    document.body.appendChild(panel);
    panel.querySelector('#previewClose').onclick = () => panel.classList.remove('open');
    panel.querySelector('#previewReload').onclick = () => {
      const f = panel.querySelector('#previewFrame');
      f.srcdoc = panel.dataset.doc;
    };
  }
  panel.dataset.doc = srcdoc;
  panel.querySelector('#previewLang').textContent = lang;
  panel.querySelector('#previewFrame').srcdoc = srcdoc;
  requestAnimationFrame(() => panel.classList.add('open'));
}

// ---------- Toast (Feature: non-blocking notifications) ----------
function toast(msg, type = 'info') {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

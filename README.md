# Nebula Code AI

A desktop AI chat app built with **Electron + Node.js**. Supports **OpenRouter** (streaming) and **local GGUF** models, with auth, chat history, rolling memory, a model changer, an Agent/Normal mode switch, a code canvas, and a ChatGPT-like animated UI.

## Features

**Core**
- **Auth** - register / login with hashed passwords (SQLite, bcrypt)
- **Multiple pages / HTMLs** - login, register, chat, settings, profile
- **Text streaming** - token-by-token from OpenRouter, plus local GGUF via `node-llama-cpp`
- **Chat history** - per-user, stored in SQLite, rename & delete
- **Memory** - keeps recent turns verbatim and folds older ones into a rolling summary so context stays small
- **Model changer** - scans the `models/` folder and lists every model
- **Mode changer** - pill inside the chatbox: **Normal** (works) and **Agent** (wired, behavior later)
- **Profile** - display name, email, avatar

**Redesigned UI + 25 features**
1. Clean modern design system (no neon)
2. Light / Dark / System themes (live toggle)
3. **Live preview canvas** for HTML, CSS, JS, React/JSX and SVG code blocks
4. Language-aware code blocks with copy
5. Streaming cursor animation
6. Markdown: headings, lists, blockquotes, links, bold/italic, inline code
7. Message **copy**
8. Message **edit & resend**
9. **Regenerate** last response
10. **Stop generation** (Esc / Stop button)
11. Sidebar **collapse** (Ctrl/Cmd+B)
12. **Chat search** (Ctrl/Cmd+K)
13. History **grouped by day** (Today / Yesterday / This week / Older)
14. Welcome **suggestion cards**
15. **Toast** notifications
16. **Export chat** as Markdown
17. Character counter
18. **Auto-scroll lock** (won't yank you down while reading)
19. Auto-growing composer
20. Keyboard shortcuts (Enter / Shift+Enter / Ctrl+Enter / Esc)
21. Per-chat mode persistence
22. Avatar in sidebar + messages
23. Reload button in preview panel
24. Sandboxed preview iframe (safe)
25. Subtle responsive background mesh

## Live preview

When the AI returns a fenced code block in `html`, `css`, `js`, `jsx`/`react`, or `svg`,
a **Preview** button appears on the block. Click it to run the code in a sandboxed
slide-in panel. React snippets are rendered with React 18 + Babel from a CDN; define a
component named `App` and it mounts automatically.

## Project structure

```
nebula-code-ai/
├── package.json
├── main.js                 # Electron main process
├── preload.js              # Secure contextBridge
├── src/
│   ├── db/database.js      # SQLite schema (users, chats, messages, memory, settings)
│   ├── services/
│   │   ├── auth.js
│   │   ├── modelLoader.js  # scans models/
│   │   ├── openrouter.js   # streaming completions
│   │   ├── localModel.js   # node-llama-cpp
│   │   └── memory.js       # rolling summary
│   └── ipc/handlers.js     # all IPC routes
├── renderer/
│   ├── login.html / register.html / chat.html / settings.html / profile.html
│   ├── css/styles.css
│   └── js/ (common, login, register, chat, settings, profile)
└── models/
    ├── example-model.json
    └── example-local-model.json
```

## Setup

```bash
# 1. Install dependencies
npm install

# (optional) local GGUF support
npm install node-llama-cpp

# 2. (optional) set a fallback OpenRouter key
cp .env.example .env   # then edit OPENROUTER_API_KEY

# 3. Run
npm start
```

## Adding models

Each model is **one JSON file** in `models/`. The **file name is the model's display name**.

**OpenRouter** (`models/GPT-4o mini.json`):

```json
{
  "Model type": "openrouter",
  "api": "sk-or-v1-your-key",
  "Model": "openai/gpt-4o-mini"
}
```

**Local GGUF** (`models/Llama 3 8B.json`) - put the matching `.gguf` in `models/` too:

```json
{
  "Model type": "local",
  "api": "none",
  "Model": "llama-3-8b-instruct.gguf"
}
```

The model changer in the chatbox lists everything automatically. If `api` is `none` for an OpenRouter model, the key from **Settings** (or `.env`) is used as a fallback.

## Modes

- **Normal** - standard ask/respond (fully working).
- **Agent** - selectable now; autonomous tool-using behavior is added later.

## Notes

- The SQLite database is stored in Electron's `userData` directory.
- Renderer uses a locked-down `contextBridge` (no direct Node access) for security.

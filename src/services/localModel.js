'use strict';

const fs = require('fs');

// node-llama-cpp is optional. If it's not installed we degrade gracefully.
let llama = null;
let loadError = null;
try {
  llama = require('node-llama-cpp');
} catch (e) {
  loadError = e.message;
}

const cache = new Map(); // ggufPath -> { model, context }

async function getSession(ggufPath) {
  if (!llama) {
    throw new Error('node-llama-cpp not installed. Run: npm install node-llama-cpp');
  }
  if (!fs.existsSync(ggufPath)) {
    throw new Error('GGUF file not found: ' + ggufPath);
  }
  if (cache.has(ggufPath)) return cache.get(ggufPath);

  const engine = await llama.getLlama();
  const model = await engine.loadModel({ modelPath: ggufPath });
  const entry = { engine, model };
  cache.set(ggufPath, entry);
  return entry;
}

// Streams a local GGUF completion via node-llama-cpp.
async function streamChat({ ggufPath, messages, temperature = 0.7, onToken }) {
  const { LlamaChatSession } = llama;
  const { model } = await getSession(ggufPath);
  const context = await model.createContext();
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });

  // Flatten history: feed prior turns, then prompt with the last user message.
  const history = messages.filter((m) => m.role !== 'system');
  const systemMsg = messages.find((m) => m.role === 'system');
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const prompt = lastUser ? lastUser.content : '';

  let full = '';
  await session.prompt((systemMsg ? systemMsg.content + '\n\n' : '') + prompt, {
    temperature,
    onTextChunk: (text) => {
      full += text;
      if (onToken) onToken(text);
    }
  });

  await context.dispose();
  return full;
}

module.exports = { streamChat, available: () => !!llama, loadError: () => loadError };

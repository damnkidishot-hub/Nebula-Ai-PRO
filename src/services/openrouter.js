'use strict';

const fetch = require('node-fetch');

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

// Streams an OpenRouter chat completion.
// onToken(text) is called for each delta; resolves with the full text.
async function streamChat({ apiKey, model, messages, temperature = 0.7, onToken, signal }) {
  if (!apiKey) throw new Error('Missing OpenRouter API key for this model.');

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://gitlab.com/damnkidishot-group/nebula-code-ai',
      'X-Title': 'Nebula Code AI'
    },
    body: JSON.stringify({ model, messages, temperature, stream: true }),
    signal
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter error ${res.status}: ${errText}`);
  }

  let full = '';
  let buffer = '';

  // node-fetch v2 body is a Node stream.
  for await (const chunk of res.body) {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          if (onToken) onToken(delta);
        }
      } catch (_) { /* ignore keep-alive / partial */ }
    }
  }
  return full;
}

module.exports = { streamChat };

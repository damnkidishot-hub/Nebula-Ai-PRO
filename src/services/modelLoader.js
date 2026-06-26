'use strict';

const fs = require('fs');
const path = require('path');

// models/ lives at the project root next to main.js
function modelsDir() {
  return path.join(__dirname, '..', '..', 'models');
}

// Scans the models/ folder for *.json definitions.
// File name (without .json) is the model display name.
function listModels() {
  const dir = modelsDir();
  if (!fs.existsSync(dir)) return { ok: true, models: [] };

  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
  const models = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const json = JSON.parse(raw);
      const name = path.basename(file, '.json');
      const type = (json['Model type'] || json.modelType || 'openrouter').toLowerCase();
      const model = {
        name,
        type: type === 'local' ? 'local' : 'openrouter',
        api: json.api && json.api !== 'none' ? json.api : null,
        model: json.Model || json.model || ''
      };
      if (model.type === 'local') {
        model.ggufPath = path.join(dir, model.model);
        model.exists = fs.existsSync(model.ggufPath);
      } else {
        model.exists = true;
      }
      models.push(model);
    } catch (e) {
      // Skip malformed JSON but keep scanning the rest.
      models.push({ name: path.basename(file, '.json'), type: 'invalid', error: e.message });
    }
  }

  return { ok: true, models };
}

function getModel(name) {
  const { models } = listModels();
  return models.find((m) => m.name === name) || null;
}

module.exports = { listModels, getModel, modelsDir };

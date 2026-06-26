const $ = (id) => document.getElementById(id);
const user = Session.requireAuth();
let themeChoice = Theme.get();

async function init() {
  const [modelsRes, settingsRes] = await Promise.all([
    window.nebula.listModels(),
    window.nebula.getSettings(user.id)
  ]);

  const models = modelsRes.models || [];
  $('defaultModel').innerHTML = '<option value="">(first available)</option>' +
    models.filter(m => m.type !== 'invalid')
      .map(m => `<option value="${m.name}">${m.name} (${m.type})</option>`).join('');

  const s = settingsRes.settings || {};
  if (s.default_model) $('defaultModel').value = s.default_model;
  $('openrouterKey').value = s.openrouter_key || '';
  $('temperature').value = s.temperature ?? 0.7;
  $('tempVal').textContent = s.temperature ?? 0.7;

  paintThemeSeg();
}

function paintThemeSeg() {
  $('themeSeg').querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === themeChoice));
}

$('themeSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  themeChoice = b.dataset.theme;
  Theme.apply(themeChoice); // live preview
  paintThemeSeg();
}));

$('temperature').addEventListener('input', (e) => $('tempVal').textContent = e.target.value);

$('saveBtn').addEventListener('click', async () => {
  await window.nebula.saveSettings({
    userId: user.id,
    theme: themeChoice,
    defaultModel: $('defaultModel').value || null,
    openrouterKey: $('openrouterKey').value.trim() || null,
    temperature: parseFloat($('temperature').value)
  });
  Theme.apply(themeChoice);
  $('status').textContent = 'Saved ✓';
  setTimeout(() => $('status').textContent = '', 1800);
});

init();

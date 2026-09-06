const defaults = {
  canPosition: 'bottom-right',
  theme: 'auto',
  pollIntervalMinutes: 5,
  badgeEnabled: true,
  badgeMode: 'lowest',
  soundEnabled: true,
  hideCan: false,
  estimateMessagesEnabled: false,
  enableGrok: true,
  enableClaude: true,
  enableChatgpt: true,
  enableGemini: true,
  alertThresholds: [70, 90, 100],
  onboardingComplete: true
};

function parseThresholds(str) {
  return String(str || '')
    .split(/[, ]+/)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n) && n > 0 && n <= 100)
    .sort((a, b) => a - b);
}

async function load() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  const s = { ...defaults, ...(res || {}) };
  document.getElementById('position').value = s.canPosition;
  document.getElementById('theme').value = s.theme;
  document.getElementById('poll').value = s.pollIntervalMinutes;
  document.getElementById('thresholds').value = (s.alertThresholds || [70, 90, 100]).join(', ');
  document.getElementById('badgeMode').value = s.badgeMode || 'lowest';
  document.getElementById('badge').checked = s.badgeEnabled !== false;
  document.getElementById('sound').checked = s.soundEnabled !== false;
  document.getElementById('hideCan').checked = !!s.hideCan;
  const em = document.getElementById('estimateMessages');
  if (em) em.checked = !!s.estimateMessagesEnabled;
  document.getElementById('enableGrok').checked = s.enableGrok !== false;
  document.getElementById('enableClaude').checked = s.enableClaude !== false;
  document.getElementById('enableChatgpt').checked = s.enableChatgpt !== false;
  document.getElementById('enableGemini').checked = s.enableGemini !== false;
}

document.getElementById('save').addEventListener('click', async () => {
  const payload = {
    canPosition: document.getElementById('position').value,
    theme: document.getElementById('theme').value,
    pollIntervalMinutes: parseInt(document.getElementById('poll').value, 10) || 5,
    alertThresholds: parseThresholds(document.getElementById('thresholds').value) || [70, 90, 100],
    badgeMode: document.getElementById('badgeMode').value,
    badgeEnabled: document.getElementById('badge').checked,
    soundEnabled: document.getElementById('sound').checked,
    hideCan: document.getElementById('hideCan').checked,
    estimateMessagesEnabled: document.getElementById('estimateMessages')?.checked === true,
    enableGrok: document.getElementById('enableGrok').checked,
    enableClaude: document.getElementById('enableClaude').checked,
    enableChatgpt: document.getElementById('enableChatgpt').checked,
    enableGemini: document.getElementById('enableGemini').checked,
    onboardingComplete: true
  };
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload });
  const el = document.getElementById('saved');
  el.style.opacity = '1';
  setTimeout(() => el.style.opacity = '0', 1500);
});

document.getElementById('export').addEventListener('click', async () => {
  const usage = await chrome.runtime.sendMessage({ type: 'GET_USAGE' });
  const history = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  const blob = new Blob([JSON.stringify({ usage, history, exportedAt: new Date().toISOString() }, null, 2)], {
    type: 'application/json'
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zero-grok-usage-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('clearHistory').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  const el = document.getElementById('saved');
  el.textContent = 'History cleared';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; el.textContent = 'Saved ✓'; }, 1500);
});

document.getElementById('reopen-onboarding').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'OPEN_ONBOARDING' });
});

load();

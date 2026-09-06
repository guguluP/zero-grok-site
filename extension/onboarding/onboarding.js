const DEFAULTS = {
  canPosition: 'bottom-right',
  theme: 'auto',
  badgeEnabled: true,
  soundEnabled: true,
  enableGrok: true,
  enableClaude: true,
  enableChatgpt: true,
  enableGemini: true,
  alertThresholds: [70, 90, 100],
  pollIntervalMinutes: 5,
  hideCan: false,
  onboardingComplete: false
};

async function load() {
  const stored = await chrome.storage.local.get('zeroGrokSettings');
  const s = { ...DEFAULTS, ...(stored.zeroGrokSettings || {}) };
  document.getElementById('position').value = s.canPosition;
  document.getElementById('theme').value = s.theme;
  document.getElementById('badge').checked = s.badgeEnabled !== false;
  document.getElementById('sound').checked = s.soundEnabled !== false;
  document.getElementById('enableGrok').checked = s.enableGrok !== false;
  document.getElementById('enableClaude').checked = s.enableClaude !== false;
  document.getElementById('enableChatgpt').checked = s.enableChatgpt !== false;
  const eg = document.getElementById('enableGemini');
  if (eg) eg.checked = s.enableGemini !== false;
}

document.getElementById('save').addEventListener('click', async () => {
  const payload = {
    canPosition: document.getElementById('position').value,
    theme: document.getElementById('theme').value,
    badgeEnabled: document.getElementById('badge').checked,
    soundEnabled: document.getElementById('sound').checked,
    enableGrok: document.getElementById('enableGrok').checked,
    enableClaude: document.getElementById('enableClaude').checked,
    enableChatgpt: document.getElementById('enableChatgpt').checked,
    enableGemini: document.getElementById('enableGemini')?.checked !== false,
    alertThresholds: [70, 90, 100],
    pollIntervalMinutes: 5,
    hideCan: false,
    onboardingComplete: true
  };
  await chrome.storage.local.set({ zeroGrokSettings: payload });
  if (payload.soundEnabled) {
    try { localStorage.removeItem('zeroGrokPopPlayed'); } catch (_) {}
  }
  window.close();
  try {
    chrome.tabs.getCurrent(tab => {
      if (tab?.id) chrome.tabs.remove(tab.id);
    });
  } catch (_) {}
});

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

load();

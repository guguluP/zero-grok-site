import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

export async function getUsage() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USAGE);
  const raw = result[STORAGE_KEYS.USAGE];
  if (!raw) return { byProvider: {}, lastProvider: null, updatedAt: null };

  if (raw.byProvider && typeof raw.byProvider === 'object') {
    return {
      byProvider: raw.byProvider,
      lastProvider: raw.lastProvider || null,
      updatedAt: raw.updatedAt || null
    };
  }

  const provider = raw.provider || 'grok';
  return {
    byProvider: { [provider]: { ...raw } },
    lastProvider: provider,
    updatedAt: raw.updatedAt || null
  };
}

export async function saveUsage(data) {
  if (!data) return;
  const provider = data.provider || 'grok';
  const current = await getUsage();
  const byProvider = { ...(current.byProvider || {}) };
  byProvider[provider] = {
    ...data,
    provider,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({
    [STORAGE_KEYS.USAGE]: {
      byProvider,
      lastProvider: provider,
      updatedAt: Date.now()
    }
  });
  await appendHistory(provider, byProvider[provider]);
}

export async function appendHistory(provider, snapshot) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  const hist = Array.isArray(result[STORAGE_KEYS.HISTORY]) ? result[STORAGE_KEYS.HISTORY] : [];
  hist.push({
    provider,
    remainingPercent: snapshot.remainingPercent,
    usedPercent: snapshot.usedPercent,
    windowHint: snapshot.windowHint,
    at: Date.now()
  });
  // keep last 500 samples
  const trimmed = hist.slice(-500);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: trimmed });
}

export async function getHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  return result[STORAGE_KEYS.HISTORY] || [];
}

export async function clearHistory() {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
}

export async function getLastAlert() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_ALERT);
  return result[STORAGE_KEYS.LAST_ALERT] || {};
}

export async function setLastAlert(key) {
  const current = await getLastAlert();
  current[key] = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_ALERT]: current });
}

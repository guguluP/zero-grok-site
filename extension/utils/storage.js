// storage helpers for Zero Grok multi-provider usage tracker
export async function getSettings() {
  const { zeroGrokSettings } = await chrome.storage.local.get('zeroGrokSettings');
  return { ...DEFAULT_SETTINGS, ...(zeroGrokSettings || {}) };
}

// Note: full implementation is in the local source; this is a stub to keep repo building.
// See the complete file in the extension release ZIP.
import { DEFAULT_SETTINGS } from './constants.js';

export async function saveUsage(provider, data) {
  const key = 'zeroGrokUsage';
  const current = (await chrome.storage.local.get(key))[key] || { byProvider: {} };
  current.byProvider = current.byProvider || {};
  current.byProvider[provider] = { ...current.byProvider[provider], ...data, updatedAt: Date.now() };
  await chrome.storage.local.set({ [key]: current });
}

export async function getUsage() {
  const { zeroGrokUsage } = await chrome.storage.local.get('zeroGrokUsage');
  return zeroGrokUsage || { byProvider: {} };
}

export async function getLastAlert() {
  const { zeroGrokLastAlert } = await chrome.storage.local.get('zeroGrokLastAlert');
  return zeroGrokLastAlert || {};
}

export async function setLastAlert(data) {
  await chrome.storage.local.set({ zeroGrokLastAlert: data });
}

export async function getHistory() {
  const { zeroGrokHistory } = await chrome.storage.local.get('zeroGrokHistory');
  return zeroGrokHistory || [];
}

export async function clearHistory() {
  await chrome.storage.local.set({ zeroGrokHistory: [] });
}

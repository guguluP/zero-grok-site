import { STORAGE_KEYS, ALARM_NAMES, ALL_AI_TAB_URLS } from './utils/constants.js';
import { getSettings, getUsage, saveUsage, getLastAlert, setLastAlert } from './utils/storage.js';

const CLAUDE_USAGE_URL = 'https://claude.ai/api/organizations';

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
  await ensureAlarms();
  await refreshAllProviders();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
});

async function ensureAlarms() {
  const settings = await getSettings();
  const mins = Math.max(2, settings.pollIntervalMinutes || 5);
  await chrome.alarms.clear(ALARM_NAMES.POLL);
  chrome.alarms.create(ALARM_NAMES.POLL, { periodInMinutes: mins });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.POLL) {
    await refreshAllProviders();
  } else if (alarm.name === ALARM_NAMES.RESET) {
    await chrome.action.setBadgeText({ text: '' });
    await refreshAllProviders();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'REFRESH_ALL') {
      await refreshAllProviders();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'USAGE_UPDATE' && msg.data) {
      await saveUsage(msg.data);
      await updateBadge();
      await maybeNotify(msg.data);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'GET_USAGE') {
      const usage = await getUsage();
      sendResponse({ ok: true, usage });
      return;
    }
    sendResponse({ ok: false });
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-can') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CAN' }).catch(() => {});
    }
  }
});

async function refreshAllProviders() {
  try {
    await pollClaude();
  } catch (e) {
    console.warn('Claude poll failed', e);
  }
  await updateBadge();
}

async function pollClaude() {
  const settings = await getSettings();
  if (!settings.enableClaude) return;

  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  if (!tabs.length) return;

  // Prefer background fetch via content script messaging when available;
  // service worker may hit CORS / auth. Ask active Claude tab to scrape.
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'CLAUDE_POLL' });
      if (res?.ok && res.data) {
        await saveUsage(res.data);
        await maybeNotify(res.data);
        return;
      }
    } catch (_) {}
  }
}

async function updateBadge() {
  const settings = await getSettings();
  if (!settings.badgeEnabled) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const usage = await getUsage();
  const by = usage.byProvider || {};
  const percents = Object.values(by)
    .map((p) => (typeof p.remainingPercent === 'number' ? p.remainingPercent : null))
    .filter((n) => n != null);
  if (!percents.length) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  let value;
  if (settings.badgeMode === 'last' && usage.lastProvider && by[usage.lastProvider]) {
    value = by[usage.lastProvider].remainingPercent;
  } else {
    value = Math.min(...percents);
  }
  const text = value <= 0 ? '0' : String(Math.round(value));
  await chrome.action.setBadgeText({ text });
  const color = value <= 15 ? '#e31837' : value <= 40 ? '#d97706' : '#10a37f';
  await chrome.action.setBadgeBackgroundColor({ color });

  // schedule refill badge clear if we know resetAt
  const nextReset = Object.values(by)
    .map((p) => p.resetAt)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0];
  if (nextReset) {
    await chrome.alarms.clear(ALARM_NAMES.RESET);
    chrome.alarms.create(ALARM_NAMES.RESET, { when: nextReset + 2000 });
  }
}

async function maybeNotify(data) {
  if (!data || typeof data.remainingPercent !== 'number') return;
  const settings = await getSettings();
  const thresholds = settings.alertThresholds || [70, 90, 100];
  const usedPercent = 100 - data.remainingPercent;
  const last = await getLastAlert();
  const provider = data.provider || 'ai';
  for (const t of thresholds) {
    if (usedPercent >= t) {
      const key = `${provider}:${t}`;
      const prev = last[key] || 0;
      if (Date.now() - prev < 6 * 60 * 60 * 1000) continue;
      const label = provider.charAt(0).toUpperCase() + provider.slice(1);
      chrome.notifications.create(`zg-${key}-${Date.now()}`, {
        type: 'basic',
        iconUrl: 'assets/icons/icon128.png',
        title: `Zero Grok · ${label}`,
        message: `You've used about ${Math.round(usedPercent)}% of your ${label} allowance.`
      });
      await setLastAlert(key);
    }
  }
}

import { STORAGE_KEYS, ALARM_NAMES, ALL_AI_TAB_URLS } from './utils/constants.js';
import { getSettings, saveUsage, getUsage, getLastAlert, setLastAlert, getHistory, clearHistory } from './utils/storage.js';

/** Allow gemini.google.com/usage in a hidden iframe (SPA scrape fallback). */
function registerGeminiFrameRules() {
  try {
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [9001],
      addRules: [{
        id: 9001,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' }
          ]
        },
        condition: {
          urlFilter: 'gemini.google.com/usage',
          resourceTypes: ['sub_frame']
        }
      }]
    });
  } catch (e) {
    console.warn('[Zero Grok] DNR rules failed', e?.message || e);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const settings = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  registerGeminiFrameRules();

  if (details.reason === 'install') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('onboarding/onboarding.html')
    });
  } else if (details.reason === 'update') {
    if (!settings.onboardingComplete) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('onboarding/onboarding.html')
      });
    }
  }

  schedulePolling(settings.pollIntervalMinutes || 5);
});

chrome.runtime.onStartup.addListener(async () => {
  registerGeminiFrameRules();
  const settings = await getSettings();
  schedulePolling(settings.pollIntervalMinutes || 5);
  await refreshBadgeFromStorage(settings);
});

registerGeminiFrameRules();

function schedulePolling(minutes = 5) {
  chrome.alarms.clear(ALARM_NAMES.POLL);
  chrome.alarms.create(ALARM_NAMES.POLL, {
    periodInMinutes: Math.max(1, minutes)
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.POLL) {
    const settings = await getSettings();

    let claudePolled = false;
    if (settings.enableClaude !== false) {
      try {
        await pollClaudeUsage();
        claudePolled = true;
      } catch (e) {
        console.warn('[Zero Grok] Claude background poll failed', e?.message || e);
      }
    }

    const tabs = await chrome.tabs.query({ url: ALL_AI_TAB_URLS });
    for (const tab of tabs) {
      // Avoid double work: background pollClaudeUsage already pushes USAGE_PUSH to Claude tabs
      if (claudePolled && tab.url && tab.url.includes('claude.ai')) continue;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_USAGE' });
      } catch (_) {}
    }
  } else if (alarm.name === ALARM_NAMES.RESET || alarm.name.startsWith('zeroGrokReset:')) {
    const provider = alarm.name.startsWith('zeroGrokReset:')
      ? alarm.name.slice('zeroGrokReset:'.length)
      : null;
    const label = provider
      ? (provider.charAt(0).toUpperCase() + provider.slice(1))
      : 'Usage';
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icons/icon128.png',
      title: 'Zero Grok – Refill!',
      message: `${label} window refilled. The can is ready again 🥤`
    });
    try {
      const tabs = await chrome.tabs.query({ url: ALL_AI_TAB_URLS });
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_USAGE' });
          await chrome.tabs.sendMessage(tab.id, { type: 'REFILL_POP', provider });
        } catch (_) {}
      }
    } catch (_) {}
  }
});

async function claudeFetch(url) {
  return fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  });
}

async function resolveClaudeOrgId() {
  const res = await claudeFetch('https://claude.ai/api/organizations');
  if (!res.ok) {
    console.warn('[Zero Grok] orgs', res.status);
    return null;
  }
  const orgs = await res.json();
  if (!Array.isArray(orgs) || !orgs.length) return null;

  const chat = orgs.find(o =>
    Array.isArray(o.capabilities) &&
    (o.capabilities.includes('chat') || o.capabilities.includes('claude_chat'))
  );
  if (chat?.uuid) return chat.uuid;

  const max = orgs.find(o =>
    Array.isArray(o.capabilities) && o.capabilities.includes('claude_max')
  );
  if (max?.uuid) return max.uuid;

  const named = orgs.find(o => o.name && !/api|console/i.test(o.name || ''));
  return named?.uuid || orgs[0]?.uuid || null;
}

function normalizeClaudeUsage(data) {
  if (!data) return null;
  const buckets = [];
  for (const key of Object.keys(data)) {
    const b = data[key];
    if (!b || typeof b !== 'object') continue;
    if (b.utilization == null && b.used_percent == null) continue;
    let util = parseFloat(b.utilization ?? b.used_percent);
    if (!Number.isFinite(util)) continue;
    util = Math.max(0, Math.min(100, util));
    buckets.push({
      key,
      used: util,
      remaining: Math.max(0, 100 - util),
      resetsAt: b.resets_at || b.reset_at || null
    });
  }
  if (!buckets.length) return null;
  buckets.sort((a, b) => b.used - a.used);
  const top = buckets[0];
  const hint =
    /five_hour|5.?h/i.test(top.key) ? '5-hour session' :
    /seven_day|7.?d|week/i.test(top.key) ? 'Weekly' :
    top.key;
  return {
    provider: 'claude',
    usedPercent: top.used,
    remainingPercent: top.remaining,
    windowHint: hint,
    resetAt: top.resetsAt,
    resetHint: top.resetsAt ? new Date(top.resetsAt).toLocaleString() : '',
    source: 'api-background'
  };
}

async function pollClaudeUsage() {
  const orgId = await resolveClaudeOrgId();
  if (!orgId) return;

  let res = await claudeFetch(`https://claude.ai/api/organizations/${orgId}/usage`);
  if (!res.ok && res.status === 403) {
    const alt = await resolveClaudeOrgId();
    if (alt && alt !== orgId) {
      res = await claudeFetch(`https://claude.ai/api/organizations/${alt}/usage`);
    }
  }
  if (!res.ok) {
    console.warn('[Zero Grok] Claude usage', res.status);
    return;
  }
  const json = await res.json();
  const data = normalizeClaudeUsage(json);
  if (!data) return;

  await handleUsageData(data);

  try {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.tabs.sendMessage(tab.id, { type: 'USAGE_PUSH', payload: data }, () => {
        void chrome.runtime.lastError;
      });
    }
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'USAGE_DATA') {
    handleUsageData(message.payload).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'GET_USAGE') {
    getUsage().then(data => sendResponse(data));
    return true;
  }
  if (message.type === 'GET_SETTINGS') {
    getSettings().then(s => sendResponse(s));
    return true;
  }
  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: message.payload }).then(() => {
      schedulePolling(message.payload.pollIntervalMinutes || 5);
      refreshBadgeFromStorage(message.payload);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === 'OPEN_ONBOARDING') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'REFRESH_ALL') {
    refreshAllTabs().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'GET_HISTORY') {
    getHistory().then(h => sendResponse(h));
    return true;
  }
  if (message.type === 'CLEAR_HISTORY') {
    clearHistory().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.commands?.onCommand?.addListener((command) => {
  if (command !== 'toggle-can') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CAN' }, () => void chrome.runtime.lastError);
    }
  });
});

async function refreshAllTabs() {
  const settings = await getSettings();
  let claudePolled = false;
  if (settings.enableClaude !== false) {
    try {
      await pollClaudeUsage();
      claudePolled = true;
    } catch (_) {}
  }
  const tabs = await chrome.tabs.query({ url: ALL_AI_TAB_URLS });
  for (const tab of tabs) {
    if (claudePolled && tab.url && tab.url.includes('claude.ai')) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_USAGE' });
    } catch (_) {}
  }
}

async function handleUsageData(data) {
  if (!data) return;
  if (!data.provider) data.provider = 'grok';
  await saveUsage(data);

  const settings = await getSettings();
  await refreshBadgeFromStorage(settings);

  const used = data.usedPercent ?? (data.remainingPercent != null ? 100 - data.remainingPercent : null);
  if (used != null) await checkAlerts(used, data.provider, settings);

  if (data.resetAt) {
    const when = new Date(data.resetAt).getTime();
    if (when > Date.now()) {
      const name = ALARM_NAMES.resetFor(data.provider);
      chrome.alarms.create(name, { when });
    }
  }
}

async function refreshBadgeFromStorage(settings) {
  if (!settings) settings = await getSettings();
  if (settings.badgeEnabled === false) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const usage = await getUsage();
  const by = usage.byProvider || {};
  const enabled = [];
  if (settings.enableGrok !== false && by.grok) enabled.push(by.grok);
  if (settings.enableClaude !== false && by.claude) enabled.push(by.claude);
  if (settings.enableChatgpt !== false && by.chatgpt) enabled.push(by.chatgpt);
  if (settings.enableGemini !== false && by.gemini) enabled.push(by.gemini);

  let best = null;
  if ((settings.badgeMode || 'lowest') === 'last' && usage.lastProvider && by[usage.lastProvider]) {
    const lp = usage.lastProvider;
    const enabledLast =
      (lp === 'grok' && settings.enableGrok !== false) ||
      (lp === 'claude' && settings.enableClaude !== false) ||
      (lp === 'chatgpt' && settings.enableChatgpt !== false) ||
      (lp === 'gemini' && settings.enableGemini !== false);
    if (enabledLast) {
      const d = by[lp];
      let rem = d.remainingPercent;
      if (rem == null && typeof d.usedPercent === 'number') rem = 100 - d.usedPercent;
      if (rem != null && Number.isFinite(rem)) best = rem;
    }
  }
  if (best == null) {
    for (const d of enabled) {
      let rem = d.remainingPercent;
      if (rem == null && typeof d.usedPercent === 'number') rem = 100 - d.usedPercent;
      if (rem == null || !Number.isFinite(rem)) continue;
      if (best == null || rem < best) best = rem;
    }
  }

  if (best == null) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const text = best <= 5 ? 'LOW' : `${Math.round(best)}%`;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({
    color: best <= 10 ? '#e74c3c' : best <= 30 ? '#f39c12' : '#27ae60'
  });
}

async function checkAlerts(usedPercent, provider, settings) {
  if (typeof usedPercent !== 'number') return;
  const last = await getLastAlert();
  const thresholds = settings.alertThresholds || [70, 90, 100];
  for (const level of thresholds) {
    const key = `${provider || 'any'}:${level}`;
    if (usedPercent >= level && (!last[key] || Date.now() - last[key] > 6 * 60 * 60 * 1000)) {
      const label = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'AI';
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icons/icon128.png',
        title: `Zero Grok – ${label} ${level}% used`,
        message: level >= 100
          ? `${label} usage window exhausted.`
          : `You've used ${Math.round(usedPercent)}% of your ${label} allowance.`
      });
      await setLastAlert(key);
    }
  }
}

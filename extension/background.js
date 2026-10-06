import {
  STORAGE_KEYS, ALARM_NAMES, ALL_AI_TAB_URLS, PROVIDERS, PROVIDER_BY_ID, SELECTORS_URL, optionalScriptFor
} from './utils/constants.js';
import {
  getSettings, mergeSettings, migrateSettings, saveUsage, getUsage, getLastAlert, setLastAlert,
  getHistory, clearHistory, getHealth, setHealth, bumpEstimate, getEstimate
} from './utils/storage.js';
import { checkForUpdate, getStoredUpdate, dismissUpdate, openUpdateDownload } from './utils/updater.js';

const S = globalThis.ZeroGrokShared;
const t = S.t;

// ---------------------------------------------------------------- lifecycle

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings } = await migrateSettings();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  } else if (details.reason === 'update' && !settings.onboardingComplete) {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') });
  }
  await setupAll(settings);
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAll(await getSettings());
});

async function setupAll(settings) {
  schedulePolling(settings.pollIntervalMinutes);
  await scheduleUpdateCheck(settings);
  chrome.alarms.create(ALARM_NAMES.SELECTORS, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
  await syncOptionalProviders(settings);
  await refreshBadgeFromStorage(settings);
}

function schedulePolling(minutes = 5) {
  chrome.alarms.create(ALARM_NAMES.POLL, { periodInMinutes: Math.max(1, minutes) });
}

async function scheduleUpdateCheck(settings, force = false) {
  if (settings.autoCheckUpdates) {
    const existing = await chrome.alarms.get(ALARM_NAMES.UPDATE);
    if (existing && !force) return;
    chrome.alarms.create(ALARM_NAMES.UPDATE, { delayInMinutes: 1, periodInMinutes: 6 * 60 });
  } else {
    chrome.alarms.clear(ALARM_NAMES.UPDATE);
  }
}

// ---------------------------------------------------------------- optional providers

/** Register content scripts for optional providers the user enabled AND granted. */
async function syncOptionalProviders(settings) {
  if (!chrome.scripting?.registerContentScripts) return;
  settings = settings || (await getSettings());
  let registered = [];
  try {
    registered = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
  } catch (_) {}
  for (const p of PROVIDERS.filter((x) => x.optional)) {
    const scripts = optionalScriptFor(p.id);
    const ids = scripts.map((s) => s.id);
    let granted = false;
    try {
      granted = await chrome.permissions.contains({ origins: p.hosts });
    } catch (_) {}
    const want = granted && settings[p.settingKey] === true;
    const have = ids.filter((id) => registered.includes(id));
    if (want && have.length !== ids.length) {
      try {
        if (have.length) await chrome.scripting.unregisterContentScripts({ ids: have });
        await chrome.scripting.registerContentScripts(scripts.map((s) => ({ ...s, persistAcrossSessions: true })));
      } catch (e) {
        // Older Firefox without world:MAIN support: register the isolated bundle only.
        try {
          await chrome.scripting.registerContentScripts([{ ...scripts[1], persistAcrossSessions: true }]);
        } catch (e2) {
          console.warn('[Zero Grok] register scripts failed', p.id, e2?.message || e2);
        }
      }
    } else if (!want && have.length) {
      try { await chrome.scripting.unregisterContentScripts({ ids: have }); } catch (_) {}
    }
  }
}

chrome.permissions?.onAdded?.addListener(() => { syncOptionalProviders(); });
chrome.permissions?.onRemoved?.addListener(() => { syncOptionalProviders(); });

async function aiTabUrls() {
  const urls = [...ALL_AI_TAB_URLS];
  for (const p of PROVIDERS.filter((x) => x.optional)) {
    try {
      if (await chrome.permissions.contains({ origins: p.hosts })) urls.push(...p.hosts);
    } catch (_) {}
  }
  return urls;
}

async function queryAiTabs() {
  try {
    return await chrome.tabs.query({ url: await aiTabUrls() });
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------- alarms

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.POLL) {
    await refreshAllTabs();
  } else if (alarm.name === ALARM_NAMES.UPDATE) {
    const settings = await getSettings();
    if (settings.autoCheckUpdates) await checkForUpdate({ notify: !S.inQuietHours(settings) });
  } else if (alarm.name === ALARM_NAMES.SELECTORS) {
    await refreshSelectors();
  } else if (alarm.name === ALARM_NAMES.RESET || alarm.name.startsWith('zeroGrokReset:')) {
    const provider = alarm.name.startsWith('zeroGrokReset:') ? alarm.name.slice('zeroGrokReset:'.length) : null;
    await onLimitReset(provider);
  }
});

async function onLimitReset(provider) {
  const settings = await getSettings();
  const meta = PROVIDER_BY_ID[provider];
  if (provider && meta && settings[meta.settingKey] === false) return;
  const label = meta ? meta.label : 'AI';
  if (settings.notifyOnReset !== false && !S.inQuietHours(settings)) {
    chrome.notifications.create('zero-grok-reset-' + (provider || 'any'), {
      type: 'basic',
      iconUrl: 'assets/icons/icon128.png',
      title: t('notifResetTitle', null, 'Zero Grok – Refill!'),
      message: t('notifResetBody', [label], '$1 limit has reset. The can is full again.')
    });
  }
  for (const tab of await queryAiTabs()) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_USAGE' });
      await chrome.tabs.sendMessage(tab.id, { type: 'REFILL_POP', provider });
    } catch (_) {}
  }
}

chrome.notifications?.onClicked?.addListener(async (id) => {
  if (id === 'zero-grok-update') {
    const info = await getStoredUpdate();
    openUpdateDownload(info?.zipUrl);
  }
});

// ---------------------------------------------------------------- selectors (data-only remote file)

async function bundledSelectors() {
  try {
    const res = await fetch(chrome.runtime.getURL('selectors.json'));
    return S.validateSelectors(await res.json());
  } catch (_) {
    return null;
  }
}

async function refreshSelectors() {
  const settings = await getSettings();
  if (!settings.remoteSelectors) return null;
  try {
    const res = await fetch(SELECTORS_URL, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (text.length > 64 * 1024) throw new Error('too large');
    const clean = S.validateSelectors(JSON.parse(text));
    if (!clean) throw new Error('invalid schema');
    await chrome.storage.local.set({ [STORAGE_KEYS.SELECTORS]: { data: clean, fetchedAt: Date.now() } });
    return clean;
  } catch (e) {
    console.warn('[Zero Grok] remote selectors unavailable, using bundled copy', e?.message || e);
    return null;
  }
}

async function getSelectors() {
  const local = await bundledSelectors();
  const settings = await getSettings();
  if (!settings.remoteSelectors) return local;
  const stored = (await chrome.storage.local.get(STORAGE_KEYS.SELECTORS))[STORAGE_KEYS.SELECTORS];
  const remote = stored && stored.data;
  if (!remote || !local || remote.version < local.version) return local;
  const merged = { ...local, version: remote.version, providers: { ...local.providers } };
  for (const [id, p] of Object.entries(remote.providers || {})) {
    merged.providers[id] = { ...(local.providers[id] || {}) };
    for (const [k, v] of Object.entries(p)) {
      if (Array.isArray(v) ? v.length : v && Object.keys(v).length) merged.providers[id][k] = v;
    }
  }
  return merged;
}

// ---------------------------------------------------------------- Claude background poll

async function claudeFetch(url) {
  return fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
}

async function resolveClaudeOrgId() {
  const res = await claudeFetch('https://claude.ai/api/organizations');
  if (!res.ok) return null;
  const orgs = await res.json();
  if (!Array.isArray(orgs) || !orgs.length) return null;
  const chat = orgs.find((o) => Array.isArray(o.capabilities) && (o.capabilities.includes('chat') || o.capabilities.includes('claude_chat')));
  if (chat?.uuid) return chat.uuid;
  const max = orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes('claude_max'));
  if (max?.uuid) return max.uuid;
  const named = orgs.find((o) => o.name && !/api|console/i.test(o.name || ''));
  return named?.uuid || orgs[0]?.uuid || null;
}

const CLAUDE_BUCKET_LABELS = {
  five_hour: '5-hour session', seven_day: 'Weekly', seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet', seven_day_oauth_apps: 'Weekly · apps'
};

export function normalizeClaudeUsage(data) {
  if (!data || typeof data !== 'object') return null;
  const buckets = [];
  for (const key of Object.keys(data)) {
    const b = data[key];
    if (!b || typeof b !== 'object') continue;
    const raw = b.utilization ?? b.used_percent;
    if (raw == null) continue;
    let util = parseFloat(raw);
    if (!Number.isFinite(util)) continue;
    util = S.clampPct(util);
    buckets.push({ key, used: util, remaining: 100 - util, resetAt: S.toResetMs(b.resets_at || b.reset_at) });
  }
  if (!buckets.length) return null;
  buckets.sort((a, b) => b.used - a.used);
  const top = buckets[0];
  const weekly = buckets.find((b) => b.key === 'seven_day');
  return {
    provider: 'claude',
    usedPercent: top.used,
    remainingPercent: top.remaining,
    windowHint: CLAUDE_BUCKET_LABELS[top.key] || top.key,
    resetAt: top.resetAt,
    weeklyRemaining: weekly ? weekly.remaining : null,
    breakdown: buckets.map((b) => ({ label: CLAUDE_BUCKET_LABELS[b.key] || b.key, remainingPercent: b.remaining, resetAt: b.resetAt })),
    source: 'api-background'
  };
}

async function pollClaudeUsage() {
  const orgId = await resolveClaudeOrgId();
  if (!orgId) return false;
  const res = await claudeFetch(`https://claude.ai/api/organizations/${encodeURIComponent(orgId)}/usage`);
  if (!res.ok) return false;
  const data = normalizeClaudeUsage(await res.json());
  if (!data) return false;
  const saved = await handleUsageData(data);
  for (const tab of await chrome.tabs.query({ url: 'https://claude.ai/*' }).catch(() => [])) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'USAGE_PUSH', payload: saved || data }, () => void chrome.runtime.lastError);
  }
  return true;
}

async function refreshAllTabs() {
  const settings = await getSettings();
  let claudePolled = false;
  if (settings.enableClaude !== false) {
    try { claudePolled = await pollClaudeUsage(); } catch (e) { console.warn('[Zero Grok] Claude poll failed', e?.message || e); }
  }
  for (const tab of await queryAiTabs()) {
    if (claudePolled && tab.url && tab.url.includes('claude.ai')) continue;
    try { await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE_USAGE' }); } catch (_) {}
  }
}

// ---------------------------------------------------------------- usage handling

async function handleUsageData(data) {
  if (!data) return null;
  const saved = await saveUsage(data);
  if (!saved) return null;
  const settings = await getSettings();
  await refreshBadgeFromStorage(settings);
  if (typeof saved.usedPercent === 'number' && saved.confidence !== 'estimate') {
    await checkAlerts(saved.usedPercent, saved.provider, settings);
  }
  if (saved.resetAt && saved.resetAt > Date.now() && saved.confidence !== 'estimate') {
    chrome.alarms.create(ALARM_NAMES.resetFor(saved.provider), { when: saved.resetAt + 15000 });
  }
  if (saved.confidence !== 'estimate') await setHealth(saved.provider, 'ok');
  return saved;
}

function remainingOf(d) {
  return S.remainingOf(d);
}

async function refreshBadgeFromStorage(settings) {
  if (!settings) settings = await getSettings();
  const mode = settings.badgeMode || 'lowest';
  if (mode === 'off') {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const usage = await getUsage();
  const by = usage.byProvider || {};
  const enabled = (id) => PROVIDER_BY_ID[id] && settings[PROVIDER_BY_ID[id].settingKey] !== false;
  const fresh = (d) => d && d.updatedAt && Date.now() - d.updatedAt < 12 * 3600000 && d.confidence !== 'estimate';
  let best = null;
  if (mode === 'last' && usage.lastProvider && enabled(usage.lastProvider) && fresh(by[usage.lastProvider])) {
    best = remainingOf(by[usage.lastProvider]);
  } else if (PROVIDER_BY_ID[mode]) {
    if (enabled(mode) && fresh(by[mode])) best = remainingOf(by[mode]);
  } else {
    for (const [id, d] of Object.entries(by)) {
      if (!enabled(id) || !fresh(d)) continue;
      const rem = remainingOf(d);
      if (rem != null && (best == null || rem < best)) best = rem;
    }
  }
  if (best == null) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  chrome.action.setBadgeText({ text: best <= 5 ? 'LOW' : `${Math.round(best)}%` });
  chrome.action.setBadgeBackgroundColor({ color: best <= 10 ? '#e74c3c' : best <= 30 ? '#f39c12' : '#27ae60' });
}

async function checkAlerts(usedPercent, provider, settings) {
  if (typeof usedPercent !== 'number') return;
  const last = await getLastAlert();
  const thresholds = settings.alertThresholds && settings.alertThresholds.length ? settings.alertThresholds : [70, 90, 100];
  const crossed = thresholds.filter((lvl) => usedPercent >= lvl);
  if (!crossed.length) return;
  const level = Math.max(...crossed);
  const key = `${provider || 'any'}:${level}`;
  if (last[key] && Date.now() - last[key] < 6 * 60 * 60 * 1000) return;
  await setLastAlert(key);
  if (S.inQuietHours(settings)) return;
  const label = PROVIDER_BY_ID[provider]?.label || 'AI';
  let message = level >= 100
    ? t('notifExhausted', [label], '$1 usage window exhausted.')
    : t('notifUsed', [label, String(Math.round(usedPercent))], "You've used $2% of your $1 allowance.");
  if (settings.suggestSwitch !== false) {
    const usage = await getUsage();
    const sug = S.suggestSwitch(usage.byProvider, settings, provider);
    if (sug) message += ' ' + t('suggestShort', [sug.label, String(Math.round(sug.remaining))], '$1 has $2% left.');
  }
  chrome.notifications.create('zero-grok-alert-' + key, {
    type: 'basic',
    iconUrl: 'assets/icons/icon128.png',
    title: t('notifAlertTitle', [label, String(level)], 'Zero Grok – $1 $2% used'),
    message
  });
}

// ---------------------------------------------------------------- messages

const HANDLERS = {
  async USAGE_DATA(msg) { await handleUsageData(msg.payload); return { ok: true }; },
  GET_USAGE: () => getUsage(),
  GET_SETTINGS: () => getSettings(),
  async SAVE_SETTINGS(msg) {
    const before = await getSettings();
    const { settings, synced } = await mergeSettings(msg.payload || {});
    if (before.pollIntervalMinutes !== settings.pollIntervalMinutes) schedulePolling(settings.pollIntervalMinutes);
    if (before.autoCheckUpdates !== settings.autoCheckUpdates) await scheduleUpdateCheck(settings, true);
    if (!before.remoteSelectors && settings.remoteSelectors) refreshSelectors();
    await syncOptionalProviders(settings);
    await refreshBadgeFromStorage(settings);
    return { ok: true, synced, settings };
  },
  async OPEN_ONBOARDING() { chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') }); return { ok: true }; },
  async REFRESH_ALL() { await refreshAllTabs(); return { ok: true }; },
  GET_HISTORY: () => getHistory(),
  async CLEAR_HISTORY() { await clearHistory(); return { ok: true }; },
  GET_HEALTH: () => getHealth(),
  async PROVIDER_HEALTH(msg) {
    const p = msg.payload || {};
    return setHealth(p.provider, p.status, p.detail);
  },
  GET_SELECTORS: () => getSelectors(),
  async ESTIMATE_BUMP(msg) {
    const id = msg.provider;
    if (!PROVIDER_BY_ID[id]) return null;
    await bumpEstimate(id);
    const settings = await getSettings();
    return getEstimate(id, settings.plans[id]);
  },
  async GET_ESTIMATE(msg) {
    const id = msg.provider;
    if (!PROVIDER_BY_ID[id]) return null;
    const settings = await getSettings();
    return getEstimate(id, settings.plans[id]);
  },
  async GET_FORECAST(msg) {
    const id = msg.provider;
    const [usage, history] = await Promise.all([getUsage(), getHistory()]);
    const cur = usage.byProvider[id];
    if (!cur || cur.confidence === 'estimate') return null;
    return S.forecastZero(history.filter((h) => h.provider === id), { resetAtMs: cur.resetAt });
  },
  async GET_SUGGESTION(msg) {
    const [usage, settings] = await Promise.all([getUsage(), getSettings()]);
    if (settings.suggestSwitch === false) return null;
    return S.suggestSwitch(usage.byProvider, settings, msg.provider);
  },
  GET_UPDATE: () => getStoredUpdate(),
  async CHECK_UPDATE_NOW() { return checkForUpdate({ notify: false }); },
  async DISMISS_UPDATE() { await dismissUpdate(); return { ok: true }; },
  async OPEN_UPDATE() { const info = await getStoredUpdate(); openUpdateDownload(info?.zipUrl); return { ok: true }; },
  async HIDE_SITE(msg) {
    const host = String(msg.host || '').toLowerCase();
    const settings = await getSettings();
    const list = new Set(settings.hiddenSites || []);
    if (msg.hidden === false) list.delete(host); else list.add(host);
    const r = await mergeSettings({ hiddenSites: [...list] });
    return { ok: true, hiddenSites: r.settings.hiddenSites };
  },
  async SYNC_OPTIONAL_PROVIDERS() { await syncOptionalProviders(); return { ok: true }; },
  async REFRESH_SELECTORS() { const r = await refreshSelectors(); return { ok: !!r }; }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  const fn = message && HANDLERS[message.type];
  if (!fn) return false;
  Promise.resolve()
    .then(() => fn(message, sender))
    .then((r) => sendResponse(r === undefined ? null : r))
    .catch((e) => {
      console.warn('[Zero Grok] handler failed', message.type, e?.message || e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    });
  return true;
});

// ---------------------------------------------------------------- commands

chrome.commands?.onCommand?.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const type = command === 'toggle-panel' ? 'TOGGLE_PANEL' : command === 'toggle-can' ? 'TOGGLE_CAN' : null;
  if (!type) return;
  let delivered = false;
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type });
      delivered = true;
    } catch (_) {}
  }
  if (!delivered && type === 'TOGGLE_PANEL') {
    // Not on a tracked AI site: open the toolbar popup instead.
    try { await chrome.action.openPopup(); } catch (_) {}
  }
});

// Service worker restarts: make sure core alarms exist.
(async () => {
  try {
    const settings = await getSettings();
    const poll = await chrome.alarms.get(ALARM_NAMES.POLL);
    if (!poll) schedulePolling(settings.pollIntervalMinutes);
    await scheduleUpdateCheck(settings);
  } catch (_) {}
})();

import { STORAGE_KEYS, DEFAULT_SETTINGS, PROVIDER_BY_ID } from './constants.js';

const S = globalThis.ZeroGrokShared;
const HISTORY_DAYS = 31;
const HISTORY_MAX = 9000;
const HISTORY_BUCKET_MS = 10 * 60 * 1000;

function syncArea() {
  try {
    return chrome.storage.sync || null;
  } catch (_) {
    return null;
  }
}

/** Clean a settings object: known keys only, sane types/ranges. */
export function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  // legacy: badgeEnabled=false → badgeMode 'off'
  if (raw && raw.badgeEnabled === false && !raw.badgeMode) s.badgeMode = 'off';
  delete s.badgeEnabled;
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = s[k];
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof DEFAULT_SETTINGS[k] === 'boolean') out[k] = out[k] === true || (out[k] !== false && DEFAULT_SETTINGS[k] && out[k] == null);
  }
  out.canPosition = ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(out.canPosition) ? out.canPosition : 'bottom-right';
  out.theme = ['auto', 'light', 'dark'].includes(out.theme) ? out.theme : 'auto';
  const modes = ['lowest', 'last', 'off', ...Object.keys(PROVIDER_BY_ID)];
  out.badgeMode = modes.includes(out.badgeMode) ? out.badgeMode : 'lowest';
  out.pollIntervalMinutes = Math.max(1, Math.min(60, parseInt(out.pollIntervalMinutes, 10) || 5));
  out.alertThresholds = (Array.isArray(out.alertThresholds) ? out.alertThresholds : [70, 90, 100])
    .map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  out.alertThresholds = [...new Set(out.alertThresholds)].sort((a, b) => a - b).slice(0, 6);
  out.hiddenSites = (Array.isArray(out.hiddenSites) ? out.hiddenSites : [])
    .filter((h) => typeof h === 'string' && /^[a-z0-9.-]{1,100}$/i.test(h)).map((h) => h.toLowerCase()).slice(0, 50);
  out.hiddenSites = [...new Set(out.hiddenSites)];
  const plans = {};
  const rawPlans = out.plans && typeof out.plans === 'object' ? out.plans : {};
  for (const [id, p] of Object.entries(PROVIDER_BY_ID)) {
    plans[id] = p.plans.includes(rawPlans[id]) ? rawPlans[id] : p.plans[0];
  }
  out.plans = plans;
  for (const k of ['quietStart', 'quietEnd']) {
    if (!/^\d{1,2}:\d{2}$/.test(String(out[k] || ''))) out[k] = DEFAULT_SETTINGS[k];
  }
  return out;
}

/** Settings live in chrome.storage.sync (follows the browser profile); local is the fallback. */
export async function getSettings() {
  let stored = null;
  const sync = syncArea();
  if (sync) {
    try {
      const r = await sync.get(STORAGE_KEYS.SETTINGS);
      stored = r[STORAGE_KEYS.SETTINGS] || null;
    } catch (_) {}
  }
  if (!stored) {
    const r = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    stored = r[STORAGE_KEYS.SETTINGS] || null;
  }
  return sanitizeSettings(stored);
}

export async function saveSettings(settings) {
  const clean = sanitizeSettings(settings);
  const sync = syncArea();
  let synced = false;
  if (sync) {
    try {
      await sync.set({ [STORAGE_KEYS.SETTINGS]: clean });
      synced = true;
    } catch (e) {
      console.warn('[Zero Grok] sync storage unavailable, using local', e?.message || e);
    }
  }
  // keep a local mirror so content scripts / older code paths always find settings
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: clean });
  return { settings: clean, synced };
}

/** Merge a partial update into the stored settings (never drops unknown-to-caller keys). */
export async function mergeSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...(partial || {}) };
  if (partial && partial.plans) next.plans = { ...current.plans, ...partial.plans };
  return saveSettings(next);
}

/** One-time migration: copy legacy local settings into sync. */
export async function migrateSettings() {
  const sync = syncArea();
  const local = (await chrome.storage.local.get(STORAGE_KEYS.SETTINGS))[STORAGE_KEYS.SETTINGS];
  let inSync = null;
  if (sync) {
    try { inSync = (await sync.get(STORAGE_KEYS.SETTINGS))[STORAGE_KEYS.SETTINGS]; } catch (_) {}
  }
  const base = inSync || local || {};
  return saveSettings(base);
}

export async function getUsage() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USAGE);
  const raw = result[STORAGE_KEYS.USAGE];
  if (!raw) return { byProvider: {}, lastProvider: null, updatedAt: null };
  if (raw.byProvider && typeof raw.byProvider === 'object') {
    return { byProvider: raw.byProvider, lastProvider: raw.lastProvider || null, updatedAt: raw.updatedAt || null };
  }
  const provider = raw.provider || 'grok';
  return { byProvider: { [provider]: { ...raw } }, lastProvider: provider, updatedAt: raw.updatedAt || null };
}

const ALLOWED_USAGE_KEYS = [
  'provider', 'remainingPercent', 'usedPercent', 'windowHint', 'resetAt', 'resetHint', 'source', 'confidence',
  'breakdown', 'weeklyRemaining', 'weeklyUsed', 'weeklyResetHint', 'isFree', 'remaining', 'total', 'count',
  'countWindowHours', 'plan', 'note', 'model'
];

/** Keep only plain, bounded fields from a content-script payload. */
export function sanitizeUsage(data) {
  if (!data || typeof data !== 'object') return null;
  const provider = PROVIDER_BY_ID[data.provider] ? data.provider : 'grok';
  const out = { provider };
  for (const k of ALLOWED_USAGE_KEYS) {
    const v = data[k];
    if (v == null) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = v; }
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'boolean') out[k] = v;
  }
  for (const k of ['remainingPercent', 'usedPercent', 'weeklyRemaining', 'weeklyUsed']) {
    if (typeof out[k] === 'number') out[k] = S.clampPct(out[k]);
  }
  if (out.remainingPercent == null && typeof out.usedPercent === 'number') out.remainingPercent = 100 - out.usedPercent;
  if (out.usedPercent == null && typeof out.remainingPercent === 'number') out.usedPercent = 100 - out.remainingPercent;
  const reset = S.toResetMs(data.resetAt);
  if (reset) out.resetAt = reset; else delete out.resetAt;
  if (Array.isArray(data.breakdown)) {
    out.breakdown = data.breakdown.slice(0, 12).map((b) => ({
      label: String(b && b.label || '').slice(0, 60),
      remainingPercent: typeof b?.remainingPercent === 'number' && Number.isFinite(b.remainingPercent) ? S.clampPct(b.remainingPercent) : null,
      remaining: typeof b?.remaining === 'number' && Number.isFinite(b.remaining) ? b.remaining : null,
      resetAt: S.toResetMs(b?.resetAt)
    })).filter((b) => b.label);
  }
  out.confidence = S.confidenceOf(out.source);
  return out;
}

export async function saveUsage(data) {
  const clean = sanitizeUsage(data);
  if (!clean) return null;
  const provider = clean.provider;
  const current = await getUsage();
  const byProvider = { ...(current.byProvider || {}) };
  byProvider[provider] = { ...clean, updatedAt: Date.now() };
  await chrome.storage.local.set({
    [STORAGE_KEYS.USAGE]: { byProvider, lastProvider: provider, updatedAt: Date.now() }
  });
  if (typeof clean.usedPercent === 'number' && clean.confidence !== 'estimate') await appendHistory(provider, byProvider[provider]);
  return byProvider[provider];
}

/** History: one sample per provider per 10 minutes (latest wins, peak kept), 31 days max. */
export async function appendHistory(provider, snapshot, now = Date.now()) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY);
  let hist = Array.isArray(result[STORAGE_KEYS.HISTORY]) ? result[STORAGE_KEYS.HISTORY] : [];
  const sample = {
    provider,
    usedPercent: snapshot.usedPercent,
    remainingPercent: snapshot.remainingPercent,
    windowHint: snapshot.windowHint,
    source: snapshot.source,
    at: now
  };
  let lastIdx = -1;
  for (let i = hist.length - 1; i >= 0 && i >= hist.length - 40; i--) {
    if (hist[i].provider === provider) { lastIdx = i; break; }
  }
  if (lastIdx >= 0 && now - hist[lastIdx].at < HISTORY_BUCKET_MS && Math.abs(hist[lastIdx].usedPercent - sample.usedPercent) < 15) {
    hist[lastIdx] = sample;
  } else {
    hist.push(sample);
  }
  const cutoff = now - HISTORY_DAYS * 86400000;
  hist = hist.filter((h) => h && h.at >= cutoff).slice(-HISTORY_MAX);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: hist });
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

export async function getHealth() {
  const r = await chrome.storage.local.get(STORAGE_KEYS.HEALTH);
  return r[STORAGE_KEYS.HEALTH] || {};
}

export async function setHealth(provider, status, detail) {
  if (!PROVIDER_BY_ID[provider]) return;
  const all = await getHealth();
  const prev = all[provider] || {};
  all[provider] = {
    status: String(status || 'ok').slice(0, 20),
    detail: String(detail || '').slice(0, 200),
    since: prev.status === status ? (prev.since || Date.now()) : Date.now(),
    at: Date.now()
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.HEALTH]: all });
  return all[provider];
}

/** Local message-count estimate (only for sites with no usage data). */
export async function bumpEstimate(provider, now = Date.now()) {
  const r = await chrome.storage.local.get(STORAGE_KEYS.ESTIMATES);
  const all = r[STORAGE_KEYS.ESTIMATES] || {};
  const list = (all[provider] || []).filter((t) => now - t < 7 * 86400000);
  list.push(now);
  all[provider] = list.slice(-1000);
  await chrome.storage.local.set({ [STORAGE_KEYS.ESTIMATES]: all });
}

export async function getEstimate(provider, plan, now = Date.now()) {
  const r = await chrome.storage.local.get(STORAGE_KEYS.ESTIMATES);
  const list = (r[STORAGE_KEYS.ESTIMATES] || {})[provider] || [];
  const capInfo = (S.ESTIMATE_CAPS[provider] || {})[plan] || null;
  const hours = capInfo ? capInfo.hours : 24;
  const inWindow = list.filter((t) => now - t < hours * 3600000).sort((a, b) => a - b);
  const out = {
    provider,
    source: 'estimate',
    count: inWindow.length,
    countWindowHours: hours,
    plan,
    windowHint: S.t('estimateWindow', [String(hours)], 'Local count · last $1h')
  };
  if (capInfo && capInfo.cap > 0) {
    const used = Math.min(100, (inWindow.length / capInfo.cap) * 100);
    out.usedPercent = used;
    out.remainingPercent = 100 - used;
    out.total = capInfo.cap;
    if (inWindow.length) out.resetAt = inWindow[0] + hours * 3600000;
    out.note = S.t('estimateRough', [String(capInfo.cap), plan], 'Rough guess: ~$1 msgs on $2 plan. Not official.');
  } else {
    out.note = S.t('estimateCountOnly', null, 'No public cap — showing your local message count only.');
  }
  return out;
}

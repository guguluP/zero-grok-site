import { STORAGE_KEYS, UPDATE_FEED } from './constants.js';

/**
 * Lightweight, opt-in version check for people who installed the ZIP
 * (Load unpacked). Store installs update automatically, so this is off by default.
 * It only downloads a public version.json from raw.githubusercontent.com – no
 * usage data is ever sent.
 */
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function currentVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch (_) {
    return '0.0.0';
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function fetchPublishedRelease() {
  for (const url of UPDATE_FEED.versionJson) {
    try {
      const json = await fetchJson(url);
      if (json && json.version) {
        return {
          version: String(json.version).slice(0, 20),
          zipUrl: UPDATE_FEED.zipUrl,
          releaseNotes: String(json.releaseNotes || json.notes || '').slice(0, 300),
          publishedAt: json.publishedAt || null,
          source: 'version.json'
        };
      }
    } catch (e) {
      console.warn('[Zero Grok] version feed failed', e?.message || e);
    }
  }
  for (const url of UPDATE_FEED.manifestJson) {
    try {
      const json = await fetchJson(url);
      if (json && json.version) {
        return { version: String(json.version).slice(0, 20), zipUrl: UPDATE_FEED.zipUrl, releaseNotes: '', publishedAt: null, source: 'manifest.json' };
      }
    } catch (e) {
      console.warn('[Zero Grok] manifest feed failed', e?.message || e);
    }
  }
  return null;
}

export async function getStoredUpdate() {
  const bag = await chrome.storage.local.get(STORAGE_KEYS.UPDATE);
  return bag[STORAGE_KEYS.UPDATE] || null;
}

export async function setStoredUpdate(info) {
  await chrome.storage.local.set({ [STORAGE_KEYS.UPDATE]: info });
}

export async function dismissUpdate() {
  const prev = (await getStoredUpdate()) || {};
  await setStoredUpdate({ ...prev, dismissedVersion: prev.latest || null });
}

export async function checkForUpdate({ notify = true } = {}) {
  const installed = currentVersion();
  const published = await fetchPublishedRelease();
  const checkedAt = new Date().toISOString();
  const prev = await getStoredUpdate();

  if (!published) {
    const next = { ...(prev || {}), checkedAt, installed, available: false, error: 'feed-unavailable' };
    await setStoredUpdate(next);
    return next;
  }

  const newer = compareVersions(published.version, installed) > 0;
  const info = {
    checkedAt,
    installed,
    latest: published.version,
    available: newer,
    zipUrl: published.zipUrl,
    releaseNotes: published.releaseNotes || '',
    publishedAt: published.publishedAt,
    source: published.source,
    notifiedVersion: prev?.notifiedVersion || null,
    dismissedVersion: prev?.dismissedVersion || null
  };

  if (newer && notify && prev?.notifiedVersion !== published.version) {
    try {
      chrome.notifications.create('zero-grok-update', {
        type: 'basic',
        iconUrl: 'assets/icons/icon128.png',
        title: `Zero Grok ${published.version}`,
        message: (published.releaseNotes || 'A new version is available.') + ' Click to download the ZIP.',
        priority: 1
      });
      info.notifiedVersion = published.version;
    } catch (_) {}
  }

  await setStoredUpdate(info);
  return info;
}

export function openUpdateDownload(zipUrl) {
  const url = zipUrl && /^https:\/\/github\.com\/guguluP\/zero-grok-site\//.test(zipUrl) ? zipUrl : UPDATE_FEED.zipUrl;
  chrome.tabs.create({ url });
}

/**
 * Zero Grok – shared helpers.
 *
 * Plain script (no import/export) so it can be loaded by content scripts, by
 * extension pages via <script>, and by the module service worker via a
 * side-effect `import './utils/shared.js'`. Everything hangs off
 * globalThis.ZeroGrokShared. Pure functions only – no network, no storage.
 */
(function (g) {
  'use strict';
  if (g.ZeroGrokShared) return;

  /** Provider registry. `optional` providers use optional_host_permissions. */
  const PROVIDERS = [
    { id: 'grok', label: 'Grok', color: '#c41e3a', settingKey: 'enableGrok', optional: false,
      url: 'https://grok.com', hosts: ['https://grok.com/*', 'https://grok.x.ai/*', 'https://x.com/*'],
      plans: ['free', 'supergrok', 'heavy'] },
    { id: 'claude', label: 'Claude', color: '#d97757', settingKey: 'enableClaude', optional: false,
      url: 'https://claude.ai', hosts: ['https://claude.ai/*'], plans: ['free', 'pro', 'max'] },
    { id: 'chatgpt', label: 'ChatGPT', color: '#10a37f', settingKey: 'enableChatgpt', optional: false,
      url: 'https://chatgpt.com', hosts: ['https://chatgpt.com/*', 'https://chat.openai.com/*'], plans: ['free', 'plus', 'pro'] },
    { id: 'gemini', label: 'Gemini', color: '#4285f4', settingKey: 'enableGemini', optional: false,
      url: 'https://gemini.google.com', hosts: ['https://gemini.google.com/*'], plans: ['free', 'pro', 'ultra'] },
    { id: 'perplexity', label: 'Perplexity', color: '#20808d', settingKey: 'enablePerplexity', optional: true,
      url: 'https://www.perplexity.ai', hosts: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'], plans: ['free', 'pro'] },
    { id: 'deepseek', label: 'DeepSeek', color: '#4d6bfe', settingKey: 'enableDeepseek', optional: true,
      url: 'https://chat.deepseek.com', hosts: ['https://chat.deepseek.com/*'], plans: ['free'] },
    { id: 'mistral', label: 'Le Chat', color: '#fa520f', settingKey: 'enableMistral', optional: true,
      url: 'https://chat.mistral.ai', hosts: ['https://chat.mistral.ai/*'], plans: ['free', 'pro'] },
    { id: 'copilot', label: 'Copilot', color: '#0078d4', settingKey: 'enableCopilot', optional: true,
      url: 'https://copilot.microsoft.com', hosts: ['https://copilot.microsoft.com/*'], plans: ['free', 'pro'] },
    { id: 'metaai', label: 'Meta AI', color: '#0866ff', settingKey: 'enableMetaai', optional: true,
      url: 'https://www.meta.ai', hosts: ['https://www.meta.ai/*', 'https://meta.ai/*'], plans: ['free'] }
  ];
  const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

  /**
   * Rough local-estimate caps (messages per rolling window) used ONLY when a site
   * exposes no usage data and the user has estimates on. These are deliberately
   * labelled "rough guess" in the UI; null means "count only, no percentage".
   */
  const ESTIMATE_CAPS = {
    grok: { free: { cap: 20, hours: 2 }, supergrok: null, heavy: null },
    claude: { free: { cap: 20, hours: 5 }, pro: { cap: 45, hours: 5 }, max: { cap: 225, hours: 5 } },
    chatgpt: { free: { cap: 10, hours: 5 }, plus: { cap: 160, hours: 3 }, pro: null },
    gemini: { free: null, pro: null, ultra: null },
    perplexity: { free: { cap: 3, hours: 24 }, pro: null },
    deepseek: { free: null },
    mistral: { free: null, pro: null },
    copilot: { free: null, pro: null },
    metaai: { free: null }
  };

  const DEFAULT_SETTINGS = {
    canPosition: 'bottom-right',
    alertThresholds: [70, 90, 100],
    theme: 'auto', // auto | light | dark
    reduceMotion: false,
    hideCan: false,
    hiddenSites: [],
    soundEnabled: true,
    badgeMode: 'lowest', // lowest | last | off | <provider id>
    pollIntervalMinutes: 5,
    enableGrok: true,
    enableClaude: true,
    enableChatgpt: true,
    enableGemini: true,
    enablePerplexity: false,
    enableDeepseek: false,
    enableMistral: false,
    enableCopilot: false,
    enableMetaai: false,
    plans: {},
    estimateMessagesEnabled: false,
    notifyOnReset: true,
    quietHoursEnabled: false,
    quietStart: '22:00',
    quietEnd: '07:00',
    suggestSwitch: true,
    autoCheckUpdates: false,
    remoteSelectors: true,
    onboardingComplete: false
  };

  /** Map a reading's `source` to a confidence bucket shown next to every number. */
  const SOURCE_CONFIDENCE = {
    'rate-limits': 'official', 'org-usage': 'official', 'api-background': 'official',
    'api-limit': 'official', 'api-percent': 'official', 'grpc-json': 'official', 'site-api': 'official',
    'usage-page': 'page', 'live-page': 'page', 'usage-fetch': 'page', 'network-json': 'page',
    'dom-limit': 'page', 'dom-count': 'page', 'dom-heuristic': 'page', 'cached-page': 'page',
    'estimate': 'estimate', 'grpc-heuristic': 'estimate'
  };
  function confidenceOf(source) {
    return SOURCE_CONFIDENCE[source] || (source ? 'page' : 'estimate');
  }

  function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }
  function clampPct(n) { return Math.max(0, Math.min(100, n)); }

  function remainingOf(d) {
    if (!d) return null;
    if (isNum(d.remainingPercent)) return clampPct(d.remainingPercent);
    if (isNum(d.usedPercent)) return clampPct(100 - d.usedPercent);
    return null;
  }

  /** Normalise reset values (ISO string, seconds, ms) to epoch ms or null. */
  function toResetMs(v) {
    if (v == null || v === '') return null;
    if (isNum(v)) return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string') {
      if (/^\d+$/.test(v)) { const n = parseInt(v, 10); return n < 1e12 ? n * 1000 : n; }
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  }

  /** Parse relative reset text like "Resets in 2h 10m" / "in 45 min". */
  function parseRelativeReset(text, now) {
    const s = String(text || '');
    const h = s.match(/(\d+)\s*(?:h|hr|hrs|hours?)\b/i);
    const m = s.match(/(\d+)\s*(?:m|min|mins|minutes?)\b/i);
    const d = s.match(/(\d+)\s*(?:d|days?)\b/i);
    if (!h && !m && !d) return null;
    const ms = ((d ? +d[1] * 24 : 0) + (h ? +h[1] : 0)) * 3600000 + (m ? +m[1] * 60000 : 0);
    return ms > 0 ? (now || Date.now()) + ms : null;
  }

  function formatDuration(ms) {
    if (!isNum(ms)) return '';
    const left = Math.max(0, ms);
    const totalMin = Math.round(left / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return Math.max(1, m) + 'm';
  }

  function formatClock(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
      return new Date(ms).toTimeString().slice(0, 5);
    }
  }

  /** chrome.i18n with a plain fallback so pages still render if a key is missing. */
  function t(key, subs, fallback) {
    let msg = '';
    try { msg = g.chrome && g.chrome.i18n ? g.chrome.i18n.getMessage(key, subs) : ''; } catch (_) {}
    if (msg) return msg;
    let out = fallback != null ? String(fallback) : key;
    const arr = Array.isArray(subs) ? subs : subs != null ? [subs] : [];
    arr.forEach((v, i) => { out = out.split('$' + (i + 1)).join(String(v)); });
    return out;
  }

  function confidenceLabel(conf) {
    if (conf === 'official') return t('confOfficial', null, 'Site usage API');
    if (conf === 'page') return t('confPage', null, 'Read from page');
    return t('confEstimate', null, 'Estimate');
  }

  /** Is `now` inside quiet hours "HH:MM"–"HH:MM" (may wrap midnight)? */
  function inQuietHours(settings, now) {
    if (!settings || !settings.quietHoursEnabled) return false;
    const toMin = (s) => {
      const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
      return m ? (Math.min(23, +m[1]) * 60 + Math.min(59, +m[2])) : null;
    };
    const a = toMin(settings.quietStart);
    const b = toMin(settings.quietEnd);
    if (a == null || b == null || a === b) return false;
    const d = new Date(now || Date.now());
    const cur = d.getHours() * 60 + d.getMinutes();
    return a < b ? (cur >= a && cur < b) : (cur >= a || cur < b);
  }

  /**
   * Burn-rate forecast from local history samples of one provider.
   * samples: [{at, usedPercent}] (any order). Uses samples since the last reset
   * (a drop of >15 points) within the last 3h, least-squares slope.
   * Returns {status:'eta', etaMs, perHour} | {status:'lasts', resetAtMs} | {status:'steady'} | null
   */
  function forecastZero(samples, opts) {
    const now = (opts && opts.now) || Date.now();
    const resetAtMs = opts && opts.resetAtMs;
    const pts = (samples || [])
      .filter((s) => s && isNum(s.at) && isNum(s.usedPercent) && s.at >= now - 3 * 3600000 && s.at <= now + 60000)
      .sort((a, b) => a.at - b.at);
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].usedPercent < pts[i - 1].usedPercent - 15) start = i;
    }
    const win = pts.slice(start);
    if (win.length < 2) return null;
    const span = win[win.length - 1].at - win[0].at;
    if (span < 10 * 60000) return null;
    const n = win.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const t0 = win[0].at;
    for (const p of win) {
      const x = (p.at - t0) / 3600000;
      sx += x; sy += p.usedPercent; sxx += x * x; sxy += x * p.usedPercent;
    }
    const den = n * sxx - sx * sx;
    if (den === 0) return null;
    const perHour = (n * sxy - sx * sy) / den;
    const last = win[win.length - 1];
    if (!(perHour > 0.5)) return { status: 'steady', perHour: Math.max(0, perHour) };
    const left = Math.max(0, 100 - last.usedPercent);
    const etaMs = last.at + (left / perHour) * 3600000;
    if (resetAtMs && etaMs > resetAtMs) return { status: 'lasts', resetAtMs, perHour };
    return { status: 'eta', etaMs, perHour };
  }

  /** Peak used% per local day for the last `days` days (oldest first). */
  function dailyPeaks(history, provider, days, now) {
    const end = new Date(now || Date.now());
    end.setHours(0, 0, 0, 0);
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = end.getTime() - i * 86400000;
      out.push({ day: dayStart, peak: null, samples: 0 });
    }
    const first = out[0].day;
    for (const h of history || []) {
      if (!h || h.provider !== provider || !isNum(h.at) || h.at < first) continue;
      const used = isNum(h.usedPercent) ? h.usedPercent : isNum(h.remainingPercent) ? 100 - h.remainingPercent : null;
      if (used == null) continue;
      const idx = Math.floor((h.at - first) / 86400000);
      if (idx < 0 || idx >= out.length) continue;
      out[idx].samples++;
      out[idx].peak = out[idx].peak == null ? used : Math.max(out[idx].peak, used);
    }
    return out;
  }

  /** Suggest a provider with room when `fromId` is running low. */
  function suggestSwitch(byProvider, settings, fromId, now) {
    const cur = remainingOf(byProvider && byProvider[fromId]);
    if (cur == null || cur > 20) return null;
    let best = null;
    for (const p of PROVIDERS) {
      if (p.id === fromId || !settings || settings[p.settingKey] === false) continue;
      const d = byProvider[p.id];
      const rem = remainingOf(d);
      if (rem == null || rem < 30) continue;
      if (confidenceOf(d.source) === 'estimate') continue; // never steer users using a rough guess
      if (!d.updatedAt || (now || Date.now()) - d.updatedAt > 12 * 3600000) continue;
      if (!best || rem > best.remaining) best = { to: p.id, label: p.label, remaining: rem };
    }
    return best ? { from: fromId, fromLabel: (PROVIDER_BY_ID[fromId] || {}).label || fromId, fromRemaining: cur, ...best } : null;
  }

  /** Pull explicit usage fields out of a JSON payload (no byte guessing). */
  function pickUsageFields(json) {
    if (!json || typeof json !== 'object') return null;
    const usedKeys = /^(used_?percent|usage_?percent|percent_?used|utilization|weekly_?usage_?percent|usage_?percentage)$/i;
    const remKeys = /^(remaining_?percent|percent_?remaining)$/i;
    const resetKeys = /^(resets?_?at|reset_?time|next_?reset(_?time)?|period_?end|resets?_?after|window_?end)$/i;
    const pairs = [
      ['remaining', 'limit'], ['remaining', 'total'], ['remaining', 'max'],
      ['remainingQueries', 'totalQueries'], ['remaining_queries', 'total_queries'],
      ['used', 'limit'], ['used', 'total'], ['creditsUsed', 'creditsTotal'], ['usedCredits', 'totalCredits'],
      ['used_credits', 'total_credits']
    ];
    const stack = [{ node: json, depth: 0 }];
    while (stack.length) {
      const { node, depth } = stack.pop();
      if (!node || typeof node !== 'object' || depth > 8) continue;
      let used = null, rem = null, reset = null;
      for (const [k, v] of Object.entries(node)) {
        if (isNum(v) && usedKeys.test(k) && v >= 0 && v <= 100) used = v;
        if (isNum(v) && remKeys.test(k) && v >= 0 && v <= 100) rem = v;
        if (resetKeys.test(k) && (typeof v === 'string' || isNum(v))) reset = v;
      }
      for (const [a, b] of pairs) {
        if (isNum(node[a]) && isNum(node[b]) && node[b] > 0) {
          const isUsed = /used/i.test(a);
          const frac = node[a] / node[b];
          const remainingPercent = clampPct((isUsed ? 1 - frac : frac) * 100);
          return {
            remainingPercent, usedPercent: 100 - remainingPercent,
            count: isUsed ? undefined : node[a], total: node[b],
            resetAt: toResetMs(reset), field: a + '/' + b
          };
        }
      }
      if (used != null || rem != null) {
        const remainingPercent = rem != null ? rem : 100 - used;
        return { remainingPercent, usedPercent: 100 - remainingPercent, resetAt: toResetMs(reset), field: rem != null ? 'remaining%' : 'used%' };
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push({ node: v, depth: depth + 1 });
    }
    return null;
  }

  /**
   * Decode a gRPC-web protobuf response generically and return candidate floats
   * (fixed32/fixed64 fields in (0,100]) with their field paths. Used only as a
   * labelled fallback for paid Grok usage when no JSON is available.
   */
  function protobufFloatCandidates(bytes) {
    const out = [];
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    function varint(view, pos) {
      let result = 0, shift = 0, b;
      do {
        if (pos >= view.length || shift > 49) return null;
        b = view[pos++];
        result += (b & 0x7f) * Math.pow(2, shift);
        shift += 7;
      } while (b & 0x80);
      return { value: result, pos };
    }
    function decode(view, path, depth) {
      let pos = 0;
      const local = [];
      while (pos < view.length) {
        const key = varint(view, pos);
        if (!key) return null;
        pos = key.pos;
        const field = Math.floor(key.value / 8), wt = key.value & 7;
        if (field < 1) return null;
        if (wt === 0) { const v = varint(view, pos); if (!v) return null; pos = v.pos; }
        else if (wt === 1) {
          if (pos + 8 > view.length) return null;
          const f = new DataView(view.buffer, view.byteOffset + pos, 8).getFloat64(0, true);
          if (Number.isFinite(f) && f > 0 && f <= 100) local.push({ path: path + '.' + field, value: f });
          pos += 8;
        } else if (wt === 2) {
          const len = varint(view, pos); if (!len) return null; pos = len.pos;
          if (pos + len.value > view.length) return null;
          const sub = view.subarray(pos, pos + len.value);
          if (depth < 6 && sub.length) {
            const nested = decode(sub, path + '.' + field, depth + 1);
            if (nested) local.push(...nested);
          }
          pos += len.value;
        } else if (wt === 5) {
          if (pos + 4 > view.length) return null;
          const f = new DataView(view.buffer, view.byteOffset + pos, 4).getFloat32(0, true);
          if (Number.isFinite(f) && f > 0 && f <= 100) local.push({ path: path + '.' + field, value: Math.round(f * 100) / 100 });
          pos += 4;
        } else return null;
      }
      return local;
    }
    // gRPC-web framing: [flag:1][len:4 BE][payload]...
    let pos = 0;
    while (pos + 5 <= buf.length) {
      const flag = buf[pos];
      const len = ((buf[pos + 1] << 24) >>> 0) + (buf[pos + 2] << 16) + (buf[pos + 3] << 8) + buf[pos + 4];
      const start = pos + 5;
      if (start + len > buf.length) break;
      if ((flag & 0x80) === 0 && len > 0) {
        const r = decode(buf.subarray(start, start + len), '', 0);
        if (r) out.push(...r);
      }
      pos = start + len;
    }
    return out;
  }

  /** Validate a selectors.json document: data only, known keys, bounded sizes. */
  function validateSelectors(doc) {
    if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 1) return null;
    const clean = { schemaVersion: 1, version: isNum(doc.version) ? doc.version : 0, providers: {} };
    const providers = doc.providers && typeof doc.providers === 'object' ? doc.providers : {};
    const strArr = (a, max, test) => (Array.isArray(a) ? a : [])
      .filter((s) => typeof s === 'string' && s.length > 0 && s.length <= max && (!test || test(s)))
      .slice(0, 40);
    const isRegex = (s) => { try { new RegExp(s, 'i'); return true; } catch (_) { return false; } };
    const isPath = (s) => s.startsWith('/') && !s.startsWith('//') && !/[\s:\\]/.test(s);
    for (const id of Object.keys(PROVIDER_BY_ID)) {
      const p = providers[id];
      if (!p || typeof p !== 'object') continue;
      const out = {};
      out.limitSurfaces = strArr(p.limitSurfaces, 200);
      out.limitPatterns = strArr(p.limitPatterns, 300, isRegex);
      out.countPatterns = strArr(p.countPatterns, 300, isRegex);
      out.endpoints = strArr(p.endpoints, 200, isPath);
      out.percentSurfaces = strArr(p.percentSurfaces, 200);
      if (p.usageBlocks && typeof p.usageBlocks === 'object') {
        out.usageBlocks = {};
        for (const [k, v] of Object.entries(p.usageBlocks)) {
          if (/^[a-z]{1,20}$/i.test(k)) out.usageBlocks[k] = strArr(v, 200);
        }
      }
      clean.providers[id] = out;
    }
    return clean;
  }

  function csvEscape(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function historyToCsv(history) {
    const rows = [['timestamp_iso', 'provider', 'used_percent', 'remaining_percent', 'window', 'source', 'confidence']];
    for (const h of history || []) {
      rows.push([new Date(h.at).toISOString(), h.provider, h.usedPercent, h.remainingPercent, h.windowHint || '', h.source || '', h.confidence || confidenceOf(h.source)]);
    }
    return rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
  }

  function hostAllowed(settings, host) {
    const list = (settings && settings.hiddenSites) || [];
    return !list.includes(String(host || '').toLowerCase());
  }

  g.ZeroGrokShared = {
    PROVIDERS, PROVIDER_BY_ID, ESTIMATE_CAPS, DEFAULT_SETTINGS, SOURCE_CONFIDENCE,
    confidenceOf, confidenceLabel, remainingOf, toResetMs, parseRelativeReset, formatDuration, formatClock,
    t, inQuietHours, forecastZero, dailyPeaks, suggestSwitch, pickUsageFields, protobufFloatCandidates,
    validateSelectors, historyToCsv, hostAllowed, isNum, clampPct
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : window));

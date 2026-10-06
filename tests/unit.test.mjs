// Unit tests for pure logic (no browser). Run: node --test unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '../extension');

// Minimal chrome stub (no i18n → fallbacks are used).
globalThis.chrome = { i18n: { getMessage: () => '' } };
await import(path.join(EXT, 'utils/shared.js'));
const S = globalThis.ZeroGrokShared;
const storage = await import(path.join(EXT, 'utils/storage.js'));

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(EXT, p), 'utf8'));
const MIN = 60000, HOUR = 3600000;

test('confidence labels map every source', () => {
  assert.equal(S.confidenceOf('rate-limits'), 'official');
  assert.equal(S.confidenceOf('org-usage'), 'official');
  assert.equal(S.confidenceOf('usage-page'), 'page');
  assert.equal(S.confidenceOf('dom-limit'), 'page');
  assert.equal(S.confidenceOf('grpc-heuristic'), 'estimate');
  assert.equal(S.confidenceOf('estimate'), 'estimate');
  assert.equal(S.confidenceLabel('official'), 'Site usage API');
  assert.equal(S.confidenceLabel('page'), 'Read from page');
  assert.equal(S.confidenceLabel('estimate'), 'Estimate');
});

test('forecastZero: eta, lasts-until-reset, steady, reset drop', () => {
  const now = Date.UTC(2026, 9, 6, 12);
  const rising = [0, 1, 2, 3].map((i) => ({ at: now - (3 - i) * 20 * MIN, usedPercent: 40 + i * 10 }));
  const eta = S.forecastZero(rising, { now });
  assert.equal(eta.status, 'eta');
  assert.ok(Math.abs(eta.perHour - 30) < 0.01);
  assert.ok(Math.abs(eta.etaMs - (now + (30 / 30) * HOUR)) < 1000);
  const lasts = S.forecastZero(rising, { now, resetAtMs: now + 30 * MIN });
  assert.equal(lasts.status, 'lasts');
  const flat = [0, 1, 2].map((i) => ({ at: now - (2 - i) * 20 * MIN, usedPercent: 50 }));
  assert.equal(S.forecastZero(flat, { now }).status, 'steady');
  // A reset (drop >15 points) restarts the window → too few points after it.
  const withReset = [...rising, { at: now + 30000, usedPercent: 5 }];
  assert.equal(S.forecastZero(withReset, { now: now + 60000 }), null);
  assert.equal(S.forecastZero([], { now }), null);
});

test('pickUsageFields: explicit fields only', () => {
  assert.deepEqual(S.pickUsageFields({ config: { weeklyUsagePercent: 42.5 } }).usedPercent, 42.5);
  const pair = S.pickUsageFields({ data: { remaining: 12, limit: 40, resets_at: '2026-10-06T10:00:00Z' } });
  assert.equal(pair.remainingPercent, 30);
  assert.equal(pair.count, 12);
  assert.equal(pair.resetAt, Date.parse('2026-10-06T10:00:00Z'));
  assert.equal(S.pickUsageFields({ used: 30, total: 120 }).remainingPercent, 75);
  // unrelated numbers never become a percentage
  assert.equal(S.pickUsageFields({ limit: 50, id: 3, model_limit: 80, count: 9 }), null);
  assert.equal(S.pickUsageFields(null), null);
});

function varint(n) { const out = []; while (n > 127) { out.push((n & 127) | 128); n >>>= 7; } out.push(n); return out; }
function frame(payload) { const len = payload.length; return [0, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...payload]; }

test('protobufFloatCandidates decodes nested fixed32 floats in gRPC-web frames', () => {
  const f = new Uint8Array(new Float32Array([37.5]).buffer);
  const inner = [(1 << 3) | 5, ...f, (2 << 3) | 0, ...varint(300)];
  const msg = [(1 << 3) | 0, ...varint(7), (4 << 3) | 2, ...varint(inner.length), ...inner];
  const trailer = [0x80, 0, 0, 0, 2, 0x61, 0x62];
  const c = S.protobufFloatCandidates(new Uint8Array([...frame(msg), ...trailer]));
  assert.deepEqual(c, [{ path: '.4.1', value: 37.5 }]);
  assert.deepEqual(S.protobufFloatCandidates(new Uint8Array([1, 2, 3])), []);
});

test('validateSelectors keeps data, drops code-ish / invalid entries', () => {
  assert.equal(S.validateSelectors({ schemaVersion: 2 }), null);
  const v = S.validateSelectors({
    schemaVersion: 1, version: 3,
    providers: {
      grok: { limitPatterns: ['ok\\s+limit', '(unclosed'], endpoints: ['/api/x', 'https://evil.example/x', '//evil'], script: 'alert(1)' },
      notAProvider: { limitPatterns: ['x'] }
    }
  });
  assert.equal(v.version, 3);
  assert.deepEqual(v.providers.grok.limitPatterns, ['ok\\s+limit']);
  assert.deepEqual(v.providers.grok.endpoints, ['/api/x']);
  assert.equal(v.providers.grok.script, undefined);
  assert.equal(v.providers.notAProvider, undefined);
});

test('bundled selectors.json is valid and survives validation unchanged', () => {
  const doc = readJson('selectors.json');
  const v = S.validateSelectors(doc);
  assert.ok(v);
  for (const [id, p] of Object.entries(doc.providers)) {
    for (const k of ['limitSurfaces', 'limitPatterns', 'countPatterns', 'endpoints', 'percentSurfaces']) {
      assert.deepEqual(v.providers[id][k], p[k] || [], `${id}.${k}`);
    }
  }
});

test('quiet hours (wrapping midnight)', () => {
  const at = (h, m) => new Date(2026, 9, 6, h, m).getTime();
  const s = { quietHoursEnabled: true, quietStart: '22:00', quietEnd: '07:00' };
  assert.equal(S.inQuietHours(s, at(23, 30)), true);
  assert.equal(S.inQuietHours(s, at(6, 59)), true);
  assert.equal(S.inQuietHours(s, at(12, 0)), false);
  assert.equal(S.inQuietHours({ ...s, quietHoursEnabled: false }, at(23, 30)), false);
  assert.equal(S.inQuietHours({ ...s, quietStart: '09:00', quietEnd: '17:00' }, at(12, 0)), true);
});

test('reset parsing and duration formatting', () => {
  const now = 1_000_000_000_000;
  assert.equal(S.parseRelativeReset('Resets in 2h 10m', now), now + 2 * HOUR + 10 * MIN);
  assert.equal(S.parseRelativeReset('in 45 min', now), now + 45 * MIN);
  assert.equal(S.parseRelativeReset('no time here', now), null);
  assert.equal(S.formatDuration(2 * HOUR + 14 * MIN), '2h 14m');
  assert.equal(S.formatDuration(26 * HOUR), '1d 2h');
  assert.equal(S.formatDuration(10000), '1m');
  assert.equal(S.toResetMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(S.toResetMs('2026-10-06T00:00:00Z'), Date.parse('2026-10-06T00:00:00Z'));
});

test('suggestSwitch picks a fresh provider with room', () => {
  const now = Date.now();
  const by = {
    claude: { remainingPercent: 10, updatedAt: now },
    gemini: { remainingPercent: 65, updatedAt: now },
    chatgpt: { remainingPercent: 90, updatedAt: now - 13 * HOUR }, // stale
    grok: { remainingPercent: 25, updatedAt: now }                 // too low
  };
  const sg = S.suggestSwitch(by, S.DEFAULT_SETTINGS, 'claude', now);
  assert.equal(sg.to, 'gemini');
  assert.equal(sg.fromRemaining, 10);
  assert.equal(S.suggestSwitch(by, { ...S.DEFAULT_SETTINGS, enableGemini: false }, 'claude', now), null);
  assert.equal(S.suggestSwitch(by, S.DEFAULT_SETTINGS, 'gemini', now), null);
});

test('dailyPeaks and CSV export', () => {
  const now = new Date(2026, 9, 6, 15).getTime();
  const hist = [
    { provider: 'grok', at: now - 1 * HOUR, usedPercent: 40 },
    { provider: 'grok', at: now - 2 * HOUR, usedPercent: 70 },
    { provider: 'grok', at: now - 3 * 86400000, usedPercent: 20 },
    { provider: 'claude', at: now, usedPercent: 99 }
  ];
  const d = S.dailyPeaks(hist, 'grok', 7, now);
  assert.equal(d.length, 7);
  assert.equal(d[6].peak, 70);
  assert.equal(d[3].peak, 20);
  assert.equal(d[5].peak, null);
  const csv = S.historyToCsv([{ provider: 'grok', at: 0, usedPercent: 10, remainingPercent: 90, windowHint: 'Fast, "2h"', source: 'rate-limits' }]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'timestamp_iso,provider,used_percent,remaining_percent,window,source,confidence');
  assert.equal(lines[1], '1970-01-01T00:00:00.000Z,grok,10,90,"Fast, ""2h""",rate-limits,official');
});

test('sanitizeSettings: types, ranges, legacy keys', () => {
  const s = storage.sanitizeSettings({
    alertThresholds: [90, '50', 0, 150, 90, 'x'], hiddenSites: ['Grok.com', 'bad host!', 'grok.com'],
    plans: { claude: 'max', grok: 'nope' }, badgeEnabled: false, pollIntervalMinutes: 999, theme: 'neon',
    quietStart: '25-00', soundEnabled: 'yes', unknownKey: 1
  });
  assert.deepEqual(s.alertThresholds, [50, 90]);
  assert.deepEqual(s.hiddenSites, ['grok.com']);
  assert.equal(s.plans.claude, 'max');
  assert.equal(s.plans.grok, 'free');
  assert.equal(s.badgeMode, 'off');
  assert.equal(s.pollIntervalMinutes, 60);
  assert.equal(s.theme, 'auto');
  assert.equal(s.quietStart, '22:00');
  assert.equal(s.soundEnabled, false);
  assert.equal(s.unknownKey, undefined);
  assert.equal(s.estimateMessagesEnabled, false, 'ChatGPT/global estimate default aligned with constants (off)');
  assert.equal(s.autoCheckUpdates, false, 'update checks are opt-in');
});

test('sanitizeUsage keeps only known plain fields', () => {
  const u = storage.sanitizeUsage({ provider: 'claude', usedPercent: 120, source: 'org-usage', evil: '<img onerror=1>', breakdown: [{ label: 'Weekly', remainingPercent: 60 }, { label: '' }] });
  assert.equal(u.usedPercent, 100);
  assert.equal(u.remainingPercent, 0);
  assert.equal(u.confidence, 'official');
  assert.equal(u.evil, undefined);
  assert.equal(u.breakdown.length, 1);
});

test('manifest: v1.5.0, trimmed permissions, scoped hosts, Firefox fields', () => {
  const m = readJson('manifest.json');
  assert.equal(m.version, '1.5.0');
  assert.equal(m.default_locale, 'en');
  assert.deepEqual([...m.permissions].sort(), ['alarms', 'notifications', 'scripting', 'storage']);
  assert.ok(!m.permissions.includes('tabs') && !m.permissions.includes('declarativeNetRequest'));
  assert.ok(!m.host_permissions.some((h) => /github\.com\/\*|jsdelivr/.test(h) && !h.startsWith('https://raw.githubusercontent.com/guguluP/zero-grok-site/')));
  assert.ok(m.host_permissions.includes('https://raw.githubusercontent.com/guguluP/zero-grok-site/*'));
  assert.ok(m.optional_host_permissions.includes('https://www.perplexity.ai/*'));
  assert.equal(m.declarative_net_request, undefined);
  assert.deepEqual(m.background.scripts, ['background.js']);
  assert.ok(parseFloat(m.browser_specific_settings.gecko.strict_min_version) >= 113);
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.ok(m.web_accessible_resources.some((w) => w.resources.includes('assets/sounds/*')));
  assert.equal(m.commands['toggle-panel'].suggested_key.default, 'Alt+Shift+Z');
  for (const cs of m.content_scripts) for (const f of [...(cs.js || []), ...(cs.css || [])]) assert.ok(fs.existsSync(path.join(EXT, f)), f);
  for (const p of S.PROVIDERS.filter((x) => x.optional)) assert.ok(fs.existsSync(path.join(EXT, 'content', p.id + '.js')), p.id);
});

test('icons are real PNGs with the right sizes; can-pop.wav is a WAV', () => {
  for (const size of [16, 32, 48, 128]) {
    const b = fs.readFileSync(path.join(EXT, `assets/icons/icon${size}.png`));
    assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `icon${size} signature`);
    assert.equal(b.readUInt32BE(16), size);
    assert.equal(b.readUInt32BE(20), size);
  }
  const w = fs.readFileSync(path.join(EXT, 'assets/sounds/can-pop.wav'));
  assert.equal(w.subarray(0, 4).toString(), 'RIFF');
  assert.equal(w.subarray(8, 12).toString(), 'WAVE');
});

test('i18n: en/hi complete, placeholders match, every used key exists', () => {
  const en = readJson('_locales/en/messages.json');
  const hi = readJson('_locales/hi/messages.json');
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    const ph = (s) => (s.match(/\$\d/g) || []).sort().join();
    assert.equal(ph(hi[k].message), ph(en[k].message), k);
    assert.ok(!/\$(?!\d)/.test(en[k].message), `${k}: bare $ must be escaped`);
  }
  const used = new Set();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== '_locales') walk(p); continue; }
      if (!/\.(js|html|json)$/.test(f.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bkey:\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
    }
  };
  walk(EXT);
  const missing = [...used].filter((k) => !en[k]);
  assert.deepEqual(missing, []);
});

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
    claude: { remainingPercent: 10, updatedAt: now, source: 'org-usage' },
    gemini: { remainingPercent: 65, updatedAt: now, source: 'usage-page' },
    chatgpt: { remainingPercent: 90, updatedAt: now - 13 * HOUR, source: 'api-limit' }, // stale
    grok: { remainingPercent: 25, updatedAt: now, source: 'rate-limits' } // too low
  };
  const sg = S.suggestSwitch(by, S.DEFAULT_SETTINGS, 'claude', now);
  assert.equal(sg.to, 'gemini');
  assert.equal(sg.fromRemaining, 10);
  assert.equal(S.suggestSwitch(by, { ...S.DEFAULT_SETTINGS, enableGemini: false }, 'claude', now), null);
  assert.equal(S.suggestSwitch(by, S.DEFAULT_SETTINGS, 'gemini', now), null);
  const withEstimate = { ...by, perplexity: { remainingPercent: 95, updatedAt: now, source: 'estimate' } };
  assert.equal(S.suggestSwitch(withEstimate, { ...S.DEFAULT_SETTINGS, enablePerplexity: true }, 'claude', now).to, 'gemini', 'estimates are never suggested');
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
  assert.equal(m.commands['toggle-panel'].suggested_key.default, 'Alt+Shift+U');
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

// ------------------------------------------------------------------ UI tokens / contrast / composer avoidance
const readText = (p) => fs.readFileSync(path.join(EXT, p), 'utf8');
const hexRgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const parseColor = (v) => {
  v = v.trim();
  if (v.startsWith('#')) return [...hexRgb(v), 1];
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error('colour? ' + v);
  const p = m[1].split(',').map((x) => parseFloat(x));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
};
const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1); };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
function tokenBlocks() {
  const css = readText('utils/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const vars = (body) => Object.fromEntries([...body.matchAll(/(--zg-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = vars(blocks.find((b) => b.sel.startsWith('html.zg-page, .zg-panel')).body);
  const darkBlocks = blocks.filter((b) => /zg-theme-dark|:not\(\[data-theme="light"\]\)/.test(b.sel)).map((b) => vars(b.body));
  return { light, darkBlocks };
}

test('tokens: every text token is WCAG AA (>= 4.5:1) on surface and background, light and dark', () => {
  const { light, darkBlocks } = tokenBlocks();
  assert.equal(darkBlocks.length, 2, 'dark tokens for themed pages/panel + prefers-color-scheme');
  assert.deepEqual(darkBlocks[0], darkBlocks[1], 'both dark blocks must stay identical');
  const themes = { light, dark: { ...light, ...darkBlocks[0] } };
  const fails = [];
  for (const [name, t] of Object.entries(themes)) {
    const c = (k) => parseColor(t[k]);
    for (const bgKey of ['--zg-surface', '--zg-bg']) {
      for (const fg of ['--zg-text', '--zg-muted', '--zg-ok-text', '--zg-warn-text', '--zg-crit-text', '--zg-accent-text']) {
        const r = ratio(over(c(fg), c(bgKey)), c(bgKey));
        if (r < 4.5) fails.push(`${name} ${fg} on ${bgKey} = ${r.toFixed(2)}`);
      }
      // confidence chips: tinted background over the surface
      for (const [fg, bg] of [['--zg-official-text', '--zg-official-bg'], ['--zg-page-text', '--zg-page-bg'], ['--zg-estimate-text', '--zg-estimate-bg'], ['--zg-muted', '--zg-chip']]) {
        const back = over(c(bg), c(bgKey));
        const r = ratio(c(fg), back);
        if (r < 4.5) fails.push(`${name} ${fg} on ${bg}/${bgKey} = ${r.toFixed(2)}`);
      }
    }
    for (const [fg, bg] of [['--zg-on-primary', '--zg-primary'], ['--zg-on-accent', '--zg-accent'], ['--zg-btn-text', '--zg-btn'], ['--zg-crit-text', '--zg-btn']]) {
      const r = ratio(c(fg), c(bg));
      if (r < 4.5) fails.push(`${name} ${fg} on ${bg} = ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(fails, []);
});

test('tokens: text on the can (% pill + countdown pill) is >= 4.5:1 over bare metal and every brand liquid', () => {
  const { light } = tokenBlocks();
  const pill = parseColor(light['--zg-pill']);
  const ui = readText('content/can-ui.js');
  const liquids = [...ui.matchAll(/liquid: \['(#[0-9a-f]{6})', '(#[0-9a-f]{6})'\]/gi)].flatMap((m) => [m[1], m[2]]);
  assert.ok(liquids.length >= 18, 'brand liquids parsed: ' + liquids.length);
  const backdrops = ['#efefef', '#d0d0d0', ...liquids].map((h) => [...hexRgb(h), 1]);
  const css = readText('content/content.css');
  const textColours = new Set(['#fff']);
  for (const m of css.matchAll(/\.zg-(?:percent|secondary)[^{]*\{[^}]*?[^-]color:\s*(#[0-9a-f]{3,6})/gi)) textColours.add(m[1]);
  for (const m of css.matchAll(/\.zg-percent\.zg-\w+ \{ color: (#[0-9a-f]{6}); \}/gi)) textColours.add(m[1]);
  assert.ok(textColours.size >= 4, [...textColours].join());
  let min = 99;
  for (const b of backdrops) for (const fg of textColours) min = Math.min(min, ratio([...hexRgb(fg), 1], over(pill, b)));
  assert.ok(min >= 4.5, 'worst can text contrast ' + min.toFixed(2));
  assert.match(css, /\.zg-secondary \{[^}]*font: 600 11px/, 'countdown is 11px');
});

test('content.css: only transform/opacity are animated; no width transitions, no filter keyframes; reduced motion covered', () => {
  const css = readText('content/content.css');
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
    assert.doesNotMatch(m[2], /\b(filter|width|height|left|top|right|bottom|margin)\s*:/, 'keyframes ' + m[1]);
  }
  for (const m of css.matchAll(/transition:\s*([^;]+);/g)) {
    assert.doesNotMatch(m[1], /\b(width|height|left|top|right|bottom|filter|fill)\b/, 'transition ' + m[1]);
  }
  assert.doesNotMatch(css, /\.zg-panel\.zg-open\s*\{\s*display/, 'panel must not toggle display');
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const sel of ['.zg-panel', '.zg-bar', '.zg-can-root::before', '.zg-bubble']) assert.ok(rm.includes(sel), 'OS reduced motion covers ' + sel);
  for (const sel of ['.zg-panel.zg-reduce-motion', '.zg-can-root.zg-reduce-motion::before', '.zg-reduce-motion .zg-bubble']) assert.ok(css.includes(sel), 'setting covers ' + sel);
});

test('composer avoidance: bottom inset >= 96px, clears an overlapping composer, ignores far ones, never off-screen', async () => {
  const vm = await import('node:vm');
  const win = { innerWidth: 1280, innerHeight: 800, matchMedia: () => ({ matches: false }) };
  win.window = win; win.self = win;
  vm.createContext(win);
  vm.runInContext(readText('content/can-ui.js'), win);
  const UI = win.ZeroGrokCanUI;
  assert.equal(UI.BOTTOM_INSET, 96);
  assert.equal(UI.computeBottomInset('bottom-right', 72, 150, []), 96);
  // full-width composer whose top is 700px down (100px tall) → can bottom must sit 12px above it
  const composer = { left: 0, right: 1280, top: 700, bottom: 800 };
  assert.equal(UI.computeBottomInset('bottom-right', 72, 150, [composer]), 112);
  assert.equal(UI.computeBottomInset('bottom-left', 72, 150, [composer]), 112);
  // a composer only on the left half doesn't move a bottom-right can
  assert.equal(UI.computeBottomInset('bottom-right', 72, 150, [{ left: 0, right: 600, top: 600, bottom: 800 }]), 96);
  // an enormous composer: clamp so the can stays on screen (8px margin)
  assert.equal(UI.computeBottomInset('bottom-right', 72, 150, [{ left: 0, right: 1280, top: 100, bottom: 800 }]), 800 - 150 - 8);
  // liquid geometry: 0% = empty (y 108), 100% = full (y 20), unknown = empty
  assert.equal(UI.liquidY(0), 108); assert.equal(UI.liquidY(100), 20); assert.equal(UI.liquidY(50), 64); assert.equal(UI.liquidY(null), 108);
});

test('i18n: en and hi have the same keys and every new UI string is translated', () => {
  const en = readJson('_locales/en/messages.json'), hi = readJson('_locales/hi/messages.json');
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(en).sort());
  for (const k of ['usageMeterLabel', 'weeklyShort', 'expandHint', 'range7d', 'range30d']) {
    assert.ok(en[k] && hi[k] && hi[k].message !== en[k].message, k);
  }
  for (const page of ['popup/popup.html', 'options/options.html', 'onboarding/onboarding.html']) {
    const html = readText(page);
    for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="(\w+)"/g)) assert.ok(en[m[1]], page + ' uses missing key ' + m[1]);
    assert.match(html, /<html lang="en" class="zg-page">/, page + ' opts into shared tokens');
    assert.match(html, /utils\/tokens\.css/, page + ' loads tokens.css');
  }
});

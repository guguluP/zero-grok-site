// End-to-end tests: load the real extension in Chromium and serve fixture pages on the
// real provider origins via context.route(), so manifest content scripts inject naturally
// and their fetch() calls hit our mocks (page-world fetch mocks can't reach isolated worlds).
//
//   npm run test:e2e              (headless Chromium; set HEADED=1 to watch)
//   ARTIFACTS=/some/dir npm run test:e2e   (where screenshots go; default tests/artifacts)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_SRC = path.resolve(HERE, '../extension');
const ART = path.resolve(process.env.ARTIFACTS || path.join(HERE, 'artifacts'));
fs.mkdirSync(ART, { recursive: true });

const results = [];
let AREA = 'General';
const area = (a) => { AREA = a; console.log(`\n== ${a}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 10000, interval = 150, msg = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(interval);
  }
  throw new Error('timed out waiting for ' + msg + (last instanceof Error ? ': ' + last.message : ''));
}
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ area: AREA, name, pass: true });
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ area: AREA, name, pass: false, detail: e.message });
    console.log(`FAIL  ${name} — ${e.message}`);
  }
}
function assert(cond, message) { if (!cond) throw new Error(message || 'assertion failed'); }

// ------------------------------------------------------------------ fixtures / mocks
const mock = {
  grok: 'free',          // free | paid-json | paid-proto | broken | signedout
  grokLive: null,        // override for page-originated rate-limit calls
  claude: 'ok',          // ok | signedout
  chatgptDom: 'meter',   // meter | transcript | banner | none
  geminiUsage: 'ok'
};
const page = (title, body, extraHead = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${extraHead}</head>
<body style="margin:0;font-family:sans-serif;min-height:100vh"><main id="app"><h1>${title}</h1>${body}
<textarea id="prompt" aria-label="prompt"></textarea><button type="button" id="send" aria-label="Send message">Send</button></main></body></html>`;
// Realistic chat layout: sidebar + a message box fixed to the bottom of the viewport
// (like grok.com / claude.ai / chatgpt.com / gemini). Used for the can↔composer overlap checks.
const composerPage = (title, tall) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
  body{margin:0;font-family:system-ui,sans-serif;background:#0d0d0d;color:#eee;min-height:100vh}
  .sidebar{position:fixed;left:0;top:0;bottom:0;width:220px;background:#141414;border-right:1px solid #2a2a2a}
  #app{margin-left:220px;padding:24px 24px 160px}
  .composer{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:14px 20px;background:#1a1a1a;border-top:1px solid #333;z-index:10}
  #prompt{flex:1;min-height:${tall ? 120 : 44}px;border-radius:12px;border:1px solid #444;background:#111;color:#fff;padding:10px 14px}
  #send{padding:10px 18px;border-radius:12px;border:none;background:#c41e3a;color:#fff;font-weight:700}
  @media(max-width:500px){.sidebar{display:none}#app{margin-left:0}}
</style></head><body><aside class="sidebar"></aside><main id="app"><h1>${title}</h1><p>Chat transcript.</p></main>
<form class="composer"><textarea id="prompt" aria-label="Message"></textarea><button type="button" id="send" aria-label="Send message">Send</button></form></body></html>`;
const json = (route, obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
const html = (route, body, headers = {}) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body, headers });

function protoFrame(floatValue) {
  const f = Buffer.alloc(4); f.writeFloatLE(floatValue);
  const inner = Buffer.concat([Buffer.from([(1 << 3) | 5]), f]);
  const msg = Buffer.concat([Buffer.from([(1 << 3) | 0, 7, (3 << 3) | 2, inner.length]), inner]);
  const head = Buffer.alloc(5); head.writeUInt32BE(msg.length, 1);
  return Buffer.concat([head, msg]);
}

const GROK_LIMITS = {
  'grok-3|DEFAULT': { remainingQueries: 12, totalQueries: 40, windowSizeSeconds: 7200, waitTimeSeconds: 5400 },
  'grok-3|REASONING': { remainingQueries: 8, totalQueries: 20, windowSizeSeconds: 7200 }
};

async function handleRoute(route) {
  const req = route.request();
  const url = new URL(req.url());
  const host = url.hostname, p = url.pathname;
  if (p === '/zg-composer' || p === '/zg-composer-tall') {
    const tt = host === 'gemini.google.com' ? { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types default" } : {};
    return html(route, composerPage(host, p.endsWith('-tall')), tt);
  }
  // ---- Grok
  if (host === 'grok.com') {
    if (p === '/rest/rate-limits') {
      if (mock.grok === 'signedout') return json(route, { error: 'unauthenticated' }, 401);
      if (mock.grok !== 'free') return json(route, { error: 'nope' }, mock.grok === 'broken' ? 500 : 404);
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (_) {}
      if (mock.grokLive && req.headers()['x-test-live']) return json(route, mock.grokLive);
      const r = GROK_LIMITS[body.modelName + '|' + (body.requestKind || '')];
      return r ? json(route, r) : json(route, { error: 'unknown model' }, 404);
    }
    if (p.includes('GetGrokCreditsConfig')) {
      const ct = req.headers()['content-type'] || '';
      if (mock.grok === 'paid-json' && ct.includes('json')) return json(route, { config: { weeklyUsagePercent: 42.5, resetsAt: new Date(Date.now() + 3 * 86400000).toISOString() } });
      if (mock.grok === 'paid-proto' && ct.includes('grpc')) return route.fulfill({ status: 200, contentType: 'application/grpc-web+proto', body: protoFrame(37.5) });
      return route.fulfill({ status: mock.grok === 'broken' ? 500 : 415, body: '' });
    }
    return html(route, page('Grok', '<p>Ask anything.</p>'));
  }
  // ---- Claude
  if (host === 'claude.ai') {
    if (p === '/api/organizations') return mock.claude === 'signedout' ? json(route, { error: 'x' }, 401) : json(route, [{ uuid: 'org-1', name: 'Personal', capabilities: ['chat'] }]);
    if (p === '/api/organizations/org-1/usage') {
      return json(route, {
        five_hour: { utilization: 72.5, resets_at: new Date(Date.now() + 75 * 60000).toISOString() },
        seven_day: { utilization: 40, resets_at: new Date(Date.now() + 4 * 86400000).toISOString() },
        seven_day_opus: null
      });
    }
    return html(route, page('Claude', '<p>How can I help?</p>'));
  }
  // ---- ChatGPT
  if (host === 'chatgpt.com') {
    if (p === '/api/auth/session') return json(route, { accessToken: 'test-token' });
    if (p.startsWith('/backend-api/') || p.startsWith('/public-api/')) return json(route, { detail: 'not found' }, 404);
    const dom = {
      meter: '<div data-testid="usage-meter">GPT-5: 20% used</div>',
      transcript: '<article><p>User asked: what happens at 20% used of a quota? You have reached your limit is a phrase.</p></article>',
      banner: '<div role="alert">You\'ve hit the free plan limit for GPT-5. Resets in 3h 5m.</div>',
      none: ''
    }[mock.chatgptDom];
    return html(route, page('ChatGPT', dom));
  }
  // ---- Gemini (served with Trusted Types enforced like the real site)
  if (host === 'gemini.google.com') {
    const tt = { 'content-security-policy': "require-trusted-types-for 'script'; trusted-types default" };
    if (p.startsWith('/usage')) {
      return html(route, page('Gemini usage', `
        <section data-test-id="gxu-currently"><h2>Current window</h2><p>35% used</p><p>Resets in 2h 10m</p></section>
        <section data-test-id="gxu-weekly"><h2>Weekly limit</h2><p>18% used</p><p>Resets in 4 days</p></section>`), tt);
    }
    return html(route, page('Gemini', '<p>Our sales grew 35% this week, and 80% of users liked it.</p>'), tt);
  }
  // ---- optional providers
  if (host === 'www.perplexity.ai') return html(route, page('Perplexity', '<div class="remaining-searches">12 Pro searches left today</div>'));
  if (host === 'chat.deepseek.com') return html(route, page('DeepSeek', '<div role="alert">You have reached your daily message limit. Try again in 2 hours.</div>'));
  if (host === 'chat.mistral.ai') return html(route, page('Le Chat', '<div class="remaining-messages">5 messages left</div>'));
  if (host === 'www.meta.ai') return html(route, page('Meta AI', '<div role="status">You\'ve reached your daily limit. Come back tomorrow.</div>'));
  if (host === 'copilot.microsoft.com') return html(route, page('Copilot', '<p>Hi there.</p>'));
  return route.fulfill({ status: 404, body: 'not mocked' });
}

// ------------------------------------------------------------------ browser helpers
async function launch(extDir, label, opts = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zg-profile-' + label + '-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    locale: opts.locale,
    env: opts.locale ? { ...process.env, LANGUAGE: opts.locale.split('-')[0], LANG: opts.locale.replace('-', '_') + '.UTF-8' } : undefined,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-first-run', ...(opts.locale ? ['--lang=' + opts.locale] : [])]
  });
  await ctx.route(/^https:\/\/(grok\.com|claude\.ai|chatgpt\.com|gemini\.google\.com|www\.perplexity\.ai|chat\.deepseek\.com|copilot\.microsoft\.com|chat\.mistral\.ai|www\.meta\.ai)\//, handleRoute);
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(sw.url()).host;
  // The onboarding tab opens on install: close it so it doesn't steal focus.
  let onboardingOpened = false;
  for (let i = 0; i < 30 && !onboardingOpened; i++) {
    onboardingOpened = ctx.pages().some((p) => p.url().includes('/onboarding/onboarding.html'));
    if (!onboardingOpened) await sleep(100);
  }
  await sleep(300);
  for (const p of ctx.pages()) if (p.url().includes('/onboarding/')) await p.close();
  return { ctx, sw, id, base: `chrome-extension://${id}`, onboardingOpened };
}

const errorsOf = (pg) => {
  const errs = [];
  pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push(m.text()); });
  return errs;
};

async function extPage(env, rel) {
  const pg = await env.ctx.newPage();
  pg.__errs = errorsOf(pg);
  await pg.goto(env.base + rel);
  return pg;
}
const send = (pg, msg) => pg.evaluate((m) => chrome.runtime.sendMessage(m), msg);
const store = (pg, items) => pg.evaluate((i) => chrome.storage.local.set(i), items);
const getLocal = (pg, key) => pg.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k]), key);
const canSel = (id) => `.zg-can-root[data-provider="${id}"]`;
const canText = (pg, id) => pg.locator(canSel(id) + ' .zg-percent').textContent();

/** Overlap (px²) of the whole can box with the Send button, the textarea and the composer bar. */
const overlapOf = (pg, id) => pg.evaluate((sel) => {
  const can = document.querySelector(sel).getBoundingClientRect();
  const out = { area: 0 };
  for (const s of ['#send', '#prompt', '.composer']) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(can.right, r.right) - Math.max(can.left, r.left));
    const h = Math.max(0, Math.min(can.bottom, r.bottom) - Math.max(can.top, r.top));
    out[s] = Math.round(w * h);
    out.area += out[s];
  }
  const comp = document.querySelector('.composer');
  out.gap = comp ? Math.round(comp.getBoundingClientRect().top - can.bottom) : null;
  return out;
}, canSel(id));

/**
 * WCAG contrast of every visible text element matching `sels`, with real
 * compositing: translucent backgrounds are layered down to the first opaque
 * ancestor and element/ancestor opacity is applied to the text colour.
 * `backdrops` (hex list) = worst-case surfaces behind the element (for text on the can).
 */
const contrastAudit = (pg, sels, backdrops) => pg.evaluate(({ sels, backdrops }) => {
  const parse = (v) => {
    const m = v && v.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const rows = [];
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      if (!el.getClientRects().length || !(el.textContent || '').trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      let opacity = 1, layers = [], opaque = null;
      for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
        const c = getComputedStyle(cur);
        opacity *= parseFloat(c.opacity);
        if (!opaque) {
          const bg = parse(c.backgroundColor);
          if (bg && bg[3] > 0) { if (bg[3] >= 1) opaque = bg; else layers.push(bg); }
        }
      }
      const bases = backdrops && backdrops.length ? backdrops.map(hex) : [opaque || [255, 255, 255, 1]];
      const fg0 = parse(cs.color);
      let worst = 99;
      for (const base of bases) {
        let bg = base;
        for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
        const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * opacity], bg);
        worst = Math.min(worst, ratio(fg, bg));
      }
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      rows.push({ sel, text: el.textContent.trim().slice(0, 24), ratio: +worst.toFixed(2), need, pass: worst >= need });
    }
  }
  return rows;
}, { sels, backdrops: backdrops || null });
const auditSummary = (rows) => {
  const fails = rows.filter((r) => !r.pass);
  assert(rows.length, 'no text sampled');
  assert(!fails.length, 'contrast fails: ' + fails.map((f) => `${f.sel} "${f.text}" ${f.ratio}<${f.need}`).join('; '));
  return Math.min(...rows.map((r) => r.ratio)).toFixed(2);
};
// Behind text on the can: bare metal highlight + every brand's liquid colours.
const CAN_BACKDROPS = ['#efefef', '#d0d0d0', '#e63950', '#8b0a1a', '#d97757', '#8b4513', '#10a37f', '#0a5c48', '#4285f4', '#174ea6',
  '#20808d', '#0e4b53', '#4d6bfe', '#22359c', '#fa520f', '#9b2c00', '#0078d4', '#003e6b', '#0866ff', '#03307f'];
const sendToTab = (pg, urlPattern, msg) => pg.evaluate(async ({ urlPattern, msg }) => {
  const tabs = await chrome.tabs.query({ url: urlPattern });
  const newest = tabs.sort((a, b) => b.id - a.id)[0]; // the page the test just opened
  return chrome.tabs.sendMessage(newest.id, msg);
}, { urlPattern, msg });
/** Collect the liquid clip's y every frame for `ms` while `trigger` runs. */
async function sampleLiquid(pg, id, ms, trigger) {
  const sampling = pg.evaluate(({ sel, ms }) => new Promise((resolve) => {
    const rect = document.querySelector(sel + ' .zg-liquid-rect');
    const ys = [];
    const t0 = performance.now();
    const tick = (now) => { ys.push(+rect.getAttribute('y')); if (now - t0 < ms) requestAnimationFrame(tick); else resolve({ ys, target: +rect.getAttribute('data-zg-target-y') }); };
    requestAnimationFrame(tick);
  }), { sel: canSel(id), ms });
  await sleep(50);
  await trigger();
  return sampling;
}

async function site(env, url) {
  const pg = await env.ctx.newPage();
  pg.__errs = errorsOf(pg);
  await pg.goto(url);
  await pg.waitForSelector(canSel(new URL(url).hostname === 'grok.com' ? 'grok' : '') || 'body').catch(() => {});
  return pg;
}

// ------------------------------------------------------------------ suite
const env = await launch(EXT_SRC, 'main');
let ext; // extension page used to drive messages/storage

area('Install & core');
await check('service worker starts (MV3 module worker)', async () => {
  assert(env.sw.url().endsWith('/background.js'), env.sw.url());
  ext = await extPage(env, '/popup/popup.html');
  const v = await ext.evaluate(() => chrome.runtime.getManifest().version);
  assert(v === '1.5.0', 'version ' + v);
  return 'id ' + env.id;
});

await check('settings live in chrome.storage.sync after install', async () => {
  const s = await waitFor(() => ext.evaluate(() => chrome.storage.sync.get('zeroGrokSettings').then((r) => r.zeroGrokSettings)), { msg: 'sync settings' });
  assert(s.autoCheckUpdates === false, 'update checks must be opt-in');
  assert(s.estimateMessagesEnabled === false);
});

area('Updates');
await check('no update alarm unless opted in; 6h alarm after opting in', async () => {
  const none = await ext.evaluate(() => chrome.alarms.get('zeroGrokUpdateCheck'));
  assert(!none, 'alarm exists before opt-in');
  await send(ext, { type: 'SAVE_SETTINGS', payload: { autoCheckUpdates: true } });
  const a = await waitFor(() => ext.evaluate(() => chrome.alarms.get('zeroGrokUpdateCheck')), { msg: 'update alarm' });
  assert(a.periodInMinutes === 360, 'period ' + a.periodInMinutes);
  await send(ext, { type: 'SAVE_SETTINGS', payload: { autoCheckUpdates: false } });
  await waitFor(async () => !(await ext.evaluate(() => chrome.alarms.get('zeroGrokUpdateCheck'))), { msg: 'alarm cleared' });
});

area('Settings merge');
await check('SAVE_SETTINGS merges partial updates (no lost keys)', async () => {
  await send(ext, { type: 'SAVE_SETTINGS', payload: { pollIntervalMinutes: 3, plans: { claude: 'pro' } } });
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'dark' } });
  const s = await send(ext, { type: 'GET_SETTINGS' });
  assert(s.pollIntervalMinutes === 3 && s.theme === 'dark' && s.plans.claude === 'pro', JSON.stringify(s));
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'auto', pollIntervalMinutes: 5 } });
});

area('Install & core');
await check('icons + can-pop.wav load from the extension; wav is web-accessible on provider pages', async () => {
  for (const s of [16, 32, 48, 128]) {
    const sig = await ext.evaluate(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); return Array.from(b.slice(0, 4)).map((x) => x.toString(16).padStart(2, '0')).join(''); }, `/assets/icons/icon${s}.png`);
    assert(sig === '89504e47', `icon${s} ${sig}`);
  }
  const pg = await env.ctx.newPage();
  await pg.goto('https://grok.com/');
  const status = await pg.evaluate(async (u) => (await fetch(u)).status, `${env.base}/assets/sounds/can-pop.wav`);
  await pg.close();
  assert(status === 200, 'status ' + status);
});

// ---- Grok
area('Grok');
let grok;
await check('Grok: can mounts and shows official rate-limit % with per-model breakdown', async () => {
  grok = await env.ctx.newPage();
  grok.__errs = errorsOf(grok);
  await grok.goto('https://grok.com/');
  await grok.waitForSelector(canSel('grok'), { timeout: 10000 });
  await waitFor(async () => (await canText(grok, 'grok')) === '30%', { msg: 'grok 30% (got ' + (await canText(grok, 'grok').catch(() => '?')) + ')' });
  const cls = await grok.getAttribute(canSel('grok'), 'class');
  assert(/zg-can-root/.test(cls) && /zg-pos-bottom-right/.test(cls), 'classes: ' + cls);
  const sec = await grok.locator(canSel('grok') + ' .zg-secondary').textContent();
  assert(/↻ 1h 30m|↻ 1h 29m/.test(sec), 'countdown on can: ' + sec);
  const u = await waitFor(async () => (await getLocal(ext, 'zeroGrokUsage'))?.byProvider?.grok, { msg: 'stored usage' });
  assert(u.confidence === 'official' && u.breakdown.length === 2, JSON.stringify(u));
  return 'can "30%" + "' + sec + '"';
});

await check('Grok: panel has unique id, confidence chip, reset countdown and breakdown', async () => {
  await grok.click(canSel('grok') + ' .zg-percent');
  const panel = grok.locator('#zero-grok-panel-grok.zg-open');
  await panel.waitFor({ timeout: 5000 });
  assert((await grok.locator('[id="zero-grok-panel-grok"]').count()) === 1, 'duplicate panel ids');
  assert((await grok.locator('#zero-grok-panel').count()) === 0, 'legacy shared id still present');
  const big = await panel.locator('.zg-big-percent').textContent();
  const conf = await panel.locator('.zg-conf').textContent();
  const reset = await panel.locator('.zg-reset').textContent();
  const rows = await panel.locator('.zg-bd-row').allTextContents();
  assert(big === '30%', 'big ' + big);
  assert(conf === 'Site usage API', 'conf ' + conf);
  assert(/^Resets in 1h (29|30)m \(at /.test(reset), 'reset ' + reset);
  assert(rows.length === 2 && rows[0].includes('Fast') && rows[1].includes('Think'), rows.join('|'));
  await grok.screenshot({ path: path.join(ART, 'v15-grok-panel.png') });
  await grok.keyboard.press('Escape');
  await waitFor(async () => !(await grok.locator('#zero-grok-panel-grok.zg-open').count()), { msg: 'panel closed on Escape' });
});

await check('Grok: page-world hook forwards the page\'s own rate-limit responses (live update)', async () => {
  mock.grokLive = { remainingQueries: 2, totalQueries: 40, windowSizeSeconds: 7200 };
  await grok.evaluate(() => fetch('/rest/rate-limits', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-live': '1' }, body: JSON.stringify({ modelName: 'grok-3', requestKind: 'DEFAULT' }) }));
  await waitFor(async () => (await canText(grok, 'grok')) === '5%', { msg: 'live 5%' });
  mock.grokLive = null;
});

area('Can UX: SPA remount / drag / snap / minimize / hide');
await check('SPA: can re-mounts after the app wipes <body> and after pushState navigation', async () => {
  await grok.evaluate(() => { document.body.innerHTML = '<main><h1>new route</h1></main>'; });
  await grok.waitForSelector(canSel('grok'), { timeout: 3000 });
  await grok.evaluate(() => { document.body.replaceWith(document.createElement('body')); });
  await grok.waitForSelector(canSel('grok'), { timeout: 3000 });
  await grok.evaluate(() => history.pushState({}, '', '/c/123'));
  await sleep(800);
  assert((await grok.locator(canSel('grok')).count()) === 1, 'can count after nav');
});

await check('Drag: snaps to the nearest corner, free position elsewhere, persisted per site', async () => {
  const box = await grok.locator(canSel('grok')).boundingBox();
  await grok.mouse.move(box.x + box.width / 2, box.y + 20);
  await grok.mouse.down();
  await grok.mouse.move(400, 300, { steps: 6 });
  await grok.mouse.move(50, 60, { steps: 8 });
  await grok.mouse.up();
  await waitFor(async () => /zg-pos-top-left/.test(await grok.getAttribute(canSel('grok'), 'class')), { msg: 'top-left snap' });
  const saved = await grok.evaluate(() => localStorage.getItem('zeroGrokCanPos_grok'));
  assert(saved && JSON.parse(saved).corner === 'top-left', 'saved ' + saved);
  const b2 = await grok.locator(canSel('grok')).boundingBox();
  await grok.mouse.move(b2.x + b2.width / 2, b2.y + 20);
  await grok.mouse.down();
  await grok.mouse.move(640, 400, { steps: 8 });
  await grok.mouse.up();
  await waitFor(async () => /zg-pos-custom/.test(await grok.getAttribute(canSel('grok'), 'class')), { msg: 'custom position' });
  const cls = await grok.getAttribute(canSel('grok'), 'class');
  assert(/zg-can-root/.test(cls), 'root class kept: ' + cls);
  assert((await grok.locator('#zero-grok-panel-grok.zg-open').count()) === 0, 'drag must not open the panel');
  await grok.reload();
  await grok.waitForSelector(canSel('grok'));
  assert(/zg-pos-custom/.test(await grok.getAttribute(canSel('grok'), 'class')), 'position restored after reload');
});

await check('Minimize to dot and restore', async () => {
  await grok.hover(canSel('grok'));
  await grok.click(canSel('grok') + ' .zg-mini-btn');
  await waitFor(async () => /zg-mini/.test(await grok.getAttribute(canSel('grok'), 'class')), { msg: 'mini' });
  await grok.click(canSel('grok'));
  await waitFor(async () => !/zg-mini/.test(await grok.getAttribute(canSel('grok'), 'class')), { msg: 'restored' });
  assert((await grok.locator('#zero-grok-panel-grok.zg-open').count()) === 0, 'restore click must not open panel');
});

area('Shortcuts');
await check('Keyboard: TOGGLE_PANEL (Alt+Shift+U command) and Enter on the focused can open the panel', async () => {
  await grok.bringToFront();
  await env.sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PANEL' });
  });
  await grok.locator('#zero-grok-panel-grok.zg-open').waitFor({ timeout: 3000 });
  await grok.keyboard.press('Escape');
  await grok.focus(canSel('grok'));
  await grok.keyboard.press('Enter');
  await grok.locator('#zero-grok-panel-grok.zg-open').waitFor({ timeout: 3000 });
  await grok.keyboard.press('Escape');
});

await check('Shortcuts registered: Alt+Shift+U (panel), Alt+U (can); TOGGLE_CAN hides/shows the can', async () => {
  const cmds = await ext.evaluate(() => chrome.commands.getAll());
  const panel = cmds.find((c) => c.name === 'toggle-panel');
  const can = cmds.find((c) => c.name === 'toggle-can');
  assert(panel && /Alt\+Shift\+U/.test(panel.shortcut), 'toggle-panel ' + JSON.stringify(panel));
  assert(can && /Alt\+U/.test(can.shortcut), 'toggle-can ' + JSON.stringify(can));
  assert(panel.description === 'Open the usage panel on the current AI site', panel.description);
  const toggle = () => env.sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_CAN' });
  });
  await toggle();
  await waitFor(async () => !(await grok.locator(canSel('grok')).isVisible()), { msg: 'can hidden' });
  await toggle();
  await waitFor(async () => grok.locator(canSel('grok')).isVisible(), { msg: 'can visible' });
  return panel.shortcut + ' / ' + can.shortcut;
});

area('Can UX: SPA remount / drag / snap / minimize / hide');
await check('Hide on this site removes the can and is saved in settings', async () => {
  await grok.click(canSel('grok') + ' .zg-percent');
  await grok.locator('#zero-grok-panel-grok.zg-open button.zg-btn', { hasText: 'Hide on this site' }).click();
  await waitFor(async () => !(await grok.locator(canSel('grok')).isVisible()), { msg: 'hidden' });
  const s = await send(ext, { type: 'GET_SETTINGS' });
  assert(s.hiddenSites.includes('grok.com'), JSON.stringify(s.hiddenSites));
  await send(ext, { type: 'HIDE_SITE', host: 'grok.com', hidden: false });
  await waitFor(async () => grok.locator(canSel('grok')).isVisible(), { msg: 'shown again via storage change' });
});

area('Grok');
await check('Grok paid: explicit JSON usage → official weekly %', async () => {
  mock.grok = 'paid-json';
  await grok.reload();
  await waitFor(async () => (await canText(grok, 'grok')) === '58%', { msg: '58% (got ' + (await canText(grok, 'grok').catch(() => '?')) + ')' });
  const u = (await getLocal(ext, 'zeroGrokUsage')).byProvider.grok;
  assert(u.source === 'grpc-json' && u.confidence === 'official', JSON.stringify(u));
});

await check('Grok paid: protobuf fallback is labelled Estimate', async () => {
  mock.grok = 'paid-proto';
  await grok.reload();
  await waitFor(async () => (await canText(grok, 'grok')) === '63%', { msg: '63%' });
  await grok.click(canSel('grok') + ' .zg-percent');
  const p = grok.locator('#zero-grok-panel-grok.zg-open');
  await p.waitFor();
  assert((await p.locator('.zg-big-percent').textContent()) === '~63%');
  assert((await p.locator('.zg-conf').textContent()) === 'Estimate');
  assert(/treat as an estimate/.test(await p.locator('.zg-status').textContent()));
});

area('Health check / failure paths');
await check('Health check: repeated failures show "tracking needs an update" instead of a number', async () => {
  mock.grok = 'broken';
  await grok.reload();
  await grok.waitForSelector(canSel('grok'));
  for (let i = 0; i < 3; i++) {
    await env.sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
      await chrome.tabs.sendMessage(tabs[0].id, { type: 'SCRAPE_USAGE' });
    });
  }
  await waitFor(async () => (await canText(grok, 'grok')) === '?', { msg: '"?"' });
  const health = await waitFor(async () => (await getLocal(ext, 'zeroGrokHealth'))?.grok, { msg: 'health stored' });
  assert(health.status === 'needs-update', JSON.stringify(health));
  assert(/needs an update/.test(await grok.getAttribute(canSel('grok'), 'aria-label')));
  mock.grok = 'free';
});

await check('Grok signed out → sign-in hint, no fake number', async () => {
  mock.grok = 'signedout';
  await grok.reload();
  await grok.waitForSelector(canSel('grok'));
  await env.sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
    await chrome.tabs.sendMessage(tabs[0].id, { type: 'SCRAPE_USAGE' });
  });
  await grok.click(canSel('grok') + ' .zg-percent');
  const st = grok.locator('#zero-grok-panel-grok.zg-open .zg-status');
  await waitFor(async () => /Sign in to Grok/.test(await st.textContent()), { msg: 'sign-in text' });
  mock.grok = 'free';
  const errs = grok.__errs.filter((e) => !/401|404|415|500/.test(e));
  assert(!errs.length, errs.join(' | '));
  await grok.close();
});

area('Claude');
// ---- Claude
await check('Claude: org usage API → official %, weekly + 5-hour breakdown', async () => {
  const pg = await env.ctx.newPage();
  pg.__errs = errorsOf(pg);
  await pg.goto('https://claude.ai/new');
  await pg.waitForSelector(canSel('claude'));
  await waitFor(async () => (await canText(pg, 'claude')) === '28%', { msg: 'claude 28%' });
  await pg.click(canSel('claude') + ' .zg-percent');
  const p = pg.locator('#zero-grok-panel-claude.zg-open');
  await p.waitFor();
  const rows = await p.locator('.zg-bd-row').allTextContents();
  assert(rows.some((r) => r.startsWith('5-hour session')) && rows.some((r) => r.startsWith('Weekly')), rows.join('|'));
  assert((await p.locator('.zg-conf').textContent()) === 'Site usage API');
  assert((await pg.locator('[id^="zero-grok-panel-"]').count()) === 1);
  await pg.close();
});

area('ChatGPT');
// ---- ChatGPT
await check('ChatGPT: on-page usage meter → "Read from page"', async () => {
  mock.chatgptDom = 'meter';
  const pg = await env.ctx.newPage();
  await pg.goto('https://chatgpt.com/');
  await pg.waitForSelector(canSel('chatgpt'));
  await waitFor(async () => (await canText(pg, 'chatgpt')) === '80%', { msg: 'chatgpt 80%' });
  const u = (await getLocal(ext, 'zeroGrokUsage')).byProvider.chatgpt;
  assert(u.confidence === 'page', JSON.stringify(u));
  await pg.close();
});

await check('ChatGPT: chat transcript text is NOT mistaken for a limit (no false positives)', async () => {
  mock.chatgptDom = 'transcript';
  await store(ext, { zeroGrokUsage: { byProvider: {} } });
  const pg = await env.ctx.newPage();
  await pg.goto('https://chatgpt.com/');
  await pg.waitForSelector(canSel('chatgpt'));
  await sleep(2500);
  assert((await canText(pg, 'chatgpt')) === '--%', 'got ' + (await canText(pg, 'chatgpt')));
  await pg.click(canSel('chatgpt') + ' .zg-percent');
  const st = await pg.locator('#zero-grok-panel-chatgpt.zg-open .zg-status').textContent();
  assert(/No live meter/.test(st), st);
  await pg.close();
});

await check('ChatGPT: limit banner → 0% with reset countdown', async () => {
  mock.chatgptDom = 'banner';
  const pg = await env.ctx.newPage();
  await pg.goto('https://chatgpt.com/');
  await pg.waitForSelector(canSel('chatgpt'));
  await waitFor(async () => /zg-at-limit/.test(await pg.getAttribute(canSel('chatgpt'), 'class')), { msg: 'at limit' });
  const u = (await getLocal(ext, 'zeroGrokUsage')).byProvider.chatgpt;
  assert(u.remainingPercent === 0, JSON.stringify(u));
  await pg.close();
});

area('Local estimates');
await check('Local estimate (opt-in): counting sent messages, clearly labelled', async () => {
  mock.chatgptDom = 'none';
  await send(ext, { type: 'SAVE_SETTINGS', payload: { estimateMessagesEnabled: true, plans: { chatgpt: 'free' } } });
  await store(ext, { zeroGrokUsage: { byProvider: {} } });
  const pg = await env.ctx.newPage();
  await pg.goto('https://chatgpt.com/');
  await pg.waitForSelector(canSel('chatgpt'));
  await sleep(2200);
  await pg.fill('#prompt', 'hello');
  await pg.press('#prompt', 'Enter');
  await waitFor(async () => /zg-estimate/.test(await pg.getAttribute(canSel('chatgpt'), 'class')), { msg: 'estimate class' });
  await pg.click(canSel('chatgpt') + ' .zg-percent');
  const p = pg.locator('#zero-grok-panel-chatgpt.zg-open');
  await p.waitFor();
  assert((await p.locator('.zg-conf').textContent()) === 'Estimate');
  assert((await p.locator('.zg-big-percent').textContent()).startsWith('~'));
  await send(ext, { type: 'SAVE_SETTINGS', payload: { estimateMessagesEnabled: false } });
  await pg.close();
});

area('Gemini');
// ---- Gemini (Trusted Types enforced)
await check('Gemini /usage under Trusted Types: mounts without errors, reads current + weekly', async () => {
  const pg = await env.ctx.newPage();
  const errs = errorsOf(pg);
  await pg.goto('https://gemini.google.com/usage');
  await pg.waitForSelector(canSel('gemini'));
  await waitFor(async () => (await canText(pg, 'gemini')) === '65%', { msg: 'gemini 65%' });
  const sec = await pg.locator(canSel('gemini') + ' .zg-secondary').textContent();
  assert(/↻ 2h (9|10)m/.test(sec), 'secondary ' + sec);
  const u = (await getLocal(ext, 'zeroGrokUsage')).byProvider.gemini;
  assert(u.weeklyRemaining === 82 && u.confidence === 'page', JSON.stringify(u));
  const tt = errs.filter((e) => /TrustedHTML|Trusted Type|innerHTML/i.test(e));
  assert(!tt.length, tt.join(' | '));
  await pg.close();
});

await check('Gemini chat page: percentages in the conversation are ignored; cached /usage reading reused', async () => {
  const before = (await getLocal(ext, 'zeroGrokUsage')).byProvider.gemini;
  const pg = await env.ctx.newPage();
  await pg.route('https://gemini.google.com/usage', (r) => r.fulfill({ status: 500, body: '' }));
  await pg.goto('https://gemini.google.com/app');
  await pg.waitForSelector(canSel('gemini'));
  await sleep(2500);
  const txt = await canText(pg, 'gemini');
  assert(txt === '65%', 'expected cached 65%, got ' + txt);
  const after = (await getLocal(ext, 'zeroGrokUsage')).byProvider.gemini;
  assert(after.remainingPercent === before.remainingPercent, 'chat text changed the reading');
  await pg.close();
});


area('Alerts / quiet hours / badge');
async function spyNotifications() {
  await env.sw.evaluate(() => {
    globalThis.__zgNotes = [];
    if (!globalThis.__zgSpy) {
      const orig = chrome.notifications.create.bind(chrome.notifications);
      chrome.notifications.create = (id, opts, cb) => { globalThis.__zgNotes.push({ id, ...opts }); return orig(id, opts, cb || (() => {})); };
      globalThis.__zgSpy = true;
    }
  });
}
const notes = () => env.sw.evaluate(() => globalThis.__zgNotes || []);
const quietAroundNow = () => env.sw.evaluate(() => {
  const f = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return { quietHoursEnabled: true, quietStart: f(new Date(Date.now() - 3600000)), quietEnd: f(new Date(Date.now() + 3600000)) };
});

await check('Threshold alert fires once at the highest crossed level (custom thresholds, deduped, with switch suggestion)', async () => {
  await spyNotifications();
  await send(ext, { type: 'SAVE_SETTINGS', payload: { alertThresholds: [60, 90], quietHoursEnabled: false, suggestSwitch: true } });
  await store(ext, { zeroGrokLastAlert: {} });
  await send(ext, { type: 'USAGE_DATA', payload: { provider: 'gemini', usedPercent: 20, remainingPercent: 80, source: 'usage-page' } });
  await send(ext, { type: 'USAGE_DATA', payload: { provider: 'claude', usedPercent: 92, remainingPercent: 8, source: 'org-usage' } });
  const n = await waitFor(async () => (await notes()).find((x) => x.id === 'zero-grok-alert-claude:90'), { msg: 'claude:90 notification' });
  assert(/used 92% of your Claude allowance/.test(n.message), n.message);
  assert(/Gemini has 80% left/.test(n.message), 'switch suggestion in alert: ' + n.message);
  await send(ext, { type: 'USAGE_DATA', payload: { provider: 'claude', usedPercent: 94, remainingPercent: 6, source: 'org-usage' } });
  await sleep(300);
  assert((await notes()).filter((x) => x.id.startsWith('zero-grok-alert-claude')).length === 1, 'dedupe failed');
  return n.title;
});

await check('Quiet hours suppress threshold alerts; estimates never alert', async () => {
  await spyNotifications();
  await send(ext, { type: 'SAVE_SETTINGS', payload: await quietAroundNow() });
  await send(ext, { type: 'USAGE_DATA', payload: { provider: 'grok', usedPercent: 95, remainingPercent: 5, source: 'rate-limits' } });
  await sleep(400);
  assert(!(await notes()).length, 'notified during quiet hours: ' + JSON.stringify(await notes()));
  const last = await getLocal(ext, 'zeroGrokLastAlert');
  assert(last['grok:90'], 'quiet alert should still be recorded (no burst afterwards)');
  await send(ext, { type: 'SAVE_SETTINGS', payload: { quietHoursEnabled: false } });
  await send(ext, { type: 'USAGE_DATA', payload: { provider: 'chatgpt', usedPercent: 99, remainingPercent: 1, count: 40, source: 'estimate' } });
  await sleep(400);
  assert(!(await notes()).some((x) => x.id.includes('chatgpt')), 'estimate triggered an alert');
});

await check('Limit-reset notification (per-provider alarm), muted in quiet hours and when turned off', async () => {
  await spyNotifications();
  await send(ext, { type: 'SAVE_SETTINGS', payload: await quietAroundNow() });
  await env.sw.evaluate(() => chrome.alarms.create('zeroGrokReset:claude', { when: Date.now() + 300 }));
  await sleep(2000);
  assert(!(await notes()).some((x) => x.id === 'zero-grok-reset-claude'), 'reset notified in quiet hours');
  await send(ext, { type: 'SAVE_SETTINGS', payload: { quietHoursEnabled: false, notifyOnReset: false } });
  await env.sw.evaluate(() => chrome.alarms.create('zeroGrokReset:claude', { when: Date.now() + 300 }));
  await sleep(2000);
  assert(!(await notes()).some((x) => x.id === 'zero-grok-reset-claude'), 'reset notified while turned off');
  await send(ext, { type: 'SAVE_SETTINGS', payload: { notifyOnReset: true } });
  await env.sw.evaluate(() => chrome.alarms.create('zeroGrokReset:claude', { when: Date.now() + 300 }));
  const n = await waitFor(async () => (await notes()).find((x) => x.id === 'zero-grok-reset-claude'), { msg: 'reset notification' });
  assert(/Claude limit has reset/.test(n.message), n.message);
});

await check('A reading with a reset time schedules the reset alarm', async () => {
  const at = Date.now() + 2 * 3600000;
  await send(ext, { type: 'USAGE_DATA', payload: { provider: 'gemini', usedPercent: 30, remainingPercent: 70, resetAt: at, source: 'usage-page' } });
  const a = await waitFor(() => ext.evaluate(() => chrome.alarms.get('zeroGrokReset:gemini')), { msg: 'reset alarm' });
  assert(Math.abs(a.scheduledTime - (at + 15000)) < 2000, 'scheduled ' + a.scheduledTime);
});

await check('Badge modes: lowest / specific provider / off; estimates excluded', async () => {
  const badge = () => env.sw.evaluate(() => chrome.action.getBadgeText({}));
  await send(ext, { type: 'SAVE_SETTINGS', payload: { badgeMode: 'lowest' } });
  const low = await badge();
  assert(low === 'LOW', 'lowest (grok 5%) → ' + low);
  await send(ext, { type: 'SAVE_SETTINGS', payload: { badgeMode: 'gemini' } });
  assert((await badge()) === '70%', 'gemini → ' + (await badge()));
  await send(ext, { type: 'SAVE_SETTINGS', payload: { badgeMode: 'chatgpt' } });
  assert((await badge()) === '', 'estimate-only provider must not show a badge');
  await send(ext, { type: 'SAVE_SETTINGS', payload: { badgeMode: 'off' } });
  assert((await badge()) === '', 'off');
  await send(ext, { type: 'SAVE_SETTINGS', payload: { badgeMode: 'lowest', alertThresholds: [70, 90, 100] } });
  return 'LOW / 70% / "" / ""';
});

area('Multi-tab');
await check('Several AI tabs at once: one can per tab for its own provider; "Refresh all" updates every tab', async () => {
  mock.grok = 'free';
  const t1 = await env.ctx.newPage(); await t1.goto('https://grok.com/');
  const t2 = await env.ctx.newPage(); await t2.goto('https://grok.com/c/abc');
  const t3 = await env.ctx.newPage(); await t3.goto('https://claude.ai/new');
  for (const [pg, id] of [[t1, 'grok'], [t2, 'grok'], [t3, 'claude']]) await pg.waitForSelector(canSel(id));
  await waitFor(async () => (await canText(t1, 'grok')) === '30%' && (await canText(t2, 'grok')) === '30%', { msg: 'both grok tabs 30%' });
  for (const pg of [t1, t2, t3]) assert((await pg.locator('.zg-can-root').count()) === 1, 'exactly one can per tab');
  GROK_LIMITS['grok-3|DEFAULT'].remainingQueries = 20;
  GROK_LIMITS['grok-3|REASONING'].remainingQueries = 16;
  const pop = await extPage(env, '/popup/popup.html');
  await pop.click('#refresh');
  await waitFor(async () => (await canText(t1, 'grok')) === '50%' && (await canText(t2, 'grok')) === '50%', { timeout: 12000, msg: 'both tabs refreshed to 50%' });
  GROK_LIMITS['grok-3|DEFAULT'].remainingQueries = 12;
  GROK_LIMITS['grok-3|REASONING'].remainingQueries = 8;
  for (const pg of [t1, t2, t3, pop]) await pg.close();
});

area('Popup: history / forecast / countdown / share / update banner');
// ---- Popup / options / onboarding
await check('Popup: cards, confidence chips, reset, forecast, suggestion, 7/30-day chart', async () => {
  const now = Date.now();
  const hist = [];
  for (let d = 0; d < 20; d++) hist.push({ provider: 'claude', at: now - d * 86400000 - 3600000, usedPercent: 30 + (d % 5) * 10, remainingPercent: 70 - (d % 5) * 10, source: 'org-usage' });
  for (let i = 0; i < 4; i++) hist.push({ provider: 'grok', at: now - (3 - i) * 20 * 60000, usedPercent: 40 + i * 10, remainingPercent: 60 - i * 10, source: 'rate-limits' });
  await store(ext, {
    zeroGrokHistory: hist,
    zeroGrokHealth: {},
    zeroGrokUsage: { byProvider: {
      grok: { provider: 'grok', remainingPercent: 30, usedPercent: 70, source: 'rate-limits', confidence: 'official', windowHint: 'Fast · 2h rolling window', resetAt: now + 3 * 3600000, updatedAt: now, breakdown: [{ label: 'Fast', remainingPercent: 30 }, { label: 'Think', remainingPercent: 40 }] },
      claude: { provider: 'claude', remainingPercent: 12, usedPercent: 88, source: 'org-usage', confidence: 'official', windowHint: '5-hour session', resetAt: now + 75 * 60000, updatedAt: now },
      chatgpt: { provider: 'chatgpt', count: 4, source: 'estimate', confidence: 'estimate', windowHint: 'Local count · last 3h', updatedAt: now },
      gemini: { provider: 'gemini', remainingPercent: 65, usedPercent: 35, source: 'usage-page', confidence: 'page', windowHint: 'Current window', updatedAt: now }
    } }
  });
  const pg = await extPage(env, '/popup/popup.html');
  await pg.setViewportSize({ width: 380, height: 760 });
  await pg.waitForSelector('.provider-card[data-provider="grok"]');
  const cards = await pg.locator('.provider-card').count();
  assert(cards === 4, 'cards ' + cards);
  assert((await pg.locator('.provider-card[data-provider="grok"] .pc-pct').textContent()) === '30%');
  assert((await pg.locator('.provider-card[data-provider="grok"] .conf').textContent()) === 'Site usage API');
  assert((await pg.locator('.provider-card[data-provider="gemini"] .conf').textContent()) === 'Read from page');
  assert((await pg.locator('.provider-card[data-provider="chatgpt"] .conf').textContent()) === 'Estimate');
  assert(/Resets in 2h (59|60)m|Resets in 3h 0m/.test(await pg.locator('.provider-card[data-provider="grok"] .pc-sub').textContent()));
  assert(/hit zero/.test(await pg.locator('.provider-card[data-provider="grok"] .pc-forecast').textContent()), 'forecast missing');
  assert(/Claude is at 12% — Gemini has 65% left/.test(await pg.locator('#suggest-banner').textContent()));
  await pg.selectOption('#history-provider', 'claude');
  assert((await pg.locator('#chart svg rect').count()) === 7, '7 bars');
  await pg.click('.seg button[data-days="30"]');
  assert((await pg.locator('#chart svg rect').count()) === 30, '30 bars');
  assert(/days with data/.test(await pg.locator('#chart-caption').textContent()));
  assert(/No servers, no analytics/.test(await pg.locator('.privacy').textContent()));
  await pg.click('.seg button[data-days="7"]');
  await pg.screenshot({ path: path.join(ART, 'v15-popup.png'), fullPage: true });
  const errs = pg.__errs;
  assert(!errs.length, errs.join(' | '));
  ext.__popup = pg;
});

await check('Popup: needs-update health replaces the number with "?"', async () => {
  const pg = ext.__popup;
  await store(pg, { zeroGrokHealth: { gemini: { status: 'needs-update', since: Date.now() + 1000, at: Date.now() } } });
  await waitFor(async () => (await pg.locator('.provider-card[data-provider="gemini"] .pc-pct').textContent()) === '?', { msg: '"?"' });
  assert(/tracking needs an update/.test(await pg.locator('.provider-card[data-provider="gemini"] .pc-warn').textContent()));
  await store(pg, { zeroGrokHealth: {} });
});

await check('Popup: share card downloads a PNG made locally', async () => {
  const pg = ext.__popup;
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 8000 }), pg.click('#share')]);
  const file = path.join(ART, 'v15-share-card.png');
  await dl.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 4).toString('hex');
  assert(head === '89504e47', 'not a png: ' + head);
  return dl.suggestedFilename();
});

await check('Popup: update banner only when opted in and a newer version is known', async () => {
  const pg = ext.__popup;
  await store(pg, { zeroGrokUpdate: { available: true, latest: '9.9.9', current: '1.5.0', zipUrl: 'https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip', checkedAt: Date.now() } });
  await pg.reload();
  await pg.waitForSelector('.provider-card');
  assert(await pg.locator('#update-banner').isHidden(), 'banner shown while opted out');
  await send(pg, { type: 'SAVE_SETTINGS', payload: { autoCheckUpdates: true } });
  await pg.reload();
  await pg.locator('#update-banner').waitFor({ state: 'visible' });
  assert(/9\.9\.9/.test(await pg.locator('#update-title').textContent()), 'title: ' + (await pg.locator('#update-title').textContent()));
  await pg.click('#update-dismiss');
  await pg.locator('#update-banner').waitFor({ state: 'hidden', timeout: 5000 });
  const dism = await getLocal(pg, 'zeroGrokUpdate');
  assert(dism && dism.dismissedVersion === '9.9.9', 'dismissed version stored: ' + JSON.stringify(dism));
  await pg.reload();
  await pg.waitForSelector('.provider-card');
  assert(await pg.locator('#update-banner').isHidden(), 'dismissed version shown again');
  await send(pg, { type: 'SAVE_SETTINGS', payload: { autoCheckUpdates: false } });
  await store(pg, { zeroGrokUpdate: null });
  await pg.close();
});

area('Options & export');
await check('Options: save round-trip, threshold validation, quiet hours, badge mode', async () => {
  const pg = await extPage(env, '/options/options.html');
  await pg.waitForSelector('#provider-list input[type="checkbox"]');
  assert(await pg.locator('#updates').isVisible(), 'Updates section');
  assert((await pg.locator('#provider-list input[type="checkbox"]').count()) === 9, 'nine providers listed');
  await pg.fill('#thresholds', 'abc, 500');
  await pg.click('#save');
  assert(/1 to 100/.test(await pg.locator('#thresholds-error').textContent()), 'validation message');
  await pg.fill('#thresholds', '50, 85, 100');
  await pg.selectOption('#position', 'top-left');
  await pg.selectOption('#theme', 'dark');
  await pg.check('#quietHoursEnabled');
  await pg.fill('#quietStart', '23:00');
  await pg.fill('#quietEnd', '06:30');
  await pg.selectOption('#badgeMode', 'claude');
  await pg.fill('#poll', '7');
  await pg.uncheck('#enableGemini');
  await pg.click('#save');
  await waitFor(async () => /Saved/.test(await pg.locator('#saved').textContent()), { msg: 'saved flash' });
  const s = await send(pg, { type: 'GET_SETTINGS' });
  assert(JSON.stringify(s.alertThresholds) === '[50,85,100]', 'thresholds ' + s.alertThresholds);
  assert(s.canPosition === 'top-left' && s.theme === 'dark' && s.quietHoursEnabled && s.quietStart === '23:00' && s.quietEnd === '06:30', JSON.stringify(s));
  assert(s.badgeMode === 'claude' && s.pollIntervalMinutes === 7 && s.enableGemini === false, JSON.stringify(s));
  assert(s.plans.claude === 'pro', 'plan from earlier partial save was kept');
  const alarm = await pg.evaluate(() => chrome.alarms.get('zeroGrokPoll'));
  assert(alarm && alarm.periodInMinutes === 7, 'poll alarm ' + JSON.stringify(alarm));
  await pg.reload();
  await pg.waitForSelector('#provider-list input');
  assert((await pg.inputValue('#thresholds')).replace(/\s/g, '') === '50,85,100');
  assert(!(await pg.isChecked('#enableGemini')));
  await pg.check('#enableGemini');
  await pg.selectOption('#theme', 'light');
  await pg.click('#save');
  await sleep(400);
  await pg.setViewportSize({ width: 820, height: 1900 });
  await pg.screenshot({ path: path.join(ART, 'v15-options.png') });
  ext.__options = pg;
});

await check('Options: CSV and JSON export download local files', async () => {
  const pg = ext.__options;
  const [csv] = await Promise.all([pg.waitForEvent('download'), pg.click('#exportCsv')]);
  const f = path.join(ART, 'export.csv');
  await csv.saveAs(f);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert(lines[0].startsWith('timestamp_iso,provider,used_percent'), lines[0]);
  assert(lines.length > 10, 'rows ' + lines.length);
  const [js] = await Promise.all([pg.waitForEvent('download'), pg.click('#exportJson')]);
  const fj = path.join(ART, 'export.json');
  await js.saveAs(fj);
  const parsed = JSON.parse(fs.readFileSync(fj, 'utf8'));
  assert(parsed && typeof parsed === 'object', 'json');
  return `${lines.length - 1} CSV rows`;
});

await check('Options: clear history asks first, then empties local history', async () => {
  const pg = ext.__options;
  pg.once('dialog', (d) => d.dismiss());
  await pg.click('#clearHistory');
  await sleep(300);
  assert((await getLocal(pg, 'zeroGrokHistory')).length > 0, 'cleared despite cancel');
  pg.once('dialog', (d) => d.accept());
  await pg.click('#clearHistory');
  await waitFor(async () => (await getLocal(pg, 'zeroGrokHistory')).length === 0, { msg: 'history cleared' });
  await pg.close();
});


area('Themes & reduce motion');
const isDark = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) < 100; };
await check('Dark theme + reduce motion apply to popup, can and panel; light switches live', async () => {
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'dark', reduceMotion: true } });
  const pop = await extPage(env, '/popup/popup.html');
  await pop.waitForSelector('.provider-card');
  assert((await pop.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  const bg = await pop.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(isDark(bg), 'popup background not dark: ' + bg);
  assert(await pop.evaluate(() => document.documentElement.classList.contains('reduce-motion')));
  await pop.setViewportSize({ width: 380, height: 760 });
  await pop.screenshot({ path: path.join(ART, 'v15-popup-dark.png'), fullPage: true });
  const g = await env.ctx.newPage();
  await g.goto('https://grok.com/');
  await g.waitForSelector(canSel('grok'));
  await waitFor(async () => /zg-theme-dark/.test(await g.getAttribute(canSel('grok'), 'class')), { msg: 'can dark' });
  assert(/zg-reduce-motion/.test(await g.getAttribute(canSel('grok'), 'class')), 'reduce-motion class');
  const anim = await g.evaluate((sel) => getComputedStyle(document.querySelector(sel)).animationName, canSel('grok'));
  assert(anim === 'none', 'can still animates: ' + anim);
  await g.click(canSel('grok') + ' .zg-percent');
  await g.locator('#zero-grok-panel-grok.zg-open').waitFor();
  const panelBg = await g.evaluate(() => getComputedStyle(document.querySelector('#zero-grok-panel-grok')).backgroundColor);
  assert(isDark(panelBg), 'panel not dark: ' + panelBg);
  await g.screenshot({ path: path.join(ART, 'v15-grok-panel-dark.png') });
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'light', reduceMotion: false } });
  await waitFor(async () => /zg-theme-light/.test(await g.getAttribute(canSel('grok'), 'class')), { msg: 'can light (live)' });
  await waitFor(async () => !isDark(await g.evaluate(() => getComputedStyle(document.querySelector('#zero-grok-panel-grok')).backgroundColor)), { msg: 'panel light (live)' });
  assert(!/zg-reduce-motion/.test(await g.getAttribute(canSel('grok'), 'class')));
  await g.close(); await pop.close();
});

await check('Auto theme follows the system colour scheme', async () => {
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'auto' } });
  const pop = await extPage(env, '/popup/popup.html');
  await pop.emulateMedia({ colorScheme: 'dark' });
  await pop.waitForSelector('.provider-card');
  assert(isDark(await pop.evaluate(() => getComputedStyle(document.body).backgroundColor)), 'auto+dark');
  await pop.emulateMedia({ colorScheme: 'light' });
  assert(!isDark(await pop.evaluate(() => getComputedStyle(document.body).backgroundColor)), 'auto+light');
  await pop.close();
});

area('UI polish: composer overlap / contrast / motion / a11y');
await check('Overlap: the can never covers the message box or Send (4 providers × 2 bottom corners, 360px viewport, tall composer)', async () => {
  const out = [];
  for (const corner of ['bottom-right', 'bottom-left']) {
    await send(ext, { type: 'SAVE_SETTINGS', payload: { canPosition: corner } });
    for (const [host, id] of [['grok.com', 'grok'], ['claude.ai', 'claude'], ['chatgpt.com', 'chatgpt'], ['gemini.google.com', 'gemini']]) {
      const pg = await env.ctx.newPage();
      await pg.goto(`https://${host}/zg-composer`);
      await pg.evaluate((pid) => { localStorage.removeItem('zeroGrokCanPos_' + pid); localStorage.removeItem('zeroGrokCanMini_' + pid); }, id);
      await pg.reload();
      await pg.waitForSelector(canSel(id));
      await waitFor(async () => new RegExp('zg-pos-' + corner).test(await pg.getAttribute(canSel(id), 'class')), { msg: id + ' at ' + corner });
      const ov = await waitFor(async () => { const o = await overlapOf(pg, id); return o.area === 0 ? o : null; }, { timeout: 4000, msg: `${id} ${corner} overlap 0 (got ${JSON.stringify(await overlapOf(pg, id))})` });
      assert(ov.gap >= 8, `${id} ${corner}: gap above composer ${ov.gap}px`);
      out.push(`${id}/${corner}:gap ${ov.gap}`);
      if (id === 'grok' && corner === 'bottom-right') {
        await pg.setViewportSize({ width: 360, height: 720 });
        const small = await waitFor(async () => { const o = await overlapOf(pg, id); return o.area === 0 ? o : null; }, { timeout: 4000, msg: 'overlap 0 at 360px' });
        out.push('grok/360px:gap ' + small.gap);
        await pg.setViewportSize({ width: 1280, height: 800 });
        await pg.goto('https://grok.com/zg-composer-tall');
        await pg.waitForSelector(canSel('grok'));
        const tall = await waitFor(async () => { const o = await overlapOf(pg, id); return o.area === 0 ? o : null; }, { timeout: 4000, msg: 'overlap 0 above a tall composer' });
        assert(tall.gap >= 8 && tall.gap <= 20, 'tall composer gap ' + tall.gap);
        out.push('grok/tall:gap ' + tall.gap);
      }
      await pg.close();
    }
  }
  await send(ext, { type: 'SAVE_SETTINGS', payload: { canPosition: 'bottom-right' } });
  return out.join(', ');
});

await check('Contrast: popup text is WCAG AA in light and dark (warn/crit %, chips, Refresh button)', async () => {
  const now = Date.now();
  await store(ext, { zeroGrokUsage: { byProvider: {
    grok: { provider: 'grok', remainingPercent: 30, usedPercent: 70, source: 'rate-limits', updatedAt: now, resetAt: now + 3 * 3600000 },
    claude: { provider: 'claude', remainingPercent: 8, usedPercent: 92, source: 'org-usage', updatedAt: now },
    chatgpt: { provider: 'chatgpt', remainingPercent: 80, usedPercent: 20, source: 'estimate', updatedAt: now },
    gemini: { provider: 'gemini', remainingPercent: 65, usedPercent: 35, source: 'usage-page', updatedAt: now }
  } }, zeroGrokHealth: {} });
  const sels = ['h1', '.sub', '.pc-name', '.pc-pct', '.conf', '.pc-sub', '.pc-forecast', '.chart-caption', '.actions button', '.privacy', '.seg button', '.history-head h2'];
  const mins = [];
  for (const theme of ['light', 'dark']) {
    await send(ext, { type: 'SAVE_SETTINGS', payload: { theme } });
    const pop = await extPage(env, '/popup/popup.html');
    await pop.waitForSelector('.pc-pct.critical');
    await pop.waitForSelector('.pc-pct.warn');
    const rows = await contrastAudit(pop, sels);
    assert(rows.some((r) => r.sel === '.pc-pct' && r.text === '30%') && rows.some((r) => r.sel === '.actions button'), 'sampled warn % + buttons');
    mins.push(theme + ' min ' + auditSummary(rows));
    // bars use the same level colours as the panel, scaled with transform
    const bar = await pop.evaluate(() => {
      const b = document.querySelector('.provider-card[data-provider="claude"] .bar');
      const cs = getComputedStyle(b);
      return { cls: b.className, bg: cs.backgroundColor, tr: cs.transitionProperty, crit: getComputedStyle(document.documentElement).getPropertyValue('--zg-crit-bar').trim() };
    });
    assert(/critical/.test(bar.cls) && bar.bg === 'rgb(231, 76, 60)' && bar.crit === '#e74c3c', 'popup bar colour ' + JSON.stringify(bar));
    assert(/transform/.test(bar.tr) && !/width/.test(bar.tr), 'popup bar transitions ' + bar.tr);
    await waitFor(async () => (await pop.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.provider-card[data-provider="claude"] .bar')).transform).a)) === 0.08, { msg: 'claude bar scaleX(0.08)' });
    await pop.close();
  }
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'auto' } });
  return mins.join(', ');
});

await check('Contrast: panel text and the % / countdown on the can are WCAG AA (light + dark)', async () => {
  const mins = [];
  mock.grok = 'free';
  for (const theme of ['light', 'dark']) {
    await send(ext, { type: 'SAVE_SETTINGS', payload: { theme } });
    const g = await env.ctx.newPage();
    await g.goto('https://grok.com/');
    await g.waitForSelector(canSel('grok'));
    await waitFor(async () => (await canText(g, 'grok')) === '30%', { msg: 'grok 30%' });
    await waitFor(async () => new RegExp('zg-theme-' + theme).test(await g.getAttribute(canSel('grok'), 'class')), { msg: 'can ' + theme });
    await g.click(canSel('grok') + ' .zg-percent');
    await g.locator('#zero-grok-panel-grok.zg-open').waitFor();
    await waitFor(async () => (await g.evaluate(() => getComputedStyle(document.querySelector('#zero-grok-panel-grok')).opacity)) === '1', { msg: 'panel opaque' });
    const rows = await contrastAudit(g, ['#zero-grok-panel-grok .zg-panel-header span', '.zg-big-percent', '.zg-label', '.zg-conf', '.zg-updated', '.zg-reset', '.zg-forecast', '.zg-bd-label', '.zg-bd-val', '.zg-status', '.zg-btn', '.zg-close']);
    mins.push(theme + ' panel min ' + auditSummary(rows));
    const can = await contrastAudit(g, [canSel('grok') + ' .zg-percent', canSel('grok') + ' .zg-secondary'], CAN_BACKDROPS);
    assert(can.length === 2, 'can text sampled ' + can.length);
    mins.push(theme + ' can min ' + auditSummary(can));
    const px = await g.evaluate((sel) => getComputedStyle(document.querySelector(sel + ' .zg-secondary')).fontSize, canSel('grok'));
    assert(px === '11px', 'countdown size ' + px);
    const barNow = () => g.evaluate(() => { const b = document.querySelector('#zero-grok-panel-grok .zg-bar'); return { a: new DOMMatrix(getComputedStyle(b).transform).a, bg: getComputedStyle(b).backgroundColor }; });
    const bar = await waitFor(async () => { const b = await barNow(); return Math.abs(b.a - 0.3) < 0.001 && b.bg === 'rgb(243, 156, 18)' ? b : null; }, { timeout: 3000, msg: 'panel bar scaleX(0.3) in warn colour' }).catch(async (e) => { throw new Error(e.message + ' ' + JSON.stringify(await barNow())); });
    await g.close();
  }
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'auto' } });
  return mins.join(', ');
});

await check('Panel a11y: closed = hidden + inert + aria-hidden; opens with opacity/transform; Tab is trapped; Escape returns focus to the can', async () => {
  const g = await env.ctx.newPage();
  await g.goto('https://grok.com/');
  await g.waitForSelector(canSel('grok'));
  await waitFor(async () => (await canText(g, 'grok')) === '30%', { msg: 'grok 30%' });
  await waitFor(() => g.locator('#zero-grok-panel-grok').count(), { msg: 'panel pre-built at idle' });
  const closed = await g.evaluate(() => { const p = document.querySelector('#zero-grok-panel-grok'); const cs = getComputedStyle(p); return { inert: p.hasAttribute('inert'), hidden: p.getAttribute('aria-hidden'), vis: cs.visibility, display: cs.display, op: cs.opacity, tp: cs.transitionProperty }; });
  assert(closed.inert && closed.hidden === 'true' && closed.vis === 'hidden' && closed.display !== 'none' && closed.op === '0', 'closed ' + JSON.stringify(closed));
  assert(/opacity/.test(closed.tp) && /transform/.test(closed.tp), 'transitions ' + closed.tp);
  await g.focus(canSel('grok'));
  await g.keyboard.press('Enter');
  await g.locator('#zero-grok-panel-grok.zg-open').waitFor();
  const open = await g.evaluate(() => { const p = document.querySelector('#zero-grok-panel-grok'); return { inert: p.hasAttribute('inert'), hidden: p.hasAttribute('aria-hidden'), focus: document.activeElement.className, expanded: document.querySelector('.zg-can-root[data-provider="grok"]').getAttribute('aria-expanded') }; });
  assert(!open.inert && !open.hidden && open.focus === 'zg-close' && open.expanded === 'true', 'open ' + JSON.stringify(open));
  for (let i = 0; i < 8; i++) {
    await g.keyboard.press('Tab');
    assert(await g.evaluate(() => document.querySelector('#zero-grok-panel-grok').contains(document.activeElement)), 'focus left the panel on Tab ' + (i + 1));
  }
  await g.focus('#zero-grok-panel-grok .zg-close');
  await g.keyboard.press('Shift+Tab');
  assert(await g.evaluate(() => document.activeElement.textContent === 'Hide on this site'), 'Shift+Tab wraps to the last control');
  const ring = await g.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert(ring === 'solid', 'visible focus ring: ' + ring);
  await g.keyboard.press('Escape');
  await waitFor(async () => !(await g.locator('#zero-grok-panel-grok.zg-open').count()), { msg: 'closed on Escape' });
  const after = await g.evaluate(() => ({ focus: document.activeElement.classList.contains('zg-can-root'), inert: document.querySelector('#zero-grok-panel-grok').hasAttribute('inert') }));
  assert(after.focus && after.inert, 'focus back on the can + inert ' + JSON.stringify(after));
  await g.close();
});

await check('Motion: liquid slides (rAF), can→ring morph animates (WAAPI), minimized ring is 28px with an expand tooltip', async () => {
  await send(ext, { type: 'SAVE_SETTINGS', payload: { reduceMotion: false } });
  const g = await env.ctx.newPage();
  await g.goto('https://grok.com/');
  await g.waitForSelector(canSel('grok'));
  const t0 = Date.now();
  await waitFor(async () => (await canText(g, 'grok')) === '30%', { msg: 'grok 30%' });
  await sleep(Math.max(0, 4800 - (Date.now() - t0))) // let Grok's start-up scrapes (1.2s, 4s) finish);
  const s = await sampleLiquid(g, 'grok', 1200, () => sendToTab(ext, 'https://grok.com/*', { type: 'USAGE_PUSH', payload: { provider: 'grok', remainingPercent: 80, usedPercent: 20, source: 'rate-limits' } }));
  const distinct = new Set(s.ys.map((y) => y.toFixed(1))).size;
  assert(s.ys.some((y) => Math.abs(y - 37.6) < 0.01), 'reached the pushed level');
  assert(Math.abs(s.target - 37.6) < 0.01 && distinct >= 8 && Math.abs(s.ys[s.ys.length - 1] - s.target) < 0.01, `liquid tween: ${distinct} steps, end ${s.ys[s.ys.length - 1]} target ${s.target}`);
  await g.hover(canSel('grok'));
  await g.click(canSel('grok') + ' .zg-mini-btn');
  const anims = await g.evaluate(() => document.getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length);
  await waitFor(async () => /zg-mini/.test(await g.getAttribute(canSel('grok'), 'class')), { msg: 'mini' });
  await sleep(300);
  const box = await g.locator(canSel('grok')).boundingBox();
  assert(anims >= 1, 'morph used WAAPI animations: ' + anims);
  assert(Math.round(box.width) === 28 && Math.round(box.height) === 28, 'ring size ' + JSON.stringify(box));
  const title = await g.getAttribute(canSel('grok'), 'title');
  assert(/click to expand/.test(title), 'ring tooltip ' + title);
  await g.click(canSel('grok'));
  await waitFor(async () => !/zg-mini/.test(await g.getAttribute(canSel('grok'), 'class')), { msg: 'expanded' });
  await g.close();
  return `${distinct} liquid frames, ${anims} morph animation(s)`;
});

for (const mode of ['OS prefers-reduced-motion', 'Reduce motion setting']) {
  await check(`Reduced motion (${mode}): liquid jumps, no morph/fizz, panel + bars have no transitions, halo is static`, async () => {
    const os = mode.startsWith('OS');
    await send(ext, { type: 'SAVE_SETTINGS', payload: { reduceMotion: !os } });
    const g = await env.ctx.newPage();
    await g.emulateMedia({ reducedMotion: os ? 'reduce' : 'no-preference' });
    const t0 = Date.now();
    await g.goto('https://grok.com/');
    await g.waitForSelector(canSel('grok'));
    await waitFor(async () => /%/.test(await canText(g, 'grok')) && (await canText(g, 'grok')) !== '--%', { msg: 'reading' });
    await sleep(Math.max(0, 4800 - (Date.now() - t0))); // start-up scrapes would overwrite pushed readings
    if (!os) await waitFor(async () => /zg-reduce-motion/.test(await g.getAttribute(canSel('grok'), 'class')), { msg: 'reduce class' });
    const s = await sampleLiquid(g, 'grok', 500, () => sendToTab(ext, 'https://grok.com/*', { type: 'USAGE_PUSH', payload: { provider: 'grok', remainingPercent: 15, usedPercent: 85, source: 'rate-limits' } }));
    const moving = s.ys.filter((y) => Math.abs(y - s.target) > 0.01 && Math.abs(y - s.ys[0]) > 0.01);
    assert(!moving.length && Math.abs(s.ys[s.ys.length - 1] - s.target) < 0.01, 'liquid must jump: ' + moving.slice(0, 5).join(','));
    await g.hover(canSel('grok'));
    await g.click(canSel('grok') + ' .zg-mini-btn');
    const anims = await g.evaluate(() => document.getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).length);
    assert(anims === 0, 'morph animations with reduced motion: ' + anims);
    assert(/zg-mini/.test(await g.getAttribute(canSel('grok'), 'class')), 'minimized immediately');
    await g.click(canSel('grok'));
    await sendToTab(ext, 'https://grok.com/*', { type: 'USAGE_PUSH', payload: { provider: 'grok', remainingPercent: 0, usedPercent: 100, source: 'rate-limits' } });
    await waitFor(async () => /zg-at-limit/.test(await g.getAttribute(canSel('grok'), 'class')), { msg: 'at limit' });
    await sendToTab(ext, 'https://grok.com/*', { type: 'REFILL_POP', provider: 'grok' });
    await sleep(500);
    const st = await g.evaluate((sel) => {
      const c = document.querySelector(sel);
      const halo = getComputedStyle(c, '::before');
      return { fizz: document.querySelectorAll('.zg-fizz-particle').length, can: getComputedStyle(c).animationName, halo: halo.animationName, haloOp: halo.opacity };
    }, canSel('grok'));
    assert(st.fizz === 0 && st.can === 'none' && st.halo === 'none' && +st.haloOp > 0.5, 'effects ' + JSON.stringify(st));
    await g.click(canSel('grok') + ' .zg-percent');
    await g.locator('#zero-grok-panel-grok.zg-open').waitFor();
    const tr = await g.evaluate(() => ({
      panel: getComputedStyle(document.querySelector('#zero-grok-panel-grok')).transitionDuration,
      bar: getComputedStyle(document.querySelector('#zero-grok-panel-grok .zg-bar')).transitionDuration,
      op: getComputedStyle(document.querySelector('#zero-grok-panel-grok')).opacity
    }));
    assert(tr.panel.split(',').every((d) => parseFloat(d) === 0) && tr.bar.split(',').every((d) => parseFloat(d) === 0) && tr.op === '1', 'transitions ' + JSON.stringify(tr));
    await g.close();
    await send(ext, { type: 'SAVE_SETTINGS', payload: { reduceMotion: false } });
    mock.grok = 'free';
  });
}

area('First-run setup');
await check('Onboarding page opens automatically on first install', async () => {
  assert(env.onboardingOpened, 'onboarding tab did not open on install');
});
await check('Onboarding: first-run setup lists providers + plans and saves', async () => {
  const pg = await extPage(env, '/onboarding/onboarding.html');
  await pg.waitForSelector('#providers input[type="checkbox"]');
  const n = await pg.locator('#providers input[type="checkbox"]').count();
  assert(n === 9, 'providers ' + n);
  assert((await pg.locator('#providers select').count()) >= 4, 'plan selects');
  await pg.selectOption('#providers select >> nth=0', { index: 1 });
  await pg.click('#save');
  await waitFor(async () => (await send(env.__p || ext, { type: 'GET_SETTINGS' })).onboardingComplete === true, { msg: 'onboardingComplete' }).catch(async (e) => {
    // page may already have closed itself; read from another page
    const s = await send(ext, { type: 'GET_SETTINGS' });
    if (!s.onboardingComplete) throw e;
  });
  const s = await send(ext, { type: 'GET_SETTINGS' });
  assert(s.plans.grok === 'supergrok', 'plan saved: ' + s.plans.grok);
});

area('i18n (en / hi)');
await check('i18n: chrome.i18n substitutions work for the English bundle', async () => {
  const msg = await ext.evaluate(() => chrome.i18n.getMessage('resetsInAt', ['2h 14m', '5:30 PM']));
  assert(msg === 'Resets in 2h 14m (at 5:30 PM)', msg);
  assert((await ext.evaluate(() => chrome.i18n.getMessage('extName'))) === 'Zero Grok');
});

area('Storage clear / recovery');
await check('After clearing all extension storage: defaults return, popup + options + can still work', async () => {
  await ext.evaluate(async () => { await chrome.storage.local.clear(); await chrome.storage.sync.clear(); });
  const s = await send(ext, { type: 'GET_SETTINGS' });
  assert(s.enableGrok === true && s.autoCheckUpdates === false && s.theme === 'auto' && JSON.stringify(s.alertThresholds) === '[70,90,100]', JSON.stringify(s));
  const pop = await extPage(env, '/popup/popup.html');
  await pop.waitForSelector('.provider-card');
  assert((await pop.locator('.provider-card').count()) === 4, 'default 4 providers');
  assert(await pop.locator('#empty-hint').isVisible(), 'empty hint');
  assert(await pop.locator('#history').isHidden(), 'history hidden when empty');
  const op = await extPage(env, '/options/options.html');
  await op.waitForSelector('#provider-list input');
  assert((await op.inputValue('#thresholds')).replace(/\s/g, '') === '70,90,100');
  mock.grok = 'free';
  const g = await env.ctx.newPage();
  await g.goto('https://grok.com/');
  await g.waitForSelector(canSel('grok'));
  await waitFor(async () => (await canText(g, 'grok')) === '30%', { msg: 'can works after clear' });
  await waitFor(async () => (await pop.locator('.provider-card[data-provider="grok"] .pc-pct').textContent()) === '30%', { msg: 'popup shows new reading live' });
  const errs = [...pop.__errs, ...op.__errs];
  assert(!errs.length, errs.join(' | '));
  for (const pg of [g, pop, op]) await pg.close();
});

await env.ctx.close();

area('Optional providers');
// ---- Optional providers: test copy where the optional hosts are pre-granted
const optTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zg-ext-opt-'));
fs.cpSync(EXT_SRC, optTmp, { recursive: true });
{
  const mf = JSON.parse(fs.readFileSync(path.join(optTmp, 'manifest.json'), 'utf8'));
  mf.host_permissions = [...mf.host_permissions, ...mf.optional_host_permissions];
  fs.writeFileSync(path.join(optTmp, 'manifest.json'), JSON.stringify(mf, null, 2));
}
const env2 = await launch(optTmp, 'opt');
await check('Optional providers (Perplexity counter, DeepSeek banner, Copilot estimate) via runtime-registered scripts', async () => {
  {
    const e = await extPage(env2, '/popup/popup.html');
    await send(e, { type: 'SAVE_SETTINGS', payload: { enablePerplexity: true, enableDeepseek: true, enableCopilot: true, enableMistral: true, enableMetaai: true, onboardingComplete: true } });
    const ids = await waitFor(async () => {
      const list = await env2.sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.map((x) => x.id)));
      return list.includes('zg-perplexity') && list.includes('zg-copilot') ? list : null;
    }, { msg: 'registered scripts' });
    const px = await env2.ctx.newPage();
    await px.goto('https://www.perplexity.ai/');
    await px.waitForSelector(canSel('perplexity'), { timeout: 10000 });
    await waitFor(async () => (await canText(px, 'perplexity')) === '12', { msg: 'perplexity "12"' });
    const ds = await env2.ctx.newPage();
    await ds.goto('https://chat.deepseek.com/');
    await ds.waitForSelector(canSel('deepseek'));
    await waitFor(async () => /zg-at-limit/.test(await ds.getAttribute(canSel('deepseek'), 'class')), { msg: 'deepseek at limit' });
    const mi = await env2.ctx.newPage();
    await mi.goto('https://chat.mistral.ai/chat');
    await mi.waitForSelector(canSel('mistral'));
    await waitFor(async () => (await canText(mi, 'mistral')) === '5', { msg: 'le chat "5"' });
    const me = await env2.ctx.newPage();
    await me.goto('https://www.meta.ai/');
    await me.waitForSelector(canSel('metaai'));
    await waitFor(async () => /zg-at-limit/.test(await me.getAttribute(canSel('metaai'), 'class')), { msg: 'meta ai at limit' });
    // No invented totals: counters stay counts, not percentages.
    const st = await e.evaluate(() => chrome.storage.local.get('zeroGrokUsage').then((r) => r.zeroGrokUsage.byProvider));
    assert(st.perplexity.remaining === 12 && st.perplexity.remainingPercent == null, 'perplexity ' + JSON.stringify(st.perplexity));
    assert(st.mistral.remaining === 5 && st.mistral.remainingPercent == null, 'mistral ' + JSON.stringify(st.mistral));
    const pop2 = await extPage(env2, '/popup/popup.html');
    await pop2.waitForSelector('.provider-card[data-provider="metaai"]');
    assert((await pop2.locator('.provider-card').count()) === 9, 'popup cards ' + (await pop2.locator('.provider-card').count()));
    assert((await pop2.locator('.provider-card[data-provider="perplexity"] .pc-pct').textContent()) === '12 left');
    const cp = await env2.ctx.newPage();
    await cp.goto('https://copilot.microsoft.com/');
    await cp.waitForSelector(canSel('copilot'));
    await sleep(2500);
    await cp.fill('#prompt', 'hi');
    await cp.press('#prompt', 'Enter');
    await waitFor(async () => (await canText(cp, 'copilot')) === '1', { msg: 'copilot count 1' });
    await cp.click(canSel('copilot') + ' .zg-percent');
    assert((await cp.locator('#zero-grok-panel-copilot.zg-open .zg-conf').textContent()) === 'Estimate');
    // Disabling a provider unregisters its scripts.
    await send(e, { type: 'SAVE_SETTINGS', payload: { enableCopilot: false } });
    await waitFor(async () => !(await env2.sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.some((x) => x.id === 'zg-copilot')))), { msg: 'copilot unregistered' });
    await send(e, { type: 'SAVE_SETTINGS', payload: { enableCopilot: true } });
    return ids.filter((x) => x.startsWith('zg-') && !x.startsWith('zg-hook')).join(', ');
  }
});

await check('Overlap: optional providers keep the can clear of the message box too (bottom-right + bottom-left)', async () => {
  const e = await extPage(env2, '/popup/popup.html');
  await waitFor(async () => (await env2.sw.evaluate(() => chrome.scripting.getRegisteredContentScripts().then((l) => l.map((x) => x.id)))).includes('zg-copilot'), { msg: 'copilot registered again' });
  const out = [];
  for (const corner of ['bottom-right', 'bottom-left']) {
    await send(e, { type: 'SAVE_SETTINGS', payload: { canPosition: corner } });
    for (const [host, id] of [['www.perplexity.ai', 'perplexity'], ['chat.deepseek.com', 'deepseek'], ['chat.mistral.ai', 'mistral'], ['copilot.microsoft.com', 'copilot'], ['www.meta.ai', 'metaai']]) {
      const pg = await env2.ctx.newPage();
      await pg.goto(`https://${host}/zg-composer`);
      await pg.waitForSelector(canSel(id), { timeout: 10000 });
      await waitFor(async () => new RegExp('zg-pos-' + corner).test(await pg.getAttribute(canSel(id), 'class')), { msg: id + ' at ' + corner });
      const ov = await waitFor(async () => { const o = await overlapOf(pg, id); return o.area === 0 ? o : null; }, { timeout: 4000, msg: `${id} ${corner} overlap 0 (got ${JSON.stringify(await overlapOf(pg, id))})` });
      out.push(`${id}/${corner}:gap ${ov.gap}`);
      await pg.close();
    }
  }
  await e.close();
  return out.join(', ');
});
await env2.ctx.close();


area('i18n (en / hi)');
await check('i18n: Hindi browser locale renders the Hindi popup and options', async () => {
  const env3 = await launch(EXT_SRC, 'hi', { locale: 'hi-IN' });
  try {
    const pg = await extPage(env3, '/popup/popup.html');
    await pg.setViewportSize({ width: 380, height: 600 });
    const lang = await pg.evaluate(() => chrome.i18n.getUILanguage());
    await pg.waitForSelector('.provider-card');
    const sub = await pg.locator('.sub').textContent();
    assert(sub === 'सारे AI का उपयोग एक नज़र में', `ui=${lang} subtitle=${sub}`);
    assert((await pg.locator('#refresh').textContent()) === 'सब रीफ़्रेश करें');
    await pg.screenshot({ path: path.join(ART, 'v15-popup-hi.png'), fullPage: true });
    assert((await pg.locator('.seg button[data-days="7"]').textContent()) === '7 दिन', 'range button');
    const op = await extPage(env3, '/options/options.html');
    await op.waitForSelector('#provider-list input');
    assert((await op.locator('#save').textContent()).trim() === 'सेटिंग सहेजें');
    assert((await op.title()) === 'Zero Grok विकल्प', 'options title ' + (await op.title()));
    // content scripts on a provider page are localized too (can label + panel)
    const g = await env3.ctx.newPage();
    await g.goto('https://grok.com/');
    await g.waitForSelector(canSel('grok'));
    await waitFor(async () => /बचा|उपयोग मीटर/.test((await g.getAttribute(canSel('grok'), 'aria-label')) || ''), { msg: 'hindi can label' });
    await g.click(canSel('grok') + ' .zg-percent');
    const p = g.locator('#zero-grok-panel-grok.zg-open');
    await p.waitFor();
    const btns = await p.locator('.zg-btn').allTextContents();
    assert(btns.includes('रीफ़्रेश') && !btns.includes('Refresh'), 'panel buttons ' + btns.join('|'));
    await g.screenshot({ path: path.join(ART, 'v15-grok-panel-hi.png') });
    return 'ui=' + lang + ', panel: ' + btns.join(' / ');
  } finally {
    await env3.ctx.close();
  }
});

const pass = results.filter((r) => r.pass).length;
const byArea = {};
for (const r of results) { byArea[r.area] = byArea[r.area] || { pass: 0, total: 0 }; byArea[r.area].total++; if (r.pass) byArea[r.area].pass++; }
console.log('\nPer area:');
for (const [a, v] of Object.entries(byArea)) console.log(`  ${v.pass === v.total ? 'OK  ' : 'FAIL'} ${a}: ${v.pass}/${v.total}`);
console.log(`\n${pass}/${results.length} end-to-end checks passed. Screenshots: ${ART}`);
fs.writeFileSync(path.join(ART, 'e2e-results.json'), JSON.stringify(results, null, 2));
process.exit(pass === results.length ? 0 : 1);

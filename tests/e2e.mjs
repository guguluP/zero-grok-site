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
    results.push({ name, pass: true });
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, pass: false, detail: e.message });
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
  await ctx.route(/^https:\/\/(grok\.com|claude\.ai|chatgpt\.com|gemini\.google\.com|www\.perplexity\.ai|chat\.deepseek\.com|copilot\.microsoft\.com)\//, handleRoute);
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = new URL(sw.url()).host;
  // The onboarding tab opens on install: close it so it doesn't steal focus.
  await sleep(800);
  for (const p of ctx.pages()) if (p.url().includes('/onboarding/')) await p.close();
  return { ctx, sw, id, base: `chrome-extension://${id}` };
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

await check('no update alarm unless opted in; 6h alarm after opting in', async () => {
  const none = await ext.evaluate(() => chrome.alarms.get('zeroGrokUpdateCheck'));
  assert(!none, 'alarm exists before opt-in');
  await send(ext, { type: 'SAVE_SETTINGS', payload: { autoCheckUpdates: true } });
  const a = await waitFor(() => ext.evaluate(() => chrome.alarms.get('zeroGrokUpdateCheck')), { msg: 'update alarm' });
  assert(a.periodInMinutes === 360, 'period ' + a.periodInMinutes);
  await send(ext, { type: 'SAVE_SETTINGS', payload: { autoCheckUpdates: false } });
  await waitFor(async () => !(await ext.evaluate(() => chrome.alarms.get('zeroGrokUpdateCheck'))), { msg: 'alarm cleared' });
});

await check('SAVE_SETTINGS merges partial updates (no lost keys)', async () => {
  await send(ext, { type: 'SAVE_SETTINGS', payload: { pollIntervalMinutes: 3, plans: { claude: 'pro' } } });
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'dark' } });
  const s = await send(ext, { type: 'GET_SETTINGS' });
  assert(s.pollIntervalMinutes === 3 && s.theme === 'dark' && s.plans.claude === 'pro', JSON.stringify(s));
  await send(ext, { type: 'SAVE_SETTINGS', payload: { theme: 'auto', pollIntervalMinutes: 5 } });
});

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

await check('Keyboard: TOGGLE_PANEL (Alt+Shift+Z command) and Enter on the focused can open the panel', async () => {
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

await check('Hide on this site removes the can and is saved in settings', async () => {
  await grok.click(canSel('grok') + ' .zg-percent');
  await grok.locator('#zero-grok-panel-grok.zg-open button.zg-btn', { hasText: 'Hide on this site' }).click();
  await waitFor(async () => !(await grok.locator(canSel('grok')).isVisible()), { msg: 'hidden' });
  const s = await send(ext, { type: 'GET_SETTINGS' });
  assert(s.hiddenSites.includes('grok.com'), JSON.stringify(s.hiddenSites));
  await send(ext, { type: 'HIDE_SITE', host: 'grok.com', hidden: false });
  await waitFor(async () => grok.locator(canSel('grok')).isVisible(), { msg: 'shown again via storage change' });
});

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
  assert(/9\.9\.9/.test(await pg.locator('#update-title').textContent()));
  await pg.click('#update-dismiss');
  assert(await pg.locator('#update-banner').isHidden());
  await pg.reload();
  await pg.waitForSelector('.provider-card');
  assert(await pg.locator('#update-banner').isHidden(), 'dismissed version shown again');
  await send(pg, { type: 'SAVE_SETTINGS', payload: { autoCheckUpdates: false } });
  await store(pg, { zeroGrokUpdate: null });
  await pg.close();
});

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

await check('i18n: chrome.i18n substitutions work for the English bundle', async () => {
  const msg = await ext.evaluate(() => chrome.i18n.getMessage('resetsInAt', ['2h 14m', '5:30 PM']));
  assert(msg === 'Resets in 2h 14m (at 5:30 PM)', msg);
  assert((await ext.evaluate(() => chrome.i18n.getMessage('extName'))) === 'Zero Grok');
});

await env.ctx.close();

// ---- Optional providers: test copy where the optional hosts are pre-granted
await check('Optional providers (Perplexity counter, DeepSeek banner, Copilot estimate) via runtime-registered scripts', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zg-ext-opt-'));
  fs.cpSync(EXT_SRC, tmp, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
  mf.host_permissions = [...mf.host_permissions, ...mf.optional_host_permissions];
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(mf, null, 2));
  const env2 = await launch(tmp, 'opt');
  try {
    const e = await extPage(env2, '/popup/popup.html');
    await send(e, { type: 'SAVE_SETTINGS', payload: { enablePerplexity: true, enableDeepseek: true, enableCopilot: true, onboardingComplete: true } });
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
    return ids.filter((x) => x.startsWith('zg-') && !x.startsWith('zg-hook')).join(', ');
  } finally {
    await env2.ctx.close();
  }
});


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
    const op = await extPage(env3, '/options/options.html');
    await op.waitForSelector('#provider-list input');
    assert((await op.locator('#save').textContent()).trim() === 'सेटिंग सहेजें');
    return 'ui=' + lang;
  } finally {
    await env3.ctx.close();
  }
});

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} end-to-end checks passed. Screenshots: ${ART}`);
fs.writeFileSync(path.join(ART, 'e2e-results.json'), JSON.stringify(results, null, 2));
process.exit(pass === results.length ? 0 : 1);

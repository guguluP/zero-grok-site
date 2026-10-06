// Real keyboard-shortcut test. Synthetic Playwright key events never reach browser
// accelerators, so this drives OS-level keys with xdotool in a headed Chromium.
// Needs an X display + xdotool:   DISPLAY=:0 npm run test:keys   (CI: xvfb-run)
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync('command -v xdotool', { stdio: 'ignore' }); } catch (_) { console.log('SKIP  xdotool not installed'); process.exit(0); }
if (!process.env.DISPLAY) { console.log('SKIP  no DISPLAY'); process.exit(0); }

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'zg-keys-')), {
  channel: 'chromium', headless: false, viewport: { width: 1100, height: 750 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run']
});
await ctx.route('https://grok.com/**', (r) => r.request().url().includes('/rest/rate-limits')
  ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ remainingQueries: 10, totalQueries: 20 }) })
  : r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><h1>Grok</h1></body></html>' }));
let failed = 0;
const result = (ok, name) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
try {
  await sleep(800);
  for (const p of ctx.pages()) if (p.url().includes('onboarding')) await p.close();
  const pg = await ctx.newPage();
  await pg.goto('https://grok.com/');
  await pg.waitForSelector('.zg-can-root[data-provider="grok"]');
  await pg.bringToFront();
  await sleep(600);
  const key = (k) => {
    try {
      execSync(`xdotool search --sync --onlyvisible --class chromium windowactivate --sync key --clearmodifiers ${k}`, { stdio: 'pipe' });
    } catch (_) {
      // No window manager (e.g. bare Xvfb): focus instead of activate.
      execSync(`xdotool search --sync --onlyvisible --class chromium windowfocus --sync key --clearmodifiers ${k}`, { stdio: 'pipe' });
    }
  };
  key('alt+shift+u');
  await sleep(800);
  result((await pg.locator('#zero-grok-panel-grok.zg-open').count()) === 1, 'Alt+Shift+U opens the usage panel');
  key('alt+shift+u');
  await sleep(800);
  result((await pg.locator('#zero-grok-panel-grok.zg-open').count()) === 0, 'Alt+Shift+U again closes it');
  key('alt+u');
  await sleep(800);
  result(!(await pg.locator('.zg-can-root[data-provider="grok"]').isVisible()), 'Alt+U hides the can');
  key('alt+u');
  await sleep(800);
  result(await pg.locator('.zg-can-root[data-provider="grok"]').isVisible(), 'Alt+U shows it again');
} finally {
  await ctx.close();
}
process.exit(failed ? 1 : 0);

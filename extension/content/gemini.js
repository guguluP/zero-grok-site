/**
 * Zero Grok – Gemini (Free / AI Pro / Ultra)
 *
 * Sources, in order:
 *   1. Live DOM of gemini.google.com/usage (re-read as the SPA renders it)
 *   2. Same-origin fetch of /usage HTML (works when the numbers are server-rendered)
 *   3. Limit banners in alert/toast surfaces
 *   4. The last /usage reading cached by the background (shown with its age)
 * v1.5 no longer strips X-Frame-Options/CSP to iframe /usage – that was too broad.
 * Gemini reports USED percent; we convert to remaining for the can.
 */
(function () {
  'use strict';
  const S = window.ZeroGrokShared;
  const P = window.ZeroGrokProvider;
  if (!S || !P || window.self !== window.top) return;

  const onUsagePage = () => location.pathname.startsWith('/usage');

  function first(doc, list) {
    for (const sel of list || []) {
      try {
        const el = doc.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function readBlock(el) {
    if (!el) return null;
    let used = null, reset = '';
    const texts = Array.from(el.querySelectorAll('p, div, span, h1, h2, h3, li, label'))
      .map((n) => (n.textContent || '').trim()).filter((x) => x && x.length < 120);
    for (const text of texts) {
      const m = text.match(/(\d{1,3})\s*%/);
      if (m && used == null) {
        const v = parseInt(m[1], 10);
        if (v >= 0 && v <= 100) used = v;
      }
      if (!reset && /reset|refill/i.test(text)) reset = text.slice(0, 80);
    }
    return used == null ? null : { used, reset };
  }

  function extract(doc, sel, allowBodyScan) {
    if (!doc) return null;
    const blocks = (sel && sel.usageBlocks) || {};
    let cur = readBlock(first(doc, blocks.current));
    let wk = readBlock(first(doc, blocks.weekly));
    if (!cur && !wk && allowBodyScan) {
      // Only on the /usage page itself – never scan chat transcripts for "%".
      const lines = (doc.body?.innerText || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/(\d{1,3})\s*%\s*(?:used)?/i);
        if (!m) continue;
        const v = parseInt(m[1], 10);
        if (v < 0 || v > 100) continue;
        const ctx = ((lines[i - 1] || '') + ' ' + lines[i] + ' ' + (lines[i + 1] || '')).toLowerCase();
        const resetLine = [lines[i + 1], lines[i + 2]].find((x) => x && /reset|refill/i.test(x)) || '';
        if (/week|7[\s-]?day/.test(ctx)) { if (!wk) wk = { used: v, reset: resetLine }; }
        else if (!cur) cur = { used: v, reset: resetLine };
      }
    }
    if (!cur && !wk) return null;
    const buckets = [];
    if (cur) buckets.push({ ...cur, label: S.t('geminiCurrent', null, 'Current window') });
    if (wk) buckets.push({ ...wk, label: S.t('weekly', null, 'Weekly') });
    buckets.sort((a, b) => b.used - a.used);
    const top = buckets[0];
    return {
      provider: 'gemini',
      usedPercent: top.used,
      remainingPercent: 100 - top.used,
      windowHint: top.label,
      resetHint: top.reset || '',
      resetAt: S.parseRelativeReset(top.reset),
      weeklyUsed: wk ? wk.used : null,
      weeklyRemaining: wk ? 100 - wk.used : null,
      weeklyResetHint: wk ? wk.reset : '',
      breakdown: buckets.map((b) => ({ label: b.label, remainingPercent: 100 - b.used, resetAt: S.parseRelativeReset(b.reset) })),
      source: 'usage-page'
    };
  }

  async function viaFetch(sel) {
    try {
      const res = await fetch(location.origin + '/usage', { credentials: 'include', cache: 'no-store', headers: { Accept: 'text/html' } });
      if (res.status === 401 || res.status === 403) return { auth: true };
      if (!res.ok) return null;
      if (/accounts\.google\.com/.test(res.url)) return { auth: true };
      const html = await res.text();
      if (html.length > 3_000_000) return null;
      // DOMParser in an inert document (no scripts run).
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const d = extract(doc, sel, false);
      if (d) d.source = 'usage-fetch';
      return d;
    } catch (_) {
      return null;
    }
  }

  P.register({
    id: 'gemini',
    initialDelays: [1800, 5000],
    pollMs: 45000,
    cacheMaxAgeMs: 12 * 3600000,
    panelActions: [
      { key: 'geminiOpenUsage', fallback: 'Open usage page', onClick: () => window.open('https://gemini.google.com/usage', '_blank', 'noopener') }
    ],
    noDataMessage: S.t('geminiNoData', null, 'Open gemini.google.com/usage once while signed in — the reading is then shared with your other Gemini tabs.'),
    init({ scrape }) {
      if (!onUsagePage()) return;
      // The usage page renders client-side: re-read when it changes.
      let timer = null;
      const mo = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(scrape, 600);
      });
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 30000);
    },
    async scrape(ctx) {
      const live = extract(document, ctx.selectors, onUsagePage());
      if (live) return { data: live };
      const fetched = await viaFetch(ctx.selectors);
      if (fetched && fetched.auth) return { status: 'signed-out' };
      if (fetched) return { data: fetched };
      const hit = ctx.helpers.scanLimitBanner(ctx.selectors);
      if (hit) return { data: { provider: 'gemini', usedPercent: 100, remainingPercent: 0, windowHint: S.t('limitReached', null, 'Limit reached'), resetHint: hit.text, resetAt: S.parseRelativeReset(hit.text), source: 'dom-limit' } };
      // On /usage itself a miss means the page layout changed → health check.
      if (onUsagePage()) return { status: 'no-data', failure: true, detail: 'usage-layout' };
      return { status: 'no-data', failure: false, detail: 'no-data' };
    }
  });
})();

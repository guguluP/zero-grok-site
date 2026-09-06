/**
 * Zero Grok – Gemini (Free / AI Plus / Pro / Ultra)
 *
 * Data source: gemini.google.com/usage
 *   - Live page scrape when on /usage (best)
 *   - Fetch HTML + iframe (DNR strips XFO)
 *   - Network intercept for usage JSON
 *   - On-page limit banners
 *
 * Gemini reports USED percent; we convert to remaining for the can.
 */
(async function () {
  'use strict';
  if (window.__ZERO_GROK_GEMINI__) return;
  window.__ZERO_GROK_GEMINI__ = true;
  if (window.self !== window.top) return;

  let currentUsage = null;
  let canEl = null;
  let panelEl = null;
  let isExpanded = false;
  let settings = { canPosition: 'bottom-right', theme: 'auto', enableGemini: true };
  let iframeEl = null;
  let iframePoll = null;

  function playCanPopSound() {
    try {
      const url = chrome.runtime.getURL('assets/sounds/can-pop.wav');
      const audio = new Audio(url);
      audio.volume = 0.55;
      audio.play().catch(() => {});
    } catch (_) {}
  }

  function loadSettings() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
        if (res) settings = { ...settings, ...res };
        if (settings.enableGemini === false) return;
        if (settings.hideCan) return;
        showCan();
        updateCanVisual(null);
      });
    } catch (_) {
      showCan();
      updateCanVisual(null);
    }
  }

  function createCan() {
    if (canEl) return canEl;
    if (window.ZeroGrokCanUI) {
      canEl = window.ZeroGrokCanUI.mountCan({
        provider: 'gemini',
        settings,
        onClick: togglePanel,
        colors: { a: '#4285f4', b: '#fff' }
      });
      return canEl;
    }
    canEl = document.createElement('div');
    canEl.id = 'zero-grok-can';
    canEl.innerHTML = '<div class="zg-can-body"><div class="zg-percent" id="zg-percent">--%</div></div>';
    canEl.addEventListener('click', togglePanel);
    document.body.appendChild(canEl);
    canEl.className = 'zg-can zg-pos-' + (settings.canPosition || 'bottom-right');
    return canEl;
  }

  function showCan() { createCan(); canEl.style.display = 'flex'; }

  function updateCanVisual(data) {
    if (!canEl) return;
    const rem = data?.remainingPercent;
    if (window.ZeroGrokCanUI) {
      window.ZeroGrokCanUI.setLiquidLevel(canEl, rem);
      if (data && Number.isFinite(data.weeklyRemaining)) {
        window.ZeroGrokCanUI.setSecondary(canEl, 'W ' + Math.round(data.weeklyRemaining) + '%');
      } else {
        window.ZeroGrokCanUI.setSecondary(canEl, '');
      }
      return;
    }
    const percentEl = canEl.querySelector('#zg-percent');
    if (percentEl) {
      if (rem == null || !Number.isFinite(rem)) {
        percentEl.textContent = '--%';
        percentEl.style.color = '#888';
      } else {
        percentEl.textContent = Math.round(rem) + '%';
        percentEl.style.color = '';
      }
    }
  }

  function createPanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'zero-grok-panel';
    panelEl.innerHTML = `
      <div class="zg-panel-header"><span>Zero · Gemini</span><button class="zg-close">×</button></div>
      <div class="zg-panel-body">
        <div class="zg-big-percent" id="zg-big-percent">--%</div>
        <div class="zg-label" id="zg-label">remaining</div>
        <div class="zg-bar-wrap"><div class="zg-bar" id="zg-bar"></div></div>
        <div class="zg-reset" id="zg-reset">Waiting…</div>
        <div id="zg-weekly-row" style="margin-top:10px;font-size:12px;opacity:0.85;display:none">
          <div id="zg-weekly-label">Weekly</div>
          <div class="zg-bar-wrap" style="margin-top:4px"><div class="zg-bar" id="zg-weekly-bar" style="background:#4285f4"></div></div>
        </div>
        <div class="zg-footer"><button id="zg-refresh">Refresh</button>
        <button id="zg-open-usage" style="margin-left:6px">Open /usage</button></div>
      </div>`;
    panelEl.querySelector('.zg-close').onclick = () => { isExpanded = false; panelEl.classList.remove('zg-open'); };
    panelEl.querySelector('#zg-refresh').onclick = () => scrape();
    panelEl.querySelector('#zg-open-usage').onclick = () => { window.open('https://gemini.google.com/usage', '_blank'); };
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function togglePanel() {
    createPanel();
    isExpanded = !isExpanded;
    panelEl.classList.toggle('zg-open', isExpanded);
    if (isExpanded) updatePanel(currentUsage);
  }

  const STATUS_MESSAGES = {
    'signed-out': 'Sign in to Gemini, then open /usage once',
    'no-data': 'Open gemini.google.com/usage once, then Refresh',
    'unavailable': 'Usage not available yet — open /usage or try a chat first'
  };
  let lastStatus = 'signed-out';

  function updatePanel(data) {
    if (!panelEl) return;
    const rem = data?.remainingPercent;
    const big = panelEl.querySelector('#zg-big-percent');
    const bar = panelEl.querySelector('#zg-bar');
    const reset = panelEl.querySelector('#zg-reset');
    const label = panelEl.querySelector('#zg-label');
    const weeklyRow = panelEl.querySelector('#zg-weekly-row');
    const weeklyBar = panelEl.querySelector('#zg-weekly-bar');
    const weeklyLabel = panelEl.querySelector('#zg-weekly-label');

    if (big) big.textContent = (rem == null || !Number.isFinite(rem)) ? '--%' : Math.round(rem) + '%';
    if (label) label.textContent = data?.windowHint || 'remaining';
    if (bar) {
      bar.style.width = (rem == null || !Number.isFinite(rem)) ? '0%' : rem + '%';
      bar.className = 'zg-bar ' + ((rem == null || !Number.isFinite(rem)) ? '' : rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok');
    }
    if (reset) {
      reset.textContent = !data
        ? (STATUS_MESSAGES[lastStatus] || STATUS_MESSAGES['no-data'])
        : [data.windowHint, data.resetHint, data.source].filter(Boolean).join(' · ');
    }
    if (weeklyRow && weeklyBar && weeklyLabel) {
      if (data && Number.isFinite(data.weeklyRemaining)) {
        weeklyRow.style.display = 'block';
        weeklyBar.style.width = data.weeklyRemaining + '%';
        weeklyLabel.textContent = 'Weekly ' + Math.round(data.weeklyRemaining) + '% left' +
          (data.weeklyResetHint ? ' · ' + data.weeklyResetHint : '');
      } else {
        weeklyRow.style.display = 'none';
      }
    }
  }

  function applyUsage(data, status) {
    lastStatus = status || 'signed-out';
    if (!data || !Number.isFinite(data.remainingPercent)) {
      currentUsage = null;
      updateCanVisual(null);
      updatePanel(null);
      return;
    }
    currentUsage = data;
    updateCanVisual(data);
    updatePanel(data);
    try {
      if (window.ZeroGrokCanFx && data) {
        window.ZeroGrokCanFx.trackRefill('gemini', data.remainingPercent, canEl, settings.soundEnabled !== false, { a: '#4285f4', b: '#fff' });
      }
    } catch (_) {}
    try {
      if (window.ZeroGrokCanFx) {
        const panelReset = panelEl && panelEl.querySelector('#zg-reset');
        if (data.remainingPercent != null && data.remainingPercent <= 2) {
          window.ZeroGrokCanFx.startLimitCountdown({
            provider: 'gemini',
            data,
            canEl,
            panelResetEl: panelReset,
            onRefilled: () => { try { scrape(); } catch (_) {} }
          });
        } else {
          window.ZeroGrokCanFx.stopLimitCountdown('gemini');
          canEl && canEl.classList.remove('zg-at-limit');
        }
      }
    } catch (_) {}
    try { chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: data }); } catch (_) {}
    console.log('[Zero Grok] Gemini OK', Math.round(data.remainingPercent) + '%', data.windowHint, 'via', data.source);
  }

  function extractFromDocument(doc) {
    if (!doc) return null;
    let currentUsed = null, currentReset = '', weeklyUsed = null, weeklyReset = '';

    const currentEl =
      doc.querySelector('[data-test-id="gxu-currently"]') ||
      doc.querySelector('.gxu-currently') ||
      doc.querySelector('[data-test-id*="current"]') ||
      doc.querySelector('[class*="currently"]');
    const weeklyEl =
      doc.querySelector('[data-test-id="gxu-weekly"]') ||
      doc.querySelector('.gxu-weekly') ||
      doc.querySelector('[data-test-id*="weekly"]') ||
      doc.querySelector('[class*="weekly"]');

    function readBlock(el, assignUsed, assignReset) {
      if (!el) return;
      const texts = Array.from(el.querySelectorAll('p, div, span, h1, h2, h3, li, label'))
        .map(n => (n.textContent || '').trim()).filter(Boolean);
      for (const text of texts) {
        const m = text.match(/(\d{1,3})\s*%\s*(?:used|used up)?/i) ||
                  text.match(/(?:used|usage)\s*[:=]?\s*(\d{1,3})\s*%/i) ||
                  text.match(/(\d{1,3})\s*%/);
        if (m && assignUsed.value == null) {
          const v = parseInt(m[1], 10);
          if (v >= 0 && v <= 100) assignUsed.value = v;
        }
        if (/reset|resets|refill|available again/i.test(text) && !assignReset.value) assignReset.value = text.slice(0, 80);
      }
    }

    const cur = { value: null }, curR = { value: '' }, wk = { value: null }, wkR = { value: '' };
    readBlock(currentEl, cur, curR);
    readBlock(weeklyEl, wk, wkR);
    currentUsed = cur.value; currentReset = curR.value;
    weeklyUsed = wk.value; weeklyReset = wkR.value;

    if (currentUsed == null || weeklyUsed == null) {
      const bodyText = doc.body?.innerText || doc.documentElement?.innerText || '';
      const chunks = bodyText.split(/\n+/).map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < chunks.length; i++) {
        const line = chunks[i];
        const pct = line.match(/(\d{1,3})\s*%\s*(?:used|used up)?/i) ||
                    line.match(/(?:used|usage)\s*[:=]?\s*(\d{1,3})\s*%/i) ||
                    line.match(/(\d{1,3})\s*%/);
        if (!pct) continue;
        const val = parseInt(pct[1], 10);
        if (val < 0 || val > 100) continue;
        const context = ((chunks[i - 1] || '') + ' ' + line + ' ' + (chunks[i + 1] || '')).toLowerCase();
        const isWeekly = /week|weekly|7[\s-]?day/.test(context);
        const isCurrent = /current|session|5[\s-]?hour|rolling|today|now|prompt|model/.test(context) || !isWeekly;
        if (isWeekly && weeklyUsed == null) weeklyUsed = val;
        else if (isCurrent && currentUsed == null) currentUsed = val;
        if (/reset|resets|refill/i.test(line)) {
          if (isWeekly && !weeklyReset) weeklyReset = line.slice(0, 80);
          else if (!currentReset) currentReset = line.slice(0, 80);
        }
      }
    }

    if (currentUsed == null && weeklyUsed == null) {
      const bars = doc.querySelectorAll('[role="progressbar"], progress, [aria-valuenow]');
      for (const bar of bars) {
        let v = parseFloat(bar.getAttribute('aria-valuenow') || bar.getAttribute('value') || '');
        if (!Number.isFinite(v)) {
          const w = (bar.style && bar.style.width) || '';
          const m = w.match(/([\d.]+)%/);
          if (m) v = parseFloat(m[1]);
        }
        if (!Number.isFinite(v) || v < 0 || v > 100) continue;
        const parentText = (bar.closest('section,div,article,li')?.textContent || '').toLowerCase();
        if (/week|weekly/.test(parentText) && weeklyUsed == null) weeklyUsed = Math.round(v);
        else if (currentUsed == null) currentUsed = Math.round(v);
      }
    }

    if (currentUsed == null && weeklyUsed == null) return null;

    const buckets = [];
    if (currentUsed != null) buckets.push({ used: currentUsed, remaining: Math.max(0, 100 - currentUsed), hint: '5-hour session', reset: currentReset });
    if (weeklyUsed != null) buckets.push({ used: weeklyUsed, remaining: Math.max(0, 100 - weeklyUsed), hint: 'Weekly', reset: weeklyReset });
    buckets.sort((a, b) => b.used - a.used);
    const top = buckets[0];
    return {
      provider: 'gemini',
      usedPercent: top.used,
      remainingPercent: top.remaining,
      windowHint: top.hint,
      resetHint: top.reset || '',
      weeklyUsed,
      weeklyRemaining: weeklyUsed != null ? Math.max(0, 100 - weeklyUsed) : null,
      weeklyResetHint: weeklyReset || '',
      source: 'usage-page'
    };
  }

  function scrapeDomLimit() {
    const text = document.body?.innerText || '';
    const limitMatch = text.match(/you(?:'ve| have)?\s+(?:reached|hit)\s+(?:your\s+)?(?:usage\s+)?limit[^.]{0,120}/i) ||
                      text.match(/usage\s+limit\s+(?:reached|exceeded)/i);
    if (!limitMatch) return null;
    const until = limitMatch[0].match(/(?:until|after|in|at)\s+([^.!?\n]{3,60})/i);
    return {
      provider: 'gemini', usedPercent: 100, remainingPercent: 0,
      windowHint: 'Limit reached', resetHint: until ? until[1].trim() : 'Wait for reset', source: 'dom-limit'
    };
  }

  function scrapeLivePage() {
    try {
      const data = extractFromDocument(document);
      if (data) {
        data.source = location.pathname.includes('/usage') ? 'live-page' : 'live-dom';
        return data;
      }
    } catch (_) {}
    return null;
  }

  function ensureIframe() {
    if (iframeEl && document.body.contains(iframeEl)) return iframeEl;
    iframeEl = document.createElement('iframe');
    iframeEl.id = 'zero-grok-gemini-usage-iframe';
    iframeEl.src = 'https://gemini.google.com/usage';
    iframeEl.setAttribute('aria-hidden', 'true');
    Object.assign(iframeEl.style, { position: 'fixed', width: '1px', height: '1px', border: 'none', opacity: '0', pointerEvents: 'none', left: '-9999px', top: '0' });
    document.body.appendChild(iframeEl);
    return iframeEl;
  }

  function scrapeViaIframe() {
    return new Promise((resolve) => {
      const iframe = ensureIframe();
      iframe.src = 'https://gemini.google.com/usage?t=' + Date.now();
      let attempts = 0;
      if (iframePoll) clearInterval(iframePoll);
      iframePoll = setInterval(() => {
        attempts++;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!doc) {
            if (attempts >= 30) { clearInterval(iframePoll); iframePoll = null; resolve(null); }
            return;
          }
          const title = (doc.title || '').toLowerCase();
          if (title.includes('sign in') || title.includes('login')) {
            clearInterval(iframePoll); iframePoll = null; resolve(null); return;
          }
          const data = extractFromDocument(doc);
          if (data) {
            data.source = 'usage-iframe';
            clearInterval(iframePoll); iframePoll = null; resolve(data); return;
          }
        } catch (_) {
          if (attempts >= 10) { clearInterval(iframePoll); iframePoll = null; resolve(null); }
        }
        if (attempts >= 30) { clearInterval(iframePoll); iframePoll = null; resolve(null); }
      }, 500);
    });
  }

  async function scrapeViaFetch() {
    try {
      const res = await fetch('https://gemini.google.com/usage?t=' + Date.now(), {
        credentials: 'include', cache: 'no-store',
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      if (res.status === 401 || res.status === 403) return { auth: true };
      if (!res.ok) return null;
      const html = await res.text();
      if (/accounts\.google\.com|ServiceLogin|Sign in/i.test(html) && !/\d{1,3}\s*%/i.test(html)) return { auth: true };
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const data = extractFromDocument(doc);
      if (data) data.source = 'usage-fetch';
      return data;
    } catch (e) {
      console.warn('[Zero Grok] Gemini fetch error', e.message);
      return null;
    }
  }

  function installNetworkHook() {
    try {
      const origFetch = window.fetch;
      window.fetch = async function (...args) {
        const response = await origFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          if (/usage|quota|limit|rate|billing|capacity/i.test(url) && response.ok) {
            const clone = response.clone();
            const ct = (clone.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('json')) {
              clone.json().then((json) => {
                const data = normalizeUsageJson(json);
                if (data) applyUsage(data, 'ok');
              }).catch(() => {});
            }
          }
        } catch (_) {}
        return response;
      };
    } catch (_) {}
  }

  function normalizeUsageJson(json) {
    if (!json || typeof json !== 'object') return null;
    const stack = [json];
    let used = null, remaining = null;
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      for (const [k, v] of Object.entries(node)) {
        const key = k.toLowerCase();
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (/usedpercent|percentused|utilization|usagepercent/.test(key) && v >= 0 && v <= 100) used = v;
          if (/remainingpercent|percentremaining/.test(key) && v >= 0 && v <= 100) remaining = v;
        } else if (v && typeof v === 'object') stack.push(v);
      }
    }
    if (remaining == null && used != null) remaining = Math.max(0, 100 - used);
    if (remaining == null || !Number.isFinite(remaining)) return null;
    return {
      provider: 'gemini',
      usedPercent: used != null ? used : Math.max(0, 100 - remaining),
      remainingPercent: remaining,
      windowHint: 'Live', resetHint: '', source: 'network-json'
    };
  }

  function watchUsageDom() {
    let timer = null;
    const tick = () => {
      const data = scrapeLivePage() || scrapeDomLimit();
      if (data && Number.isFinite(data.remainingPercent)) applyUsage(data, 'ok');
    };
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(tick, 600); });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(() => { if (location.pathname.includes('/usage')) tick(); }, 15000);
  }

  async function scrape() {
    console.log('[Zero Grok] Gemini scrape…');
    let data = scrapeLivePage();
    if (data && Number.isFinite(data.remainingPercent)) { applyUsage(data, 'ok'); return; }
    data = await scrapeViaFetch();
    if (data && data.auth) { applyUsage(null, 'signed-out'); return; }
    if (data && Number.isFinite(data.remainingPercent)) { applyUsage(data, 'ok'); return; }
    console.log('[Zero Grok] Gemini trying iframe fallback…');
    data = await scrapeViaIframe();
    if (data && Number.isFinite(data.remainingPercent)) { applyUsage(data, 'ok'); return; }
    data = scrapeDomLimit();
    if (data) { applyUsage(data, 'ok'); return; }
    applyUsage(null, currentUsage ? 'unavailable' : 'no-data');
  }

  function watchGeneration() {
    let wasGenerating = false;
    const check = () => {
      const stop = document.querySelector('button[aria-label*="Stop" i]') ||
                   document.querySelector('button[aria-label*="stop generating" i]');
      const generating = !!stop;
      if (wasGenerating && !generating) setTimeout(scrape, 1200);
      wasGenerating = generating;
    };
    if (document.body) new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    setInterval(check, 2000);
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'SCRAPE_USAGE') {
      scrape().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'USAGE_PUSH' && msg.payload?.provider === 'gemini') {
      applyUsage(msg.payload, 'ok');
      sendResponse({ ok: true });
    }
  });

  installNetworkHook();
  watchUsageDom();
  loadSettings();
  setTimeout(scrape, 1800);
  setTimeout(scrape, 6000);
  setInterval(scrape, 90_000);
  watchGeneration();
  console.log('[Zero Grok] Gemini ready (live + fetch + iframe + intercept)');
})();

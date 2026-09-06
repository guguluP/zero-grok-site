/**
 * Zero Grok – Gemini (Free / AI Plus / Pro / Ultra)
 *
 * Data source: gemini.google.com/usage
 *   - Primary: fetch HTML + parse "% used" for current (5h) + weekly
 *   - Fallback: same-origin hidden iframe (needs DNR to strip XFO/CSP)
 *   - Last resort: on-page limit banners
 *
 * Gemini reports USED percent; we convert to remaining for the can.
 */
(async function () {
  'use strict';
  if (window.__ZERO_GROK_GEMINI__) return;
  window.__ZERO_GROK_GEMINI__ = true;
  // Only top frame (not the usage iframe we inject)
  if (window.self !== window.top) return;

  let currentUsage = null;
  let canEl = null;
  let panelEl = null;
  let isExpanded = false;
  let settings = { canPosition: 'bottom-right', theme: 'auto', enableGemini: true };
  let iframeEl = null;
  let iframePoll = null;

  function hasPlayedPop() {
    try { return localStorage.getItem('zeroGrokPopPlayed_gemini') === '1'; } catch (_) { return false; }
  }
  function markPopPlayed() {
    try { localStorage.setItem('zeroGrokPopPlayed_gemini', '1'); } catch (_) {}
  }
  function playCanPopSound() {
    try {
      const url = chrome.runtime.getURL('assets/sounds/can-pop.wav');
      const audio = new Audio(url);
      audio.volume = 0.55;
      audio.play().catch(() => synthesizePop());
    } catch (_) { synthesizePop(); }
  }
  function synthesizePop() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ctx.currentTime;
      const o1 = ctx.createOscillator();
      const g1 = ctx.createGain();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(110, t0);
      o1.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
      g1.gain.setValueAtTime(0.5, t0);
      g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o1.connect(g1); g1.connect(ctx.destination);
      o1.start(t0); o1.stop(t0 + 0.25);
    } catch (_) {}
  }
  function spawnFizz(originEl) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height * 0.3;
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'zg-fizz-particle';
      const angle = (Math.PI * 2 * i) / 12;
      const dist = 30 + Math.random() * 30;
      p.style.left = cx + 'px'; p.style.top = cy + 'px';
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(angle) * dist - 15 + 'px');
      p.style.background = i % 2 ? '#4285f4' : '#fff';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  function loadSettings() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
        if (res) settings = { ...settings, ...res };
        if (settings.enableGemini === false) return;
        applyTheme();
        if (settings.hideCan) return;
        showCan();
        updateCanVisual(null);
      });
    } catch (_) {
      showCan();
      updateCanVisual(null);
    }
  }

  function applyTheme() {
    const dark = settings.theme === 'dark' ||
      (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('zg-dark', dark);
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
    // Fallback minimal can if can-ui missing
    canEl = document.createElement('div');
    canEl.id = 'zero-grok-can';
    canEl.innerHTML = '<div class="zg-can-body"><div class="zg-percent" id="zg-percent">--%</div></div>';
    canEl.addEventListener('click', togglePanel);
    document.body.appendChild(canEl);
    canEl.className = 'zg-can zg-pos-' + (settings.canPosition || 'bottom-right');
    return canEl;
  }

  function showCan() { createCan(); canEl.style.display = 'flex'; }

  function setLiquidColor(rem) {
    const liquid = canEl?.querySelector('.zg-liquid');
    if (!liquid) return;
    liquid.classList.remove('zg-ok', 'zg-warn', 'zg-critical');
    if (rem == null) liquid.style.fill = '#666';
    else if (rem <= 10) { liquid.classList.add('zg-critical'); liquid.style.fill = '#e74c3c'; }
    else if (rem <= 30) { liquid.classList.add('zg-warn'); liquid.style.fill = '#f39c12'; }
    else { liquid.classList.add('zg-ok'); liquid.style.fill = '#27ae60'; }
  }

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
    const liquidRect = canEl.querySelector('#zg-liquid-rect');
    const percentEl = canEl.querySelector('#zg-percent');
    const fullH = 88;
    const h = (rem == null || !Number.isFinite(rem)) ? 0 : (rem / 100) * fullH;
    if (liquidRect) {
      liquidRect.setAttribute('y', 20 + (fullH - h));
      liquidRect.setAttribute('height', Math.max(0, h));
    }
    if (percentEl) {
      if (rem == null || !Number.isFinite(rem)) {
        percentEl.textContent = '--%';
        percentEl.className = 'zg-percent';
        percentEl.style.color = '#888';
      } else {
        percentEl.textContent = `${Math.round(rem)}%`;
        percentEl.className = 'zg-percent ' + (rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok');
        percentEl.style.color = '';
      }
    }
    setLiquidColor(rem == null || !Number.isFinite(rem) ? null : rem);
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
        <div class="zg-footer"><button id="zg-refresh">Refresh</button></div>
      </div>`;
    panelEl.querySelector('.zg-close').onclick = () => { isExpanded = false; panelEl.classList.remove('zg-open'); };
    panelEl.querySelector('#zg-refresh').onclick = () => scrape();
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
    'signed-out': 'Sign in to Gemini, then Refresh',
    'no-data': 'Open gemini.google.com/usage once, then Refresh',
    'free-hint': 'If bars missing, Google may not expose % for this account yet',
    'unavailable': 'Usage page not available yet — try a chat first'
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

    if (big) big.textContent = (rem == null || !Number.isFinite(rem)) ? '--%' : `${Math.round(rem)}%`;
    if (label) label.textContent = data?.windowHint || 'remaining';
    if (bar) {
      bar.style.width = (rem == null || !Number.isFinite(rem)) ? '0%' : `${rem}%`;
      bar.className = 'zg-bar ' + ((rem == null || !Number.isFinite(rem)) ? '' : rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok');
    }
    if (reset) {
      reset.textContent = !data
        ? (STATUS_MESSAGES[lastStatus] || 'Sign in to Gemini, then Refresh')
        : [data.windowHint, data.resetHint].filter(Boolean).join(' · ');
    }
    if (weeklyRow && weeklyBar && weeklyLabel) {
      if (data && Number.isFinite(data.weeklyRemaining)) {
        weeklyRow.style.display = 'block';
        weeklyBar.style.width = `${data.weeklyRemaining}%`;
        weeklyLabel.textContent = `Weekly ${Math.round(data.weeklyRemaining)}% left` +
          (data.weeklyResetHint ? ` · ${data.weeklyResetHint}` : '');
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

  /** Parse Gemini usage page DOM (current = 5h, weekly = 7d). Values are % USED. */
  function extractFromDocument(doc) {
    if (!doc) return null;

    let currentUsed = null;
    let currentReset = '';
    let weeklyUsed = null;
    let weeklyReset = '';

    const currentEl =
      doc.querySelector('[data-test-id="gxu-currently"]') ||
      doc.querySelector('.gxu-currently') ||
      doc.querySelector('[data-test-id*="current"]');
    const weeklyEl =
      doc.querySelector('[data-test-id="gxu-weekly"]') ||
      doc.querySelector('.gxu-weekly') ||
      doc.querySelector('[data-test-id*="weekly"]');

    function readBlock(el, assignUsed, assignReset) {
      if (!el) return;
      const texts = Array.from(el.querySelectorAll('p, div, span, h1, h2, h3'))
        .map(n => (n.textContent || '').trim())
        .filter(Boolean);
      for (const text of texts) {
        const m = text.match(/(\d{1,3})\s*%\s*(?:used|used up)?/i) || text.match(/(\d{1,3})\s*%/);
        if (m && assignUsed.value == null) {
          const v = parseInt(m[1], 10);
          if (v >= 0 && v <= 100) assignUsed.value = v;
        }
        if (/reset/i.test(text) && !assignReset.value) assignReset.value = text;
      }
    }

    const cur = { value: null };
    const curR = { value: '' };
    const wk = { value: null };
    const wkR = { value: '' };
    readBlock(currentEl, cur, curR);
    readBlock(weeklyEl, wk, wkR);
    currentUsed = cur.value;
    currentReset = curR.value;
    weeklyUsed = wk.value;
    weeklyReset = wkR.value;

    // Text fallback across the page
    if (currentUsed == null || weeklyUsed == null) {
      const bodyText = doc.body?.innerText || '';
      const chunks = bodyText.split(/\n+/).map(s => s.trim()).filter(Boolean);

      for (let i = 0; i < chunks.length; i++) {
        const line = chunks[i];
        const pct = line.match(/(\d{1,3})\s*%/);
        if (!pct) continue;
        const val = parseInt(pct[1], 10);
        if (val < 0 || val > 100) continue;

        const context = (chunks[i - 1] || '') + ' ' + line + ' ' + (chunks[i + 1] || '');
        const lower = context.toLowerCase();
        const isWeekly = /week|weekly|7[\s-]?day/.test(lower);
        const isCurrent = /current|session|5[\s-]?hour|rolling|today|now/.test(lower) || !isWeekly;

        if (isWeekly && weeklyUsed == null) weeklyUsed = val;
        else if (isCurrent && currentUsed == null) currentUsed = val;

        if (/reset/i.test(line)) {
          if (isWeekly && !weeklyReset) weeklyReset = line;
          else if (!currentReset) currentReset = line;
        }
      }
    }

    // Progress-bar aria / style width as last resort
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
        const parentText = (bar.closest('section,div,article')?.textContent || '').toLowerCase();
        if (/week|weekly/.test(parentText) && weeklyUsed == null) weeklyUsed = Math.round(v);
        else if (currentUsed == null) currentUsed = Math.round(v);
      }
    }

    if (currentUsed == null && weeklyUsed == null) return null;

    // Prefer the tighter window for the can (higher used %)
    const buckets = [];
    if (currentUsed != null) {
      buckets.push({
        used: currentUsed,
        remaining: Math.max(0, 100 - currentUsed),
        hint: '5-hour session',
        reset: currentReset
      });
    }
    if (weeklyUsed != null) {
      buckets.push({
        used: weeklyUsed,
        remaining: Math.max(0, 100 - weeklyUsed),
        hint: 'Weekly',
        reset: weeklyReset
      });
    }
    buckets.sort((a, b) => b.used - a.used);
    const top = buckets[0];

    return {
      provider: 'gemini',
      usedPercent: top.used,
      remainingPercent: top.remaining,
      windowHint: top.hint,
      resetHint: top.reset || '',
      weeklyUsed: weeklyUsed,
      weeklyRemaining: weeklyUsed != null ? Math.max(0, 100 - weeklyUsed) : null,
      weeklyResetHint: weeklyReset || '',
      source: 'usage-page'
    };
  }

  function scrapeDomLimit() {
    const text = document.body?.innerText || '';
    const limitMatch = text.match(
      /you(?:'ve| have)?\s+(?:reached|hit)\s+(?:your\s+)?(?:usage\s+)?limit[^.]{0,120}/i
    ) || text.match(/usage\s+limit\s+(?:reached|exceeded)/i);
    if (!limitMatch) return null;
    const until = limitMatch[0].match(/(?:until|after|in|at)\s+([^.!?\n]{3,60})/i);
    return {
      provider: 'gemini',
      usedPercent: 100,
      remainingPercent: 0,
      windowHint: 'Limit reached',
      resetHint: until ? until[1].trim() : 'Wait for reset',
      source: 'dom-limit'
    };
  }

  function ensureIframe() {
    if (iframeEl && document.body.contains(iframeEl)) return iframeEl;
    iframeEl = document.createElement('iframe');
    iframeEl.id = 'zero-grok-gemini-usage-iframe';
    iframeEl.src = 'https://gemini.google.com/usage';
    iframeEl.setAttribute('aria-hidden', 'true');
    Object.assign(iframeEl.style, {
      position: 'fixed', width: '0', height: '0', border: 'none',
      opacity: '0', pointerEvents: 'none', left: '-9999px', top: '0'
    });
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
            if (attempts >= 25) {
              clearInterval(iframePoll);
              iframePoll = null;
              resolve(null);
            }
            return;
          }
          const title = (doc.title || '').toLowerCase();
          if (title.includes('sign in') || title.includes('login')) {
            clearInterval(iframePoll);
            iframePoll = null;
            resolve(null);
            return;
          }
          const data = extractFromDocument(doc);
          if (data) {
            data.source = 'usage-iframe';
            clearInterval(iframePoll);
            iframePoll = null;
            resolve(data);
            return;
          }
        } catch (_) {
          // cross-origin redirect to accounts.google.com
          if (attempts >= 8) {
            clearInterval(iframePoll);
            iframePoll = null;
            resolve(null);
          }
        }
        if (attempts >= 25) {
          clearInterval(iframePoll);
          iframePoll = null;
          resolve(null);
        }
      }, 400);
    });
  }

  async function scrapeViaFetch() {
    try {
      const res = await fetch('https://gemini.google.com/usage?t=' + Date.now(), {
        credentials: 'include',
        cache: 'no-store'
      });
      if (res.status === 401 || res.status === 403) return { auth: true };
      if (!res.ok) return null;
      const html = await res.text();
      if (/accounts\.google\.com|Sign in/i.test(html) && !/%\s*used/i.test(html)) {
        return { auth: true };
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const data = extractFromDocument(doc);
      if (data) data.source = 'usage-fetch';
      return data;
    } catch (e) {
      console.warn('[Zero Grok] Gemini fetch error', e.message);
      return null;
    }
  }

  async function scrape() {
    console.log('[Zero Grok] Gemini scrape…');

    // 1) Fast path: fetch usage page HTML
    let data = await scrapeViaFetch();
    if (data && data.auth) {
      applyUsage(null, 'signed-out');
      return;
    }
    if (data && Number.isFinite(data.remainingPercent)) {
      applyUsage(data, 'ok');
      return;
    }

    // 2) Iframe (SPA-rendered usage page)
    console.log('[Zero Grok] Gemini trying iframe fallback…');
    data = await scrapeViaIframe();
    if (data && Number.isFinite(data.remainingPercent)) {
      applyUsage(data, 'ok');
      return;
    }

    // 3) On-page limit banner
    data = scrapeDomLimit();
    if (data) {
      applyUsage(data, 'ok');
      return;
    }

    applyUsage(null, currentUsage ? 'unavailable' : 'no-data');
  }

  // Refresh after generation finishes (send ↔ stop button transitions)
  function watchGeneration() {
    let wasGenerating = false;
    const check = () => {
      const stop =
        document.querySelector('button[aria-label*="Stop" i]') ||
        document.querySelector('button[aria-label*="stop generating" i]') ||
        document.querySelector('[data-test-id*="stop"]');
      const generating = !!stop;
      if (wasGenerating && !generating) {
        setTimeout(scrape, 1200);
      }
      wasGenerating = generating;
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
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

  loadSettings();
  setTimeout(scrape, 1800);
  setTimeout(scrape, 6000);
  setInterval(scrape, 90_000);
  watchGeneration();
  console.log('[Zero Grok] Gemini ready (usage page scrape)');
})();

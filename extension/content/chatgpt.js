/**
 * Zero Grok – ChatGPT
 * Auth: Bearer accessToken from /api/auth/session
 * Usage: conversation limit APIs + settings page scrape + local estimate
 */
(async function () {
  'use strict';
  if (window.__ZERO_GROK_CHATGPT__) return;
  window.__ZERO_GROK_CHATGPT__ = true;

  let currentUsage = null;
  let canEl = null;
  let panelEl = null;
  let isExpanded = false;
  let settings = { canPosition: 'bottom-right', theme: 'auto', enableChatgpt: true, estimateMessagesEnabled: true, soundEnabled: true };
  let accessToken = null;
  let estimateCount = 0;
  const estimateCap = 40;

  function loadSettings() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
        if (res) settings = { ...settings, ...res };
        if (settings.enableChatgpt === false) return;
        if (settings.hideCan) return;
        showCan();
        updateCanVisual(null);
      });
    } catch (_) { showCan(); updateCanVisual(null); }
  }

  function createCan() {
    if (canEl) return canEl;
    if (window.ZeroGrokCanUI) {
      canEl = window.ZeroGrokCanUI.mountCan({ provider: 'chatgpt', settings, onClick: togglePanel, colors: { a: '#10a37f', b: '#fff' } });
      return canEl;
    }
    canEl = document.createElement('div');
    canEl.id = 'zero-grok-can-chatgpt';
    canEl.classList.add('zg-can-root');
    canEl.dataset.provider = 'chatgpt';
    canEl.innerHTML = '<div class="zg-can-body"><div class="zg-percent" id="zg-percent">--%</div></div>';
    canEl.addEventListener('click', togglePanel);
    document.body.appendChild(canEl);
    canEl.className = 'zg-can-root zg-can zg-pos-' + (settings.canPosition || 'bottom-right');
    return canEl;
  }
  function showCan() { createCan(); canEl.style.display = 'flex'; }

  function updateCanVisual(data) {
    if (!canEl) return;
    const rem = data?.remainingPercent;
    if (window.ZeroGrokCanUI) {
      window.ZeroGrokCanUI.setLiquidLevel(canEl, rem);
      return;
    }
    const percentEl = canEl.querySelector('#zg-percent');
    if (percentEl) {
      if (data?.source === 'free-no-data') percentEl.textContent = 'Free';
      else percentEl.textContent = (rem == null || !Number.isFinite(rem)) ? '--%' : Math.round(rem) + '%';
    }
  }

  function createPanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'zero-grok-panel';
    panelEl.innerHTML = `<div class="zg-panel-header"><span>Zero · ChatGPT</span><button class="zg-close">×</button></div>
      <div class="zg-panel-body">
        <div class="zg-big-percent" id="zg-big-percent">--%</div>
        <div class="zg-label" id="zg-label">remaining</div>
        <div class="zg-bar-wrap"><div class="zg-bar" id="zg-bar"></div></div>
        <div class="zg-reset" id="zg-reset">Waiting…</div>
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

  let lastStatus = 'signed-out';
  const STATUS = {
    'signed-out': 'Sign in to ChatGPT, then Refresh',
    'no-data': 'Could not read usage yet',
    'no-endpoint': 'Free tier: no live % until limit banners appear'
  };

  function updatePanel(data) {
    if (!panelEl) return;
    const rem = data?.remainingPercent;
    const big = panelEl.querySelector('#zg-big-percent');
    const bar = panelEl.querySelector('#zg-bar');
    const reset = panelEl.querySelector('#zg-reset');
    const label = panelEl.querySelector('#zg-label');
    if (big) {
      if (data?.source === 'free-no-data') big.textContent = 'Free';
      else big.textContent = (rem == null || !Number.isFinite(rem)) ? '--%' : Math.round(rem) + '%';
    }
    if (label) label.textContent = data?.windowHint || 'remaining';
    if (bar) {
      bar.style.width = (rem == null || !Number.isFinite(rem)) ? '0%' : rem + '%';
      bar.className = 'zg-bar ' + ((rem == null || !Number.isFinite(rem)) ? '' : rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok');
    }
    if (reset) reset.textContent = !data ? (STATUS[lastStatus] || STATUS['no-data']) : [data.windowHint, data.resetHint].filter(Boolean).join(' · ');
  }

  function applyUsage(data, status) {
    lastStatus = status || 'signed-out';
    if (!data || (data.source !== 'free-no-data' && !Number.isFinite(data.remainingPercent))) {
      currentUsage = null; updateCanVisual(null); updatePanel(null); return;
    }
    currentUsage = data;
    updateCanVisual(data);
    updatePanel(data);
    try { chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: data }); } catch (_) {}
    console.log('[Zero Grok] ChatGPT OK', data.remainingPercent, data.source);
  }

  async function fetchSession() {
    try {
      const res = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      accessToken = json.accessToken || json.access_token || null;
      return accessToken;
    } catch (_) { return null; }
  }

  async function fetchWithAuth(url) {
    if (!accessToken) await fetchSession();
    const headers = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    return fetch(url, { credentials: 'include', headers, cache: 'no-store' });
  }

  function normalizeLimitJson(json) {
    if (!json || typeof json !== 'object') return null;
    let remaining = null, limit = null, used = null;
    const stack = [json];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object') continue;
      for (const [k, v] of Object.entries(n)) {
        const key = k.toLowerCase();
        if (typeof v === 'number' && Number.isFinite(v)) {
          if (/remaining|left|available/.test(key) && remaining == null) remaining = v;
          if (/limit|cap|total|max/.test(key) && limit == null) limit = v;
          if (/used|consumed|percent|utilization/.test(key) && used == null && v >= 0 && v <= 100) used = v;
        } else if (v && typeof v === 'object') stack.push(v);
      }
    }
    if (remaining != null && limit != null && limit > 0) {
      const remPct = Math.max(0, Math.min(100, (remaining / limit) * 100));
      return { provider: 'chatgpt', remainingPercent: remPct, usedPercent: 100 - remPct, windowHint: 'Session', resetHint: remaining + ' / ' + limit + ' left', source: 'api-limit' };
    }
    if (used != null) return { provider: 'chatgpt', usedPercent: used, remainingPercent: Math.max(0, 100 - used), windowHint: 'Usage', resetHint: '', source: 'api-percent' };
    return null;
  }

  function scrapeDom() {
    // Prefer scoped UI surfaces over full-page text to avoid matching chat content
    // (e.g. "what happens when you have reached your usage limit on AWS?").
    const candidates = [];
    const selectors = [
      '[role="alert"]',
      '[role="status"]',
      '[data-testid*="limit"]',
      '[data-testid*="usage"]',
      '[class*="toast"]',
      '[class*="banner"]',
      '[class*="notice"]',
      '[class*="alert"]',
      'nav',
      'header',
      '[class*="sidebar"]',
      '[class*="settings"]'
    ];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const t = (el.innerText || el.textContent || '').trim();
          if (t && t.length < 800) candidates.push(t);
        });
      } catch (_) {}
    }

    // Require "used|remaining|left" so bare "20%" in chat replies is ignored
    const pctRe = /(\d{1,3})\s*%\s*(?:used|remaining|left)\b/i;
    for (const text of candidates) {
      const m = text.match(pctRe);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v < 0 || v > 100) continue;
        const isRem = /remaining|left/i.test(m[0]);
        return {
          provider: 'chatgpt',
          remainingPercent: isRem ? v : Math.max(0, 100 - v),
          usedPercent: isRem ? Math.max(0, 100 - v) : v,
          windowHint: 'DOM',
          resetHint: '',
          source: 'dom-heuristic'
        };
      }
    }

    // Limit banner: only trust when near UI markers (disabled input / try-again)
    const limitRe = /you(?:'ve| have)?\s+(?:reached|hit)\s+(?:your\s+)?(?:usage\s+|message\s+)?limit/i;
    const hasLimitUi =
      !!document.querySelector('button[disabled], [aria-disabled="true"]') ||
      /try again|come back|upgrade|buy more/i.test(document.body?.innerText?.slice(0, 5000) || '');
    for (const text of candidates) {
      if (limitRe.test(text) && hasLimitUi) {
        return {
          provider: 'chatgpt',
          usedPercent: 100,
          remainingPercent: 0,
          windowHint: 'Limit reached',
          resetHint: 'Wait for reset',
          source: 'dom-limit'
        };
      }
    }
    return null;
  }

  async function scrape() {
    console.log('[Zero Grok] ChatGPT scrape…');
    try {
      for (const p of ['/backend-api/conversation/init', '/public-api/conversation_limit', '/backend-api/models']) {
        try {
          const res = await fetchWithAuth('https://chatgpt.com' + p);
          if (res.status === 401) { applyUsage(null, 'signed-out'); return; }
          if (!res.ok) continue;
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('json')) continue;
          const data = normalizeLimitJson(await res.json());
          if (data) { applyUsage(data, 'ok'); return; }
        } catch (_) {}
      }
    } catch (_) {}
    const dom = scrapeDom();
    if (dom) { applyUsage(dom, 'ok'); return; }
    if (!accessToken) await fetchSession();
    if (!accessToken) { applyUsage(null, 'signed-out'); return; }
    applyUsage({ provider: 'chatgpt', remainingPercent: null, windowHint: 'Free / no live meter', resetHint: 'Open Settings or wait for limit banner', source: 'free-no-data' }, 'no-endpoint');
  }

  function bumpEstimate() {
    if (!settings.estimateMessagesEnabled) return;
    estimateCount += 1;
    const used = Math.min(100, (estimateCount / estimateCap) * 100);
    if (currentUsage && Number.isFinite(currentUsage.remainingPercent) && currentUsage.source !== 'estimate') return;
    applyUsage({ provider: 'chatgpt', usedPercent: used, remainingPercent: Math.max(0, 100 - used), windowHint: 'Estimate', resetHint: estimateCount + ' local msgs — not official', source: 'estimate' }, 'estimate');
  }

  document.addEventListener('submit', () => { bumpEstimate(); setTimeout(scrape, 2500); }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.getAttribute('contenteditable') === 'true')) {
        bumpEstimate(); setTimeout(scrape, 2500);
      }
    }
  }, true);

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'SCRAPE_USAGE') { scrape().then(() => sendResponse({ ok: true })); return true; }
  });

  loadSettings();
  setTimeout(scrape, 1500);
  setTimeout(scrape, 5000);
  setInterval(scrape, 30_000);
  console.log('[Zero Grok] ChatGPT ready (Bearer auth + pop + live refresh)');
})();

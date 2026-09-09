/**
 * Zero Grok – Content Script
 * Free tier priority + Diet Coke style can animations + first-use pop sound
 */

(async function () {
  'use strict';

  if (window.__ZERO_GROK_INJECTED__) return;
  window.__ZERO_GROK_INJECTED__ = true;

  const FREE_PROBES = [
    { modelName: 'grok-3', requestKind: 'DEFAULT', label: 'Fast' },
    { modelName: 'fast', requestKind: null, label: 'Fast' },
    { modelName: 'grok-3', requestKind: 'REASONING', label: 'Think' },
    { modelName: 'auto', requestKind: null, label: 'Auto' }
  ];

  let currentUsage = null;
  let settings = { canPosition: 'bottom-right', theme: 'auto', hideCan: false, enableGrok: true, soundEnabled: true };
  let canEl = null;
  let panelEl = null;
  let isExpanded = false;

  // ---------- Settings ----------
  function loadSettings() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res) settings = { ...settings, ...res };
        applyTheme();
        if (settings.enableGrok === false) return;
        settings.hideCan ? hideCan() : showCan();
      });
    } catch (_) {}
  }

  function applyTheme() {
    const dark = settings.theme === 'dark' ||
      (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('zg-dark', dark);
  }

  // ---------- Can UI (shared via can-ui.js) ----------
  function createCan() {
    if (canEl) return canEl;
    if (window.ZeroGrokCanUI) {
      canEl = window.ZeroGrokCanUI.mountCan({
        provider: 'grok',
        settings,
        onClick: togglePanel,
        colors: { a: '#c41e3a', b: '#fff' }
      });
      return canEl;
    }
    // Minimal fallback if shared UI scripts failed to load
    canEl = document.createElement('div');
    canEl.id = 'zero-grok-can-grok';
    canEl.classList.add('zg-can-root');
    canEl.dataset.provider = 'grok';
    canEl.setAttribute('aria-label', 'Zero Grok usage meter');
    canEl.innerHTML = '<div class="zg-can-body"><div class="zg-percent" id="zg-percent">--%</div></div>';
    canEl.addEventListener('click', togglePanel);
    document.body.appendChild(canEl);
    canEl.className = 'zg-can-root zg-can zg-pos-' + (settings.canPosition || 'bottom-right');
    return canEl;
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
    const percentEl = canEl.querySelector('#zg-percent');
    if (percentEl) {
      percentEl.textContent = rem == null ? '--%' : `${Math.round(rem)}%`;
    }
  }

  function showCan() { createCan(); if (canEl) canEl.style.display = 'flex'; }
  function hideCan() { if (canEl) canEl.style.display = 'none'; }

  // ---------- Panel ----------
  function createPanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'zero-grok-panel';
    panelEl.innerHTML = `
      <div class="zg-panel-header">
        <span>Zero Grok</span>
        <button class="zg-close">×</button>
      </div>
      <div class="zg-panel-body">
        <div class="zg-big-percent" id="zg-big-percent">--%</div>
        <div class="zg-label" id="zg-label">remaining</div>
        <div class="zg-bar-wrap"><div class="zg-bar" id="zg-bar"></div></div>
        <div class="zg-reset" id="zg-reset"></div>
        <div class="zg-products" id="zg-products"></div>
        <div class="zg-footer">
          <button id="zg-refresh">Refresh</button>
        </div>
      </div>`;
    panelEl.querySelector('.zg-close').onclick = () => {
      isExpanded = false;
      panelEl.classList.remove('zg-open');
    };
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

  function updatePanel(data) {
    if (!panelEl) return;
    const rem = data?.remainingPercent;
    const big = panelEl.querySelector('#zg-big-percent');
    const bar = panelEl.querySelector('#zg-bar');
    const reset = panelEl.querySelector('#zg-reset');
    const label = panelEl.querySelector('#zg-label');
    const products = panelEl.querySelector('#zg-products');
    if (big) big.textContent = rem == null ? '--%' : `${Math.round(rem)}%`;
    if (label) label.textContent = data?.windowHint || 'remaining';
    if (bar) {
      bar.style.width = rem == null ? '0%' : `${rem}%`;
      bar.className = 'zg-bar ' + (rem == null ? '' : rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok');
    }
    if (reset) reset.textContent = [data?.resetHint, data?.source].filter(Boolean).join(' · ');
    if (products) {
      products.innerHTML = data?.isFree
        ? '<div class="zg-hint">Free tier</div>'
        : '<div class="zg-hint">Open Settings → Usage for breakdown</div>';
    }
  }

  // ---------- Free rate-limits (primary) ----------
  function normalizeRateLimitPayload(data, label) {
    if (!data || typeof data !== 'object') return null;
    let remaining = data.remainingQueries ?? data.remaining;
    let total = data.totalQueries ?? data.total;
    if (remaining == null && data.lowEffortRateLimits) {
      remaining = data.lowEffortRateLimits.remainingQueries;
      total = data.lowEffortRateLimits.totalQueries ?? total;
    }
    if (remaining == null && data.highEffortRateLimits) {
      remaining = data.highEffortRateLimits.remainingQueries;
      total = data.highEffortRateLimits.totalQueries ?? total;
    }
    remaining = Number(remaining);
    total = Number(total);
    if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) return null;
    const remainingPercent = Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
    let windowHint = 'Free tier · rolling window';
    if (data.windowSizeSeconds) {
      const h = Math.round(data.windowSizeSeconds / 3600);
      if (h > 0) windowHint = `Free · ${h}h window`;
    }
    return {
      provider: 'grok',
      isFree: true,
      remaining,
      total,
      remainingPercent,
      usedPercent: 100 - remainingPercent,
      windowHint,
      resetHint: label || '',
      source: 'rate-limits'
    };
  }

  async function fetchFreeRateLimits() {
    for (const probe of FREE_PROBES) {
      try {
        const body = { modelName: probe.modelName };
        if (probe.requestKind) body.requestKind = probe.requestKind;
        const res = await fetch('https://grok.com/rest/rate-limits', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) continue;
        const json = await res.json();
        const normalized = normalizeRateLimitPayload(json, probe.label);
        if (normalized) return normalized;
      } catch (_) {}
    }
    return null;
  }

  async function fetchPaidWeekly() {
    try {
      const res = await fetch('https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/grpc-web+proto',
          'x-grpc-web': '1',
          accept: 'application/grpc-web+proto'
        },
        body: new Uint8Array([0, 0, 0, 0, 0])
      });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      for (let i = 0; i < buf.length - 4; i++) {
        const f = new DataView(buf.buffer, buf.byteOffset + i, 4).getFloat32(0, true);
        if (f > 0.01 && f <= 100) {
          return {
            isFree: false, usedPercent: f,
            remainingPercent: Math.max(0, 100 - f),
            products: [], source: 'grpc'
          };
        }
      }
    } catch (_) {}
    return null;
  }

  function installNetworkHook() {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        if (url.includes('rate-limits')) {
          const clone = response.clone();
          clone.json().then(json => {
            const normalized = normalizeRateLimitPayload(json, 'live');
            if (normalized) {
              console.log('[Zero Grok] intercepted live rate-limits', normalized);
              currentUsage = normalized;
              updateCanVisual(normalized);
              updatePanel(normalized);
              try {
                if (window.ZeroGrokCanFx) {
                  window.ZeroGrokCanFx.trackRefill('grok', normalized.remainingPercent, canEl, settings.soundEnabled !== false, { a: '#c41e3a', b: '#fff' });
                }
                if (window.ZeroGrokCanFx) {
                  if (normalized.remainingPercent != null && normalized.remainingPercent <= 2) {
                    window.ZeroGrokCanFx.startLimitCountdown({
                      provider: 'grok',
                      canEl,
                      resetMs: window.ZeroGrokCanFx.resolveResetMs(normalized),
                      soundEnabled: settings.soundEnabled !== false
                    });
                  } else {
                    window.ZeroGrokCanFx.stopLimitCountdown('grok');
                  }
                }
              } catch (_) {}
              try { chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: normalized }); } catch (_) {}
            }
          }).catch(() => {});
        }
      } catch (_) {}
      return response;
    };
  }

  async function scrape() {
    let data = await fetchFreeRateLimits();
    if (!data) data = await fetchPaidWeekly();
    if (data) {
      currentUsage = data;
      updateCanVisual(data);
      updatePanel(data);
      try {
        if (window.ZeroGrokCanFx) {
          window.ZeroGrokCanFx.trackRefill('grok', data.remainingPercent, canEl, settings.soundEnabled !== false, { a: '#c41e3a', b: '#fff' });
        }
        if (window.ZeroGrokCanFx) {
          if (data.remainingPercent != null && data.remainingPercent <= 2) {
            window.ZeroGrokCanFx.startLimitCountdown({
              provider: 'grok',
              canEl,
              resetMs: window.ZeroGrokCanFx.resolveResetMs(data),
              soundEnabled: settings.soundEnabled !== false
            });
          } else {
            window.ZeroGrokCanFx.stopLimitCountdown('grok');
          }
        }
      } catch (_) {}
      try { chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: data }); } catch (_) {}
    }
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'SCRAPE_USAGE') {
      scrape().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'TOGGLE_CAN') {
      if (!canEl) createCan();
      const hidden = canEl.style.display === 'none' || canEl.classList.contains('zg-user-hidden');
      if (hidden) { canEl.style.display = 'flex'; canEl.classList.remove('zg-user-hidden'); }
      else { canEl.classList.add('zg-user-hidden'); canEl.style.display = 'none'; }
      sendResponse({ ok: true });
      return true;
    }
  });

  loadSettings();
  installNetworkHook();
  setTimeout(scrape, 1200);
  setTimeout(scrape, 4000);
  setInterval(scrape, 60_000);
  console.log('[Zero Grok] content ready');
})();

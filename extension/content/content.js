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
  let firstUseDone = false;

  // ---------- First-use detection + pop sound ----------
  function hasPlayedPop() {
    try { return localStorage.getItem('zeroGrokPopPlayed') === '1'; } catch (_) { return false; }
  }
  function markPopPlayed() {
    try { localStorage.setItem('zeroGrokPopPlayed', '1'); } catch (_) {}
  }

  function playCanPopSound() {
    try {
      // Prefer extension asset
      const url = chrome.runtime.getURL('assets/sounds/can-pop.wav');
      const audio = new Audio(url);
      audio.volume = 0.55;
      audio.play().catch(() => {
        // Fallback: Web Audio synthesized pop if file blocked
        synthesizePop();
      });
    } catch (_) {
      synthesizePop();
    }
  }

  function synthesizePop() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ctx.currentTime;
      // Thump
      const o1 = ctx.createOscillator();
      const g1 = ctx.createGain();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(110, t0);
      o1.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
      g1.gain.setValueAtTime(0.5, t0);
      g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o1.connect(g1); g1.connect(ctx.destination);
      o1.start(t0); o1.stop(t0 + 0.25);
      // Click / fizz noise burst
      const bufferSize = ctx.sampleRate * 0.12;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.3, t0);
      ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      noise.connect(ng); ng.connect(ctx.destination);
      noise.start(t0);
    } catch (_) {}
  }

  function spawnFizzParticles(originEl) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height * 0.3;
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('div');
      p.className = 'zg-fizz-particle';
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const dist = 30 + Math.random() * 40;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(angle) * dist - 20 + 'px');
      p.style.background = i % 3 === 0 ? '#c41e3a' : 'rgba(255,255,255,0.85)';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 850);
    }
  }

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

  // ---------- Can UI (Diet Coke style) ----------
  function createCan() {
    if (canEl) return canEl;

    canEl = document.createElement('div');
    canEl.id = 'zero-grok-can';
    canEl.setAttribute('aria-label', 'Zero Grok usage meter');
    canEl.innerHTML = `
      <div class="zg-can-body">
        <svg class="zg-can-svg" viewBox="0 0 64 128" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <!-- Classic Diet Coke silver metallic body -->
            <linearGradient id="zg-can-metal" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#2c2c2c"/>
              <stop offset="12%" stop-color="#7a7a7a"/>
              <stop offset="28%" stop-color="#c8c8c8"/>
              <stop offset="42%" stop-color="#efefef"/>
              <stop offset="55%" stop-color="#d0d0d0"/>
              <stop offset="72%" stop-color="#9a9a9a"/>
              <stop offset="88%" stop-color="#5a5a5a"/>
              <stop offset="100%" stop-color="#1e1e1e"/>
            </linearGradient>
            <!-- Red Diet Coke band -->
            <linearGradient id="zg-red-band" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#e31837"/>
              <stop offset="50%" stop-color="#c41e3a"/>
              <stop offset="100%" stop-color="#9b1020"/>
            </linearGradient>
            <linearGradient id="zg-liquid-grad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#e63950"/>
              <stop offset="100%" stop-color="#8b0a1a"/>
            </linearGradient>
            <clipPath id="zg-body-clip">
              <rect x="10" y="16" width="44" height="96" rx="6" ry="6"/>
            </clipPath>
            <clipPath id="zg-liquid-clip">
              <rect id="zg-liquid-rect" x="12" y="20" width="40" height="88" rx="4"/>
            </clipPath>
          </defs>

          <!-- Bottom lip -->
          <ellipse cx="32" cy="114" rx="20" ry="4.5" fill="#3a3a3a" opacity="0.9"/>
          <ellipse cx="32" cy="112.5" rx="18.5" ry="3.2" fill="#555"/>

          <!-- Main can cylinder -->
          <rect x="10" y="16" width="44" height="96" rx="6" ry="6" fill="url(#zg-can-metal)" stroke="#1a1a1a" stroke-width="0.8"/>

          <!-- Liquid fill -->
          <g clip-path="url(#zg-liquid-clip)">
            <rect x="12" y="20" width="40" height="88" class="zg-liquid" fill="url(#zg-liquid-grad)"/>
            <g class="zg-bubbles">
              <circle class="zg-bubble" cx="22" cy="95" r="2.0" style="animation-duration:2.5s;animation-delay:0s"/>
              <circle class="zg-bubble" cx="34" cy="98" r="1.5" style="animation-duration:3.2s;animation-delay:0.3s"/>
              <circle class="zg-bubble" cx="28" cy="90" r="1.8" style="animation-duration:2.8s;animation-delay:0.8s"/>
              <circle class="zg-bubble" cx="40" cy="96" r="1.3" style="animation-duration:3.5s;animation-delay:1.1s"/>
              <circle class="zg-bubble" cx="19" cy="100" r="1.6" style="animation-duration:2.9s;animation-delay:0.5s"/>
              <circle class="zg-bubble" cx="36" cy="85" r="1.2" style="animation-duration:3.8s;animation-delay:1.5s"/>
              <circle class="zg-bubble" cx="25" cy="88" r="1.4" style="animation-duration:3.1s;animation-delay:1.9s"/>
            </g>
          </g>

          <!-- Classic red horizontal band (Diet Coke style) -->
          <g clip-path="url(#zg-body-clip)">
            <rect x="10" y="48" width="44" height="28" fill="url(#zg-red-band)"/>
            <!-- Subtle highlight on band -->
            <rect x="10" y="48" width="44" height="4" fill="rgba(255,255,255,0.15)"/>
          </g>

          <!-- Condensation droplets -->
          <g class="zg-condensation">
            <circle cx="13" cy="30" r="1.0" style="animation-delay:0s"/>
            <circle cx="51" cy="38" r="0.85" style="animation-delay:1.1s"/>
            <circle cx="12" cy="72" r="0.95" style="animation-delay:0.6s"/>
            <circle cx="52" cy="80" r="0.75" style="animation-delay:2.0s"/>
            <circle cx="14" cy="95" r="0.7" style="animation-delay:1.5s"/>
          </g>

          <!-- Top rim -->
          <ellipse cx="32" cy="16" rx="20" ry="5" fill="#b8b8b8" stroke="#666" stroke-width="0.7"/>
          <ellipse cx="32" cy="15" rx="17" ry="3.5" fill="#d8d8d8"/>
          <!-- Pull tab -->
          <ellipse cx="32" cy="14.2" rx="7" ry="2.4" fill="#c0c0c0" stroke="#888" stroke-width="0.5"/>
          <rect x="30.5" y="11.5" width="3" height="3.5" rx="0.8" fill="#aaa" stroke="#777" stroke-width="0.4"/>

          <!-- ZERO GROK branding on the red band -->
          <text x="32" y="60" text-anchor="middle" class="zg-can-label"
                font-family="Arial Black, Helvetica, sans-serif"
                font-size="11" font-weight="900" fill="#fff"
                letter-spacing="1.2">ZERO</text>
          <text x="32" y="71" text-anchor="middle" class="zg-can-sub"
                font-family="Arial Black, Helvetica, sans-serif"
                font-size="9" font-weight="700" fill="#fff"
                letter-spacing="1.5">GROK</text>
        </svg>
        <div class="zg-percent" id="zg-percent">--%</div>
      </div>
    `;

    canEl.addEventListener('click', togglePanel);
    document.body.appendChild(canEl);
    positionCan();
    if (window.ZeroGrokCanUI) {
      window.ZeroGrokCanUI.makeDraggable(canEl, 'grok');
      window.ZeroGrokCanUI.applyPosition(canEl, settings, 'grok');
    } else {
      makeDraggable(canEl);
    }

    // First-use pop (+ shared can-fx for refill later)
    if (window.ZeroGrokCanFx) {
      firstUseDone = true;
      window.ZeroGrokCanFx.playFirstUse(canEl, 'grok', settings.soundEnabled !== false, { a: '#c41e3a', b: '#fff' });
    } else if (!hasPlayedPop()) {
      firstUseDone = true;
      canEl.classList.add('zg-pop-in');
      setTimeout(() => {
        playCanPopSound();
        spawnFizzParticles(canEl);
        markPopPlayed();
      }, 280);
      setTimeout(() => canEl.classList.remove('zg-pop-in'), 800);
    }

    return canEl;
  }

  function positionCan() {
    if (!canEl) return;
    canEl.className = `zg-can zg-pos-${settings.canPosition || 'bottom-right'}`;
    // Keep pop class if still animating
  }

  function updateCanVisual(data) {
    if (!canEl) return;
    const rem = data?.remainingPercent;
    const liquidRect = canEl.querySelector('#zg-liquid-rect');
    const percentEl = canEl.querySelector('#zg-percent');
    const liquid = canEl.querySelector('.zg-liquid');

    const fullH = 88;
    const h = rem == null ? 0 : (rem / 100) * fullH;
    const y = 20 + (fullH - h);
    if (liquidRect) {
      liquidRect.setAttribute('y', y);
      liquidRect.setAttribute('height', Math.max(0, h));
    }

    if (percentEl) {
      percentEl.textContent = rem == null ? '--%' : `${Math.round(rem)}%`;
      percentEl.className = 'zg-percent ' + (
        rem == null ? '' : rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok'
      );
      if (data?.remaining != null && data?.total != null) {
        percentEl.title = `${data.remaining} / ${data.total} left`;
      }
    }

    if (liquid) {
      liquid.removeAttribute('fill');
      liquid.classList.remove('zg-ok', 'zg-warn', 'zg-critical');
      if (rem == null) {
        liquid.style.fill = '#666';
      } else if (rem <= 10) {
        liquid.classList.add('zg-critical');
        liquid.style.fill = '#e74c3c';
      } else if (rem <= 30) {
        liquid.classList.add('zg-warn');
        liquid.style.fill = '#f39c12';
      } else {
        liquid.classList.add('zg-ok');
        liquid.style.fill = '#27ae60';
      }
    }
  }

  function showCan() { createCan(); canEl.style.display = 'flex'; }
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
    panelEl.querySelector('#zg-refresh').onclick = () => scrapeAndUpdate(true);
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
    const label = panelEl.querySelector('#zg-label');
    const bar = panelEl.querySelector('#zg-bar');
    const reset = panelEl.querySelector('#zg-reset');
    const products = panelEl.querySelector('#zg-products');

    if (big) {
      if (rem == null) big.textContent = '--%';
      else if (data.isFree && data.remaining != null) {
        big.textContent = String(data.remaining);
        if (label) label.textContent = `of ${data.total} left · ${Math.round(rem)}%`;
      } else {
        big.textContent = `${Math.round(rem)}%`;
        if (label) label.textContent = 'remaining this week';
      }
    }
    if (bar) {
      bar.style.width = rem == null ? '0%' : `${rem}%`;
      bar.className = 'zg-bar ' + (rem == null ? '' : rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok');
    }
    if (reset) {
      reset.textContent = data?.windowHint || data?.source || (data?.isFree ? 'Free tier · rolling window' : '');
    }
    if (products) {
      products.innerHTML = data?.isFree
        ? '<div class="zg-hint">Free account · Diet Coke energy</div>'
        : '<div class="zg-hint">Open Settings → Usage for breakdown</div>';
    }
  }

  function makeDraggable(el) {
    let ox = 0, oy = 0, dragging = false;
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true;
      ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top;
      el.style.transition = 'none';
      el.style.animation = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      el.style.left = (e.clientX - ox) + 'px';
      el.style.top = (e.clientY - oy) + 'px';
      el.style.right = el.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        el.style.transition = '';
        el.style.animation = '';
      }
    });
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
      windowHint = h >= 1 ? `Rolling ~${h}h window` : `Rolling ~${Math.round(data.windowSizeSeconds / 60)}m window`;
    }
    return {
      isFree: true, remaining, total, remainingPercent,
      usedPercent: 100 - remainingPercent, products: [],
      source: 'rate-limits', windowHint, label
    };
  }

  async function fetchFreeRateLimits() {
    for (const probe of FREE_PROBES) {
      try {
        const body = probe.requestKind
          ? { requestKind: probe.requestKind, modelName: probe.modelName }
          : { modelName: probe.modelName };
        const res = await fetch('https://grok.com/rest/rate-limits', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.status === 401) return { unauthorized: true };
        if (!res.ok) continue;
        const json = await res.json();
        const normalized = normalizeRateLimitPayload(json, probe.label);
        if (normalized) {
          console.log('[Zero Grok] FREE hit', probe.label, normalized.remaining, '/', normalized.total);
          return normalized;
        }
      } catch (e) {
        console.debug('[Zero Grok] rate-limits error', e.message);
      }
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
              } catch (_) {}
              try {
                if (window.ZeroGrokCanFx) {
                  const panelReset = panelEl && panelEl.querySelector('#zg-reset');
                  if (normalized.remainingPercent != null && normalized.remainingPercent <= 2) {
                    window.ZeroGrokCanFx.startLimitCountdown({
                      provider: 'grok',
                      data: normalized,
                      canEl,
                      panelResetEl: panelReset,
                      onRefilled: () => { try { scrapeAndUpdate(); } catch (_) { try { scrape(); } catch(_){} } }
                    });
                  } else {
                    window.ZeroGrokCanFx.stopLimitCountdown('grok');
                    canEl && canEl.classList.remove('zg-at-limit');
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

  async function scrapeAndUpdate() {
    console.log('[Zero Grok] scrape…');
    let data = await fetchFreeRateLimits();
    if (data?.unauthorized) { updateCanVisual(null); return; }
    if (!data) data = await fetchPaidWeekly();
    if (data) {
      currentUsage = data;
      updateCanVisual(data);
      updatePanel(data);
      try {
        if (window.ZeroGrokCanFx) {
          window.ZeroGrokCanFx.trackRefill('grok', data.remainingPercent, canEl, settings.soundEnabled !== false, { a: '#c41e3a', b: '#fff' });
        }
      } catch (_) {}
      try {
        if (window.ZeroGrokCanFx) {
          const panelReset = panelEl && panelEl.querySelector('#zg-reset');
          if (data.remainingPercent != null && data.remainingPercent <= 2) {
            window.ZeroGrokCanFx.startLimitCountdown({
              provider: 'grok',
              data,
              canEl,
              panelResetEl: panelReset,
              onRefilled: () => { try { scrapeAndUpdate(); } catch (_) { try { scrape(); } catch(_){} } }
            });
          } else {
            window.ZeroGrokCanFx.stopLimitCountdown('grok');
            canEl && canEl.classList.remove('zg-at-limit');
          }
        }
      } catch (_) {}

      try { chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: data }); } catch (_) {}
    } else {
      console.warn('[Zero Grok] no data yet – send a message to trigger rate-limits');
    }
  }

  // ---------- Init ----------
  installNetworkHook();
  loadSettings();
  createCan();

  const observer = new MutationObserver(() => {
    clearTimeout(window.__zgDebounce);
    window.__zgDebounce = setTimeout(scrapeAndUpdate, 1500);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('submit', () => setTimeout(scrapeAndUpdate, 2000), true);

  try {
    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
      if (msg.type === 'SCRAPE_USAGE') {
        scrapeAndUpdate().then(() => sendResponse({ ok: true }));
        return true;
      }
    });
  } catch (_) {}

  setTimeout(scrapeAndUpdate, 2000);
  setInterval(scrapeAndUpdate, 45_000);

  console.log('[Zero Grok] ready – Diet Coke can + pop sound on first use');
})();

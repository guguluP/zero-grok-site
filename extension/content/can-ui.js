/**
 * Shared Zero Grok can markup + drag/position + keyboard toggle.
 * Depends on can-fx.js (loaded first).
 */
(function (global) {
  'use strict';

  const BRANDS = {
    grok: { band: ['#e31837', '#c41e3a', '#9b1020'], liquid: ['#e63950', '#8b0a1a'], label: 'GROK', subSize: 9 },
    claude: { band: ['#e8a87c', '#d97757', '#b85c38'], liquid: ['#d97757', '#8b4513'], label: 'CLAUDE', subSize: 7 },
    chatgpt: { band: ['#1a7f64', '#10a37f', '#0d8c6d'], liquid: ['#10a37f', '#0a5c48'], label: 'GPT', subSize: 9 },
    gemini: { band: ['#5b9df9', '#4285f4', '#1a73e8'], liquid: ['#4285f4', '#174ea6'], label: 'GEMINI', subSize: 6.5 }
  };

  function canHTML(provider) {
    const b = BRANDS[provider] || BRANDS.grok;
    const uid = 'zg' + provider;
    return `
      <div class="zg-can-body">
        <svg class="zg-can-svg" viewBox="0 0 64 128" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="${uid}-metal" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#2c2c2c"/>
              <stop offset="12%" stop-color="#7a7a7a"/>
              <stop offset="28%" stop-color="#c8c8c8"/>
              <stop offset="42%" stop-color="#efefef"/>
              <stop offset="55%" stop-color="#d0d0d0"/>
              <stop offset="72%" stop-color="#9a9a9a"/>
              <stop offset="88%" stop-color="#5a5a5a"/>
              <stop offset="100%" stop-color="#1e1e1e"/>
            </linearGradient>
            <linearGradient id="${uid}-band" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="${b.band[0]}"/>
              <stop offset="50%" stop-color="${b.band[1]}"/>
              <stop offset="100%" stop-color="${b.band[2]}"/>
            </linearGradient>
            <linearGradient id="${uid}-liquid" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="${b.liquid[0]}"/>
              <stop offset="100%" stop-color="${b.liquid[1]}"/>
            </linearGradient>
            <clipPath id="${uid}-liquid-clip">
              <rect id="zg-liquid-rect" x="12" y="108" width="40" height="0" rx="4"/>
            </clipPath>
          </defs>

          <ellipse cx="32" cy="114" rx="20" ry="4.5" fill="#3a3a3a" opacity="0.9"/>
          <ellipse cx="32" cy="112.5" rx="18.5" ry="3.2" fill="#555"/>
          <rect x="10" y="16" width="44" height="96" rx="6" ry="6" fill="url(#${uid}-metal)" stroke="#1a1a1a" stroke-width="0.8"/>

          <g clip-path="url(#${uid}-liquid-clip)">
            <rect x="12" y="20" width="40" height="88" class="zg-liquid" fill="url(#${uid}-liquid)"/>
            <g class="zg-bubbles">
              <circle class="zg-bubble" cx="22" cy="95" r="2.0" style="animation-duration:2.5s;animation-delay:0s"/>
              <circle class="zg-bubble" cx="34" cy="98" r="1.5" style="animation-duration:3.2s;animation-delay:0.3s"/>
              <circle class="zg-bubble" cx="28" cy="90" r="1.8" style="animation-duration:2.8s;animation-delay:0.8s"/>
              <circle class="zg-bubble" cx="40" cy="96" r="1.3" style="animation-duration:3.5s;animation-delay:1.1s"/>
              <circle class="zg-bubble" cx="19" cy="100" r="1.6" style="animation-duration:2.9s;animation-delay:0.5s"/>
              <circle class="zg-bubble" cx="36" cy="85" r="1.2" style="animation-duration:3.8s;animation-delay:1.5s"/>
              <circle class="zg-bubble" cx="25" cy="88" r="1.4" style="animation-duration:3.1s;animation-delay:1.9s"/>
              <circle class="zg-bubble" cx="31" cy="92" r="1.1" style="animation-duration:2.6s;animation-delay:0.6s"/>
            </g>
          </g>

          <rect x="10" y="48" width="44" height="28" fill="url(#${uid}-band)"/>
          <ellipse cx="32" cy="16" rx="20" ry="5" fill="#c0c0c0"/>
          <ellipse cx="32" cy="15" rx="14" ry="3.2" fill="#e8e8e8"/>
          <ellipse cx="32" cy="14.2" rx="9" ry="1.6" fill="none" stroke="#999" stroke-width="0.7"/>
          <rect x="30.5" y="11.5" width="3" height="3.5" rx="0.8" fill="#aaa" stroke="#777" stroke-width="0.4"/>

          <text x="32" y="60" text-anchor="middle" fill="#fff" font-size="9" font-weight="900"
                font-family="Arial Black, Helvetica, sans-serif" letter-spacing="1">ZERO</text>
          <text x="32" y="71" text-anchor="middle" fill="#fff" font-size="${b.subSize}" font-weight="700"
                font-family="Arial Black, Helvetica, sans-serif" letter-spacing="1">${b.label}</text>

          <g class="zg-condensation">
            <circle cx="14" cy="30" r="1.2"/>
            <circle cx="48" cy="38" r="1.0"/>
            <circle cx="15" cy="70" r="0.9"/>
            <circle cx="49" cy="80" r="1.1"/>
          </g>
        </svg>
        <div class="zg-percent" id="zg-percent">--%</div>
        <div class="zg-secondary" id="zg-secondary" style="display:none"></div>
      </div>`;
  }

  function setLiquidLevel(canEl, remainingPercent) {
    if (!canEl) return;
    const liquidRect = canEl.querySelector('#zg-liquid-rect');
    const percentEl = canEl.querySelector('#zg-percent');
    const liquid = canEl.querySelector('.zg-liquid');
    const fullH = 88;
    const rem = remainingPercent;
    const h = (rem == null || !Number.isFinite(rem)) ? 0 : Math.max(0, Math.min(fullH, (rem / 100) * fullH));
    if (liquidRect) {
      liquidRect.setAttribute('y', String(20 + (fullH - h)));
      liquidRect.setAttribute('height', String(h));
    }
    if (percentEl && !canEl.classList.contains('zg-at-limit')) {
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
    if (liquid) {
      liquid.classList.remove('zg-ok', 'zg-warn', 'zg-critical');
      if (rem == null || !Number.isFinite(rem)) liquid.style.fill = '';
      else if (rem <= 10) liquid.classList.add('zg-critical');
      else if (rem <= 30) liquid.classList.add('zg-warn');
      else liquid.classList.add('zg-ok');
    }
  }

  function setSecondary(canEl, text) {
    const el = canEl?.querySelector('#zg-secondary');
    if (!el) return;
    if (!text) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = text;
  }

  function positionKey(provider) {
    return 'zeroGrokCanPos_' + (provider || 'default');
  }

  function loadSavedPosition(provider) {
    try {
      const raw = localStorage.getItem(positionKey(provider));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function savePosition(provider, left, top) {
    try {
      localStorage.setItem(positionKey(provider), JSON.stringify({ left, top }));
    } catch (_) {}
  }

  function applyPosition(canEl, settings, provider) {
    if (!canEl) return;
    const saved = loadSavedPosition(provider);
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      canEl.style.left = saved.left + 'px';
      canEl.style.top = saved.top + 'px';
      canEl.style.right = 'auto';
      canEl.style.bottom = 'auto';
      canEl.className = canEl.className.replace(/zg-pos-\S+/g, '').trim() + ' zg-can zg-pos-custom';
      return;
    }
    const pos = (settings && settings.canPosition) || 'bottom-right';
    canEl.style.left = '';
    canEl.style.top = '';
    canEl.style.right = '';
    canEl.style.bottom = '';
    canEl.className = `zg-can zg-pos-${pos}`;
  }

  function makeDraggable(canEl, provider) {
    if (!canEl || canEl.__zgDragBound) return;
    canEl.__zgDragBound = true;
    let ox = 0, oy = 0, dragging = false;

    canEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      const rect = canEl.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      canEl.setPointerCapture(e.pointerId);
      canEl.style.transition = 'none';
      canEl.classList.add('zg-dragging');
    });

    canEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - 72, e.clientX - ox));
      const top = Math.max(0, Math.min(window.innerHeight - 150, e.clientY - oy));
      canEl.style.left = left + 'px';
      canEl.style.top = top + 'px';
      canEl.style.right = 'auto';
      canEl.style.bottom = 'auto';
      canEl.className = canEl.className.replace(/zg-pos-\S+/g, '').trim() + ' zg-can zg-pos-custom';
    });

    canEl.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      canEl.classList.remove('zg-dragging');
      canEl.style.transition = '';
      const rect = canEl.getBoundingClientRect();
      savePosition(provider, rect.left, rect.top);
    });
  }

  function bindKeyboardToggle(canEl, settings) {
    if (global.__zgKeyToggleBound) return;
    global.__zgKeyToggleBound = true;
    document.addEventListener('keydown', (e) => {
      if (!(e.altKey && (e.key === 'u' || e.key === 'U'))) return;
      e.preventDefault();
      if (!canEl) return;
      const hidden = canEl.style.display === 'none' || canEl.classList.contains('zg-user-hidden');
      if (hidden) {
        canEl.style.display = 'flex';
        canEl.classList.remove('zg-user-hidden');
      } else {
        canEl.classList.add('zg-user-hidden');
        canEl.style.display = 'none';
      }
    });
  }

  function canId(provider) {
    return 'zero-grok-can-' + (provider || 'grok');
  }

  function mountCan(opts) {
    const { provider, settings = {}, onClick, colors } = opts;
    const id = canId(provider);

    let canEl = document.getElementById(id);
    if (!canEl) {
      canEl = document.createElement('div');
      canEl.id = id;
      canEl.classList.add('zg-can-root');
      canEl.dataset.provider = provider || 'grok';
      canEl.setAttribute('aria-label', 'Zero Grok usage meter');
      canEl.innerHTML = canHTML(provider);
      document.body.appendChild(canEl);
      if (onClick) canEl.addEventListener('click', (e) => {
        if (canEl.classList.contains('zg-dragging')) return;
        onClick(e);
      });
    }

    applyPosition(canEl, settings, provider);
    makeDraggable(canEl, provider);
    bindKeyboardToggle(canEl, settings);

    if (settings.hideCan) {
      canEl.style.display = 'none';
    } else {
      canEl.style.display = 'flex';
    }

    if (global.ZeroGrokCanFx) {
      global.ZeroGrokCanFx.playFirstUse(canEl, provider, settings.soundEnabled !== false, colors);
    }

    return canEl;
  }

  global.ZeroGrokCanUI = {
    canHTML,
    canId,
    setLiquidLevel,
    setSecondary,
    applyPosition,
    makeDraggable,
    mountCan,
    loadSavedPosition,
    savePosition,
    BRANDS
  };
})(typeof window !== 'undefined' ? window : self);

/**
 * Shared Zero Grok can: markup (built with DOM APIs, no innerHTML – safe under
 * Trusted Types on sites like Gemini), smoothly animated liquid level, drag with
 * corner snap, composer avoidance (the can never sits on the site's message box /
 * Send button), minimize-to-ring morph and per-provider unique ids.
 */
(function (global) {
  'use strict';
  if (global.ZeroGrokCanUI) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LIQUID_TOP = 20;
  const LIQUID_H = 88;
  const LIQUID_EMPTY_Y = LIQUID_TOP + LIQUID_H;
  const CAN_W = 72, CAN_H = 150;
  /** Default distance of the bottom corners from the viewport bottom (clears typical composers). */
  const BOTTOM_INSET = 96;
  const SIDE_INSET = 20;
  const COMPOSER_GAP = 12;
  const BRANDS = {
    grok: { band: ['#e31837', '#c41e3a', '#9b1020'], liquid: ['#e63950', '#8b0a1a'], label: 'GROK', subSize: 9 },
    claude: { band: ['#e8a87c', '#d97757', '#b85c38'], liquid: ['#d97757', '#8b4513'], label: 'CLAUDE', subSize: 7 },
    chatgpt: { band: ['#1a7f64', '#10a37f', '#0d8c6d'], liquid: ['#10a37f', '#0a5c48'], label: 'GPT', subSize: 9 },
    gemini: { band: ['#5b9df9', '#4285f4', '#1a73e8'], liquid: ['#4285f4', '#174ea6'], label: 'GEMINI', subSize: 6.5 },
    perplexity: { band: ['#2ea3b0', '#20808d', '#146570'], liquid: ['#20808d', '#0e4b53'], label: 'PPLX', subSize: 8.5 },
    deepseek: { band: ['#7189ff', '#4d6bfe', '#2f4fe0'], liquid: ['#4d6bfe', '#22359c'], label: 'DEEPSEEK', subSize: 5.2 },
    mistral: { band: ['#ffaf00', '#fa520f', '#e10500'], liquid: ['#fa520f', '#9b2c00'], label: 'MISTRAL', subSize: 5.8 },
    copilot: { band: ['#3aa0f3', '#0078d4', '#005a9e'], liquid: ['#0078d4', '#003e6b'], label: 'COPILOT', subSize: 5.8 },
    metaai: { band: ['#4b8dff', '#0866ff', '#0549c4'], liquid: ['#0866ff', '#03307f'], label: 'META', subSize: 8 }
  };

  /** Tiny element builder: h('div', {class:'x'}, [child, 'text']) */
  function h(tag, attrs, children, ns) {
    const el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, String(v));
    }
    for (const c of children || []) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function s(tag, attrs, children) { return h(tag, attrs, children, SVG_NS); }

  function gradient(id, vertical, stops) {
    return s('linearGradient', { id, x1: '0%', y1: '0%', x2: vertical ? '0%' : '100%', y2: vertical ? '100%' : '0%' },
      stops.map(([o, c]) => s('stop', { offset: o, 'stop-color': c })));
  }

  function buildCanSvg(provider) {
    const b = BRANDS[provider] || BRANDS.grok;
    const uid = 'zg-' + provider;
    const bubbles = [[22, 95, 2.0, 2.5, 0], [34, 98, 1.5, 3.2, 0.3], [28, 90, 1.8, 2.8, 0.8], [40, 96, 1.3, 3.5, 1.1],
      [19, 100, 1.6, 2.9, 0.5], [36, 85, 1.2, 3.8, 1.5], [25, 88, 1.4, 3.1, 1.9], [31, 92, 1.1, 2.6, 0.6]];
    return s('svg', { class: 'zg-can-svg', viewBox: '0 0 64 128', 'aria-hidden': 'true', focusable: 'false' }, [
      s('defs', {}, [
        gradient(uid + '-metal', false, [['0%', '#2c2c2c'], ['12%', '#7a7a7a'], ['28%', '#c8c8c8'], ['42%', '#efefef'],
          ['55%', '#d0d0d0'], ['72%', '#9a9a9a'], ['88%', '#5a5a5a'], ['100%', '#1e1e1e']]),
        gradient(uid + '-band', true, [['0%', b.band[0]], ['50%', b.band[1]], ['100%', b.band[2]]]),
        gradient(uid + '-liquid', true, [['0%', b.liquid[0]], ['100%', b.liquid[1]]]),
        // Fixed-height clip; only `y` moves (108 = empty, 20 = full), animated in setLiquidLevel.
        s('clipPath', { id: uid + '-liquid-clip' }, [
          s('rect', { class: 'zg-liquid-rect', x: 12, y: LIQUID_EMPTY_Y, width: 40, height: LIQUID_H, rx: 4 })
        ])
      ]),
      s('ellipse', { cx: 32, cy: 114, rx: 20, ry: 4.5, fill: '#3a3a3a', opacity: 0.9 }),
      s('ellipse', { cx: 32, cy: 112.5, rx: 18.5, ry: 3.2, fill: '#555' }),
      s('rect', { x: 10, y: 16, width: 44, height: 96, rx: 6, ry: 6, fill: `url(#${uid}-metal)`, stroke: '#1a1a1a', 'stroke-width': 0.8 }),
      s('g', { 'clip-path': `url(#${uid}-liquid-clip)` }, [
        s('rect', { x: 12, y: 20, width: 40, height: 88, class: 'zg-liquid', fill: `url(#${uid}-liquid)` }),
        s('g', { class: 'zg-bubbles' }, bubbles.map(([cx, cy, r, dur, delay]) =>
          s('circle', { class: 'zg-bubble', cx, cy, r, style: { animationDuration: dur + 's', animationDelay: delay + 's' } })))
      ]),
      s('rect', { x: 10, y: 48, width: 44, height: 28, fill: `url(#${uid}-band)` }),
      s('ellipse', { cx: 32, cy: 16, rx: 20, ry: 5, fill: '#c0c0c0' }),
      s('ellipse', { cx: 32, cy: 15, rx: 14, ry: 3.2, fill: '#e8e8e8' }),
      s('ellipse', { cx: 32, cy: 14.2, rx: 9, ry: 1.6, fill: 'none', stroke: '#999', 'stroke-width': 0.7 }),
      s('rect', { x: 30.5, y: 11.5, width: 3, height: 3.5, rx: 0.8, fill: '#aaa', stroke: '#777', 'stroke-width': 0.4 }),
      s('text', { x: 32, y: 60, 'text-anchor': 'middle', fill: '#fff', 'font-size': 9, 'font-weight': 900,
        'font-family': 'Arial Black, Helvetica, sans-serif', 'letter-spacing': 1, text: 'ZERO' }),
      s('text', { x: 32, y: 71, 'text-anchor': 'middle', fill: '#fff', 'font-size': b.subSize, 'font-weight': 700,
        'font-family': 'Arial Black, Helvetica, sans-serif', 'letter-spacing': 1, text: b.label }),
      s('g', { class: 'zg-condensation' }, [[14, 30, 1.2], [48, 38, 1.0], [15, 70, 0.9], [49, 80, 1.1]]
        .map(([cx, cy, r]) => s('circle', { cx, cy, r })))
    ]);
  }

  function canId(provider) {
    return 'zero-grok-can-' + (provider || 'grok');
  }

  function levelClass(rem) {
    return rem == null || !Number.isFinite(rem) ? '' : rem <= 10 ? 'zg-critical' : rem <= 30 ? 'zg-warn' : 'zg-ok';
  }

  /** Reduce motion = the user's setting (class / flag set by provider-core) or the OS preference. */
  function reduceMotion(el) {
    if (global.__zgReduceMotion) return true;
    if (el && el.classList && el.classList.contains('zg-reduce-motion')) return true;
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  }

  function liquidY(rem) {
    const known = rem != null && Number.isFinite(rem);
    const hgt = known ? Math.max(0, Math.min(LIQUID_H, (rem / 100) * LIQUID_H)) : 0;
    return LIQUID_TOP + (LIQUID_H - hgt);
  }

  /**
   * Slide the liquid to targetY with an ease-out requestAnimationFrame tween of
   * the clip rect's `y` (one attribute write per frame on a 64×128 SVG). Instant
   * with reduced motion, in hidden tabs, or for sub-pixel changes.
   */
  function animateLevel(canEl, rect, targetY) {
    rect.setAttribute('data-zg-target-y', targetY.toFixed(2));
    if (canEl.__zgLevelRaf) { cancelAnimationFrame(canEl.__zgLevelRaf); canEl.__zgLevelRaf = 0; }
    const from = canEl.__zgLevelY != null ? canEl.__zgLevelY : LIQUID_EMPTY_Y;
    const instant = reduceMotion(canEl) || document.hidden || Math.abs(from - targetY) < 0.5 || typeof requestAnimationFrame !== 'function';
    if (instant) {
      rect.setAttribute('y', targetY.toFixed(2));
      canEl.__zgLevelY = targetY;
      return;
    }
    const dur = Math.min(900, 380 + Math.abs(targetY - from) * 6);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - p, 3);
      const y = from + (targetY - from) * e;
      rect.setAttribute('y', y.toFixed(2));
      canEl.__zgLevelY = y;
      canEl.__zgLevelRaf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    canEl.__zgLevelRaf = requestAnimationFrame(step);
  }

  /** text: optional override for the big label (countdown, "?" or a count). */
  function setLiquidLevel(canEl, remainingPercent, text) {
    if (!canEl) return;
    const rect = canEl.querySelector('.zg-liquid-rect');
    const percentEl = canEl.querySelector('.zg-percent');
    const liquid = canEl.querySelector('.zg-liquid');
    const rem = remainingPercent;
    const known = rem != null && Number.isFinite(rem);
    if (rect) animateLevel(canEl, rect, liquidY(rem));
    const cls = levelClass(rem);
    if (percentEl) {
      percentEl.textContent = text != null ? text : known ? `${Math.round(rem)}%` : '--%';
      percentEl.className = 'zg-percent ' + cls;
    }
    if (liquid) {
      liquid.classList.remove('zg-ok', 'zg-warn', 'zg-critical');
      if (cls) liquid.classList.add(cls);
    }
    canEl.classList.remove('zg-lvl-ok', 'zg-lvl-warn', 'zg-lvl-critical');
    if (cls) canEl.classList.add(cls.replace('zg-', 'zg-lvl-'));
  }

  function setSecondary(canEl, text) {
    const el = canEl?.querySelector('.zg-secondary');
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
  }

  // ---- position persistence (localStorage is per site origin) ----
  function lsKey(kind, provider) { return 'zeroGrokCan' + kind + '_' + (provider || 'default'); }
  function loadSavedPosition(provider) {
    try { return JSON.parse(localStorage.getItem(lsKey('Pos', provider)) || 'null'); } catch (_) { return null; }
  }
  function savePosition(provider, pos) {
    try {
      if (!pos) localStorage.removeItem(lsKey('Pos', provider));
      else localStorage.setItem(lsKey('Pos', provider), JSON.stringify(pos));
    } catch (_) {}
  }
  function isMinimized(provider) {
    try { return localStorage.getItem(lsKey('Mini', provider)) === '1'; } catch (_) { return false; }
  }
  /** Where the can is anchored, so the can↔ring morph shrinks into the right corner. */
  function anchorOrigin(canEl) {
    const right = canEl.classList.contains('zg-pos-bottom-right') || canEl.classList.contains('zg-pos-top-right');
    const bottom = canEl.classList.contains('zg-pos-bottom-right') || canEl.classList.contains('zg-pos-bottom-left');
    return (right ? '100%' : '0%') + ' ' + (bottom ? '100%' : '0%');
  }

  function cancelMorph(canEl) {
    for (const a of canEl.__zgMorph || []) { try { a.cancel(); } catch (_) {} }
    canEl.__zgMorph = [];
  }

  /**
   * Can ↔ 28px ring. With motion: the can scales/fades into its anchor corner,
   * then the ring scales in (and the reverse on expand) – transform/opacity only,
   * via the Web Animations API. With reduced motion it simply swaps.
   */
  function setMinimized(canEl, provider, mini, opts) {
    try {
      if (mini) localStorage.setItem(lsKey('Mini', provider), '1');
      else localStorage.removeItem(lsKey('Mini', provider));
    } catch (_) {}
    if (!canEl) return;
    mini = !!mini;
    const was = canEl.classList.contains('zg-mini');
    const notify = () => {
      avoidComposer(canEl);
      try { canEl.dispatchEvent(new CustomEvent('zg-mini-change', { detail: { mini } })); } catch (_) {}
    };
    cancelMorph(canEl);
    const body = canEl.querySelector('.zg-can-body');
    const dot = canEl.querySelector('.zg-dot');
    const animate = !(opts && opts.instant) && was !== mini && body && dot && typeof body.animate === 'function' &&
      !reduceMotion(canEl) && canEl.isConnected && canEl.style.display !== 'none';
    if (!animate) {
      canEl.classList.toggle('zg-mini', mini);
      notify();
      return;
    }
    const origin = anchorOrigin(canEl);
    if (mini) {
      body.style.transformOrigin = origin;
      const a = body.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.3)', opacity: 0 }],
        { duration: 170, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
      canEl.__zgMorph = [a];
      a.onfinish = () => {
        canEl.classList.add('zg-mini');
        const b = dot.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 160, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
        canEl.__zgMorph = [b];
        notify();
      };
    } else {
      canEl.classList.remove('zg-mini');
      body.style.transformOrigin = origin;
      const a = body.animate([{ transform: 'scale(0.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      canEl.__zgMorph = [a];
      notify();
    }
  }

  const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  function clearPosClasses(canEl) {
    for (const c of CORNERS) canEl.classList.remove('zg-pos-' + c);
    canEl.classList.remove('zg-pos-custom');
  }

  // ---- composer avoidance -------------------------------------------------
  // Message boxes and Send buttons on the supported sites (and generic fallbacks).
  const COMPOSER_SEL = [
    'textarea', '[contenteditable="true"]', '[contenteditable=""]', '[contenteditable="plaintext-only"]', '[role="textbox"]',
    'button[type="submit"]', 'button[aria-label*="send" i]', 'button[data-testid*="send" i]', '#send', '#prompt-textarea'
  ].join(',');

  function visibleRect(el) {
    if (!el || el.closest('.zg-can-root, .zg-panel')) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return null;
    return r;
  }

  /**
   * Rects of composer parts in the lower part of the viewport (where a bottom
   * corner can would sit). Includes the enclosing <form>/fieldset so the whole
   * message box is avoided, not just the text area.
   */
  function findComposerRects() {
    const vh = window.innerHeight;
    const out = [];
    let nodes = [];
    try { nodes = document.querySelectorAll(COMPOSER_SEL); } catch (_) { return out; }
    const seen = new Set();
    for (let i = 0; i < nodes.length && i < 60; i++) {
      const el = nodes[i];
      for (const cand of [el, el.closest('form, fieldset')]) {
        if (!cand || seen.has(cand)) continue;
        seen.add(cand);
        const r = visibleRect(cand);
        if (!r || r.top < vh * 0.4 || r.height > vh * 0.6) continue;
        out.push(r);
      }
    }
    return out;
  }

  /** The can's horizontal span for a bottom corner, given the viewport width. */
  function cornerSpan(corner, w) {
    const vw = window.innerWidth;
    return corner === 'bottom-left' ? [SIDE_INSET, SIDE_INSET + w] : [vw - SIDE_INSET - w, vw - SIDE_INSET];
  }

  /**
   * Bottom inset (px from the viewport bottom) that keeps a bottom-corner can
   * clear of the composer: at least BOTTOM_INSET, raised to sit COMPOSER_GAP
   * above any composer part it would overlap, but never pushed off-screen.
   */
  function computeBottomInset(corner, w, h, rects) {
    const vh = window.innerHeight;
    const [x0, x1] = cornerSpan(corner, w);
    let inset = BOTTOM_INSET;
    for (const r of rects) {
      if (r.right < x0 - 8 || r.left > x1 + 8) continue;
      inset = Math.max(inset, Math.ceil(vh - r.top + COMPOSER_GAP));
    }
    return Math.max(8, Math.min(inset, vh - h - 8));
  }

  /** Re-check the composer and move a bottom-corner can above it. Cheap; safe to call often. */
  function avoidComposer(canEl) {
    if (!canEl || !canEl.isConnected) return null;
    const corner = canEl.classList.contains('zg-pos-bottom-right') ? 'bottom-right'
      : canEl.classList.contains('zg-pos-bottom-left') ? 'bottom-left' : null;
    if (!corner) return null;
    const mini = canEl.classList.contains('zg-mini');
    const w = mini ? 28 : CAN_W, h = mini ? 28 : CAN_H;
    const inset = computeBottomInset(corner, w, h, findComposerRects());
    if (canEl.__zgBottomInset == null || Math.abs(canEl.__zgBottomInset - inset) > 1) {
      canEl.__zgBottomInset = inset;
      canEl.style.setProperty('--zg-bottom-inset', inset + 'px');
    }
    return inset;
  }

  /** Apply saved/default position without clobbering other classes (zg-can-root etc). */
  function applyPosition(canEl, settings, provider) {
    if (!canEl) return;
    canEl.classList.add('zg-can-root', 'zg-can');
    clearPosClasses(canEl);
    const saved = loadSavedPosition(provider);
    canEl.style.left = canEl.style.top = canEl.style.right = canEl.style.bottom = '';
    if (saved && CORNERS.includes(saved.corner)) {
      canEl.classList.add('zg-pos-' + saved.corner);
      avoidComposer(canEl);
      return;
    }
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const w = canEl.offsetWidth || 72, hh = canEl.offsetHeight || 150;
      canEl.style.left = Math.max(0, Math.min(window.innerWidth - w, saved.left)) + 'px';
      canEl.style.top = Math.max(0, Math.min(window.innerHeight - hh, saved.top)) + 'px';
      canEl.style.right = 'auto';
      canEl.style.bottom = 'auto';
      canEl.classList.add('zg-pos-custom');
      return;
    }
    const pos = CORNERS.includes(settings && settings.canPosition) ? settings.canPosition : 'bottom-right';
    canEl.classList.add('zg-pos-' + pos);
    avoidComposer(canEl);
  }

  /** Top-left coordinates the can occupies when snapped to `corner`. */
  function cornerAnchor(canEl, corner, w, h) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const bottom = canEl.__zgBottomInset != null ? canEl.__zgBottomInset : BOTTOM_INSET;
    return {
      'top-left': [SIDE_INSET, SIDE_INSET],
      'top-right': [vw - SIDE_INSET - w, SIDE_INSET],
      'bottom-left': [SIDE_INSET, vh - bottom - h],
      'bottom-right': [vw - SIDE_INSET - w, vh - bottom - h]
    }[corner];
  }

  const SNAP_PX = 80;
  function makeDraggable(canEl, provider) {
    if (!canEl || canEl.__zgDragBound) return;
    canEl.__zgDragBound = true;
    let ox = 0, oy = 0, startX = 0, startY = 0, dragging = false, moved = false;

    canEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.zg-mini-btn')) return;
      dragging = true;
      moved = false;
      const rect = canEl.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      startX = e.clientX;
      startY = e.clientY;
      try { canEl.setPointerCapture(e.pointerId); } catch (_) {}
    });

    canEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
      if (!moved) {
        moved = true;
        canEl.classList.add('zg-dragging');
        clearPosClasses(canEl);
        canEl.classList.add('zg-pos-custom');
      }
      const w = canEl.offsetWidth, hh = canEl.offsetHeight;
      canEl.style.left = Math.max(0, Math.min(window.innerWidth - w, e.clientX - ox)) + 'px';
      canEl.style.top = Math.max(0, Math.min(window.innerHeight - hh, e.clientY - oy)) + 'px';
      canEl.style.right = 'auto';
      canEl.style.bottom = 'auto';
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;
      const rect = canEl.getBoundingClientRect();
      // Snap when dropped near a viewport corner OR near the spot the can takes in that corner
      // (bottom corners sit above the composer, so their resting spot is not the viewport corner).
      const toCorner = {
        'top-left': Math.hypot(rect.left, rect.top),
        'top-right': Math.hypot(window.innerWidth - rect.right, rect.top),
        'bottom-left': Math.hypot(rect.left, window.innerHeight - rect.bottom),
        'bottom-right': Math.hypot(window.innerWidth - rect.right, window.innerHeight - rect.bottom)
      };
      const d = {};
      for (const c of CORNERS) {
        const [ax, ay] = cornerAnchor(canEl, c, rect.width, rect.height);
        d[c] = Math.min(toCorner[c], Math.hypot(rect.left - ax, rect.top - ay));
      }
      const corner = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
      if (d[corner] <= SNAP_PX) savePosition(provider, { corner });
      else savePosition(provider, { left: Math.round(rect.left), top: Math.round(rect.top) });
      applyPosition(canEl, null, provider);
      // let the click handler see that this was a drag, then clear the flag
      setTimeout(() => canEl.classList.remove('zg-dragging'), 0);
    };
    canEl.addEventListener('pointerup', end);
    canEl.addEventListener('pointercancel', end);
  }

  /**
   * Create (or reuse) the can for `provider`. Returns the element; caller owns
   * re-attaching it after SPA body swaps (see provider-core.js).
   */
  function mountCan(opts) {
    const { provider, settings = {}, onClick, colors, label } = opts;
    const id = canId(provider);
    let canEl = document.getElementById(id);
    if (!canEl) {
      const miniBtn = h('button', { type: 'button', class: 'zg-mini-btn', title: opts.minimizeLabel || 'Minimize', 'aria-label': opts.minimizeLabel || 'Minimize', text: '–' });
      canEl = h('div', {
        id, class: 'zg-can-root zg-can', 'data-provider': provider || 'grok', role: 'button', tabindex: '0',
        'aria-label': opts.ariaLabel || (label || 'Zero Grok') + ' usage meter'
      }, [
        h('div', { class: 'zg-can-body' }, [
          buildCanSvg(provider),
          h('div', { class: 'zg-percent', text: '--%' }),
          h('div', { class: 'zg-secondary', style: { display: 'none' } })
        ]),
        h('div', { class: 'zg-dot', 'aria-hidden': 'true' }),
        miniBtn
      ]);
      if (colors && colors.a) canEl.style.setProperty('--zg-brand', colors.a);
      miniBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setMinimized(canEl, provider, true);
      });
      canEl.addEventListener('click', (e) => {
        if (canEl.classList.contains('zg-dragging')) return;
        if (canEl.classList.contains('zg-mini')) {
          setMinimized(canEl, provider, false);
          return;
        }
        if (onClick) onClick(e);
      });
      canEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (canEl.classList.contains('zg-mini')) setMinimized(canEl, provider, false);
          else if (onClick) onClick(e);
        }
      });
      (document.body || document.documentElement).appendChild(canEl);
    }
    canEl.classList.toggle('zg-mini', isMinimized(provider));
    applyPosition(canEl, settings, provider);
    makeDraggable(canEl, provider);
    canEl.style.display = settings.hideCan ? 'none' : '';
    if (global.ZeroGrokCanFx && !settings.hideCan) {
      global.ZeroGrokCanFx.playFirstUse(canEl, provider, settings.soundEnabled !== false, colors);
    }
    return canEl;
  }

  global.ZeroGrokCanUI = {
    h, s, BRANDS, buildCanSvg, canId, setLiquidLevel, setSecondary, applyPosition, makeDraggable, mountCan,
    loadSavedPosition, savePosition, isMinimized, setMinimized, levelClass, avoidComposer, computeBottomInset,
    findComposerRects, liquidY, reduceMotion, BOTTOM_INSET
  };
})(typeof window !== 'undefined' ? window : self);

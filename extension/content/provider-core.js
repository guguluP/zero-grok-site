/**
 * Zero Grok – shared provider runtime for content scripts.
 *
 * Each provider file (content.js for Grok, claude.js, chatgpt.js, gemini.js,
 * perplexity.js, …) only implements `scrape(ctx)`. This core owns the can and
 * panel, SPA remounting, countdowns, confidence labels, health checks, local
 * estimates and messaging with the background worker.
 *
 * scrape(ctx) must resolve to one of:
 *   { data }                         – a reading (see utils/storage.js sanitizeUsage)
 *   { status: 'signed-out' }
 *   { status: 'no-data', failure }   – failure:false means "expected, not broken"
 */
(function (global) {
  'use strict';
  if (global.ZeroGrokProvider) return;

  const S = global.ZeroGrokShared;
  const UI = global.ZeroGrokCanUI;
  const FX = global.ZeroGrokCanFx;
  const t = S.t;
  const FAILS_FOR_HEALTH = 3;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          void chrome.runtime.lastError;
          resolve(r == null ? null : r);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function debounce(fn, ms) {
    let id = null;
    return function () {
      clearTimeout(id);
      id = setTimeout(fn, ms);
    };
  }

  function relTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60000) return t('justNow', null, 'just now');
    return t('agoFmt', [S.formatDuration(diff)], '$1 ago');
  }

  // ---------------------------------------------------------------- page helpers for providers

  function collectTexts(selectors, maxLen) {
    const out = [];
    for (const sel of selectors || []) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const txt = (el.innerText || el.textContent || '').trim();
          if (txt && txt.length <= maxLen) out.push(txt);
        });
      } catch (_) {}
    }
    return out;
  }

  function compile(patterns) {
    const out = [];
    for (const p of patterns || []) {
      try { out.push(new RegExp(p, 'i')); } catch (_) {}
    }
    return out;
  }

  /** Limit banner inside alert/banner surfaces only (never the whole chat transcript). */
  function scanLimitBanner(sel) {
    const res = compile(sel && sel.limitPatterns);
    if (!res.length) return null;
    const texts = collectTexts(sel.limitSurfaces, 600);
    for (const text of texts) {
      if (res.some((r) => r.test(text))) return { limit: true, text: text.slice(0, 160) };
    }
    return null;
  }

  /** "12 Pro searches left" style counters. */
  function scanCount(sel) {
    const res = compile(sel && sel.countPatterns);
    if (!res.length) return null;
    const surfaces = [...((sel && sel.limitSurfaces) || []), ...((sel && sel.percentSurfaces) || []),
      'button', '[class*="usage"]', '[class*="limit"]', '[class*="quota"]', '[class*="remaining"]'];
    for (const text of collectTexts(surfaces, 200)) {
      for (const r of res) {
        const m = text.match(r);
        if (m && m[1] != null) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n) && n >= 0 && n < 100000) return { count: n, text: text.slice(0, 120) };
        }
      }
    }
    return null;
  }

  /** Same-origin JSON endpoints listed in selectors.json → explicit usage fields only. */
  async function fetchEndpoints(sel) {
    for (const path of (sel && sel.endpoints) || []) {
      if (!/^\/(?!\/)/.test(path)) continue;
      try {
        const res = await fetch(location.origin + path, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (res.status === 401 || res.status === 403) return { auth: true };
        if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) continue;
        const json = await res.json();
        const fields = S.pickUsageFields(json);
        if (fields) return { fields, path, json };
      } catch (_) {}
    }
    return null;
  }

  const helpers = { scanLimitBanner, scanCount, fetchEndpoints, collectTexts, send, relTime };

  // ---------------------------------------------------------------- register

  function register(def) {
    const id = def.id;
    const meta = S.PROVIDER_BY_ID[id];
    if (!meta) throw new Error('unknown provider ' + id);
    const flag = '__zeroGrokProvider_' + id;
    if (global[flag]) return global[flag];
    const colors = { a: meta.color, b: '#fff' };

    const state = {
      settings: { ...S.DEFAULT_SETTINGS },
      selectors: {},
      data: null,
      status: 'loading',
      statusDetail: '',
      failures: 0,
      healthSent: null,
      canEl: null,
      panelEl: null,
      open: false,
      userHidden: false,
      forecast: null,
      suggestion: null,
      scraping: false,
      started: false,
      lastNavScrape: 0,
      refillTriggered: false,
      returnFocus: null
    };

    const api = { id, state, scrape: () => doScrape(), render: () => render(), helpers };
    global[flag] = api;

    const enabled = () => state.settings[meta.settingKey] === true || (!meta.optional && state.settings[meta.settingKey] !== false);
    const siteHidden = () => !S.hostAllowed(state.settings, location.hostname);
    const canVisible = () => enabled() && !state.settings.hideCan && !siteHidden() && !state.userHidden;
    const estimateAllowed = () => meta.optional || state.settings.estimateMessagesEnabled === true;

    // ---------- theme / motion
    const darkMq = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;
    const motionMq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function themeClasses(el) {
      if (!el) return;
      const theme = state.settings.theme;
      const dark = theme === 'dark' || (theme !== 'light' && darkMq && darkMq.matches);
      el.classList.toggle('zg-theme-dark', !!dark);
      el.classList.toggle('zg-theme-light', !dark);
      const reduce = state.settings.reduceMotion === true || (motionMq && motionMq.matches);
      global.__zgReduceMotion = !!reduce;
      el.classList.toggle('zg-reduce-motion', !!reduce);
    }
    try { darkMq && darkMq.addEventListener('change', () => { themeClasses(state.canEl); themeClasses(state.panelEl); }); } catch (_) {}
    try { motionMq && motionMq.addEventListener('change', () => { themeClasses(state.canEl); themeClasses(state.panelEl); }); } catch (_) {}

    // ---------- mounting
    function ensureMounted() {
      if (!document.body) return;
      if (!canVisible()) {
        if (state.canEl) state.canEl.style.display = 'none';
      } else {
        if (!state.canEl) {
          // theme / reduce-motion flags first, so the first liquid fill and pop respect them
          global.__zgReduceMotion = state.settings.reduceMotion === true || !!(motionMq && motionMq.matches);
          state.canEl = UI.mountCan({
            provider: id, settings: state.settings, colors, label: meta.label,
            ariaLabel: t('usageMeterLabel', [meta.label], '$1 usage meter'),
            minimizeLabel: t('minimize', null, 'Minimize'),
            onClick: () => togglePanel()
          });
          state.canEl.addEventListener('zg-mini-change', () => render());
          prebuildPanel();
        }
        if (!state.canEl.isConnected) {
          document.body.appendChild(state.canEl);
          UI.applyPosition(state.canEl, state.settings, id);
        }
        state.canEl.style.display = '';
        themeClasses(state.canEl);
      }
      if (state.panelEl && !state.panelEl.isConnected) document.body.appendChild(state.panelEl);
    }

    const remount = debounce(() => {
      ensureMounted();
      render();
    }, 250);

    function observeDom() {
      let bodyObserved = null;
      const mo = new MutationObserver(() => {
        if (document.body && document.body !== bodyObserved) {
          bodyObserved = document.body;
          mo.observe(document.body, { childList: true });
        }
        if ((state.canEl && !state.canEl.isConnected && canVisible()) || (state.panelEl && !state.panelEl.isConnected)) remount();
      });
      mo.observe(document.documentElement, { childList: true });
      if (document.body) {
        bodyObserved = document.body;
        mo.observe(document.body, { childList: true });
      }
    }

    // Keep bottom-corner cans clear of the composer as the page lays out / resizes.
    const recheckComposer = () => { if (state.canEl && state.canEl.isConnected && state.canEl.style.display !== 'none') UI.avoidComposer(state.canEl); };
    const onResize = debounce(() => {
      recheckComposer();
      if (state.open) positionPanel();
    }, 150);

    const onNavigate = debounce(() => {
      remount();
      if (Date.now() - state.lastNavScrape > 5000) {
        state.lastNavScrape = Date.now();
        setTimeout(doScrape, 1200);
      }
    }, 300);

    function watchNavigation() {
      global.addEventListener('zerogrok:navigate', onNavigate);
      global.addEventListener('popstate', onNavigate);
      try { global.navigation && global.navigation.addEventListener('currententrychange', onNavigate); } catch (_) {}
      global.addEventListener('resize', onResize, { passive: true });
      let href = location.href;
      setInterval(() => {
        if (location.href !== href) {
          href = location.href;
          onNavigate();
        }
        recheckComposer();
      }, 2000);
    }

    // ---------- panel
    const h = UI.h;
    let els = null;
    function buildPanel() {
      if (state.panelEl) return state.panelEl;
      els = {};
      const btn = (key, fb, fn, cls) => {
        const b = h('button', { type: 'button', class: cls || 'zg-btn', text: t(key, null, fb) });
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        return b;
      };
      els.big = h('div', { class: 'zg-big-percent', text: '--%' });
      els.label = h('div', { class: 'zg-label', text: t('remaining', null, 'remaining') });
      els.bar = h('div', { class: 'zg-bar' });
      els.conf = h('span', { class: 'zg-conf' });
      els.updated = h('span', { class: 'zg-updated' });
      els.reset = h('div', { class: 'zg-reset' });
      els.forecast = h('div', { class: 'zg-forecast' });
      els.breakdown = h('div', { class: 'zg-breakdown' });
      els.status = h('div', { class: 'zg-status', role: 'status' });
      els.suggest = h('div', { class: 'zg-suggest' });
      const close = h('button', { type: 'button', class: 'zg-close', 'aria-label': t('close', null, 'Close'), text: '×' });
      close.addEventListener('click', () => togglePanel(false));
      const extra = (def.panelActions || []).map((a) => btn(a.key, a.fallback, a.onClick));
      const titleId = 'zg-panel-title-' + id;
      const panel = h('div', {
        id: 'zero-grok-panel-' + id, class: 'zg-panel', role: 'dialog', 'aria-modal': 'false',
        'aria-labelledby': titleId, 'data-provider': id, 'aria-hidden': 'true', inert: ''
      }, [
        h('div', { class: 'zg-panel-header' }, [h('span', { id: titleId, text: t('panelTitle', [meta.label], 'Zero · $1') }), close]),
        h('div', { class: 'zg-panel-body' }, [
          els.big, els.label,
          h('div', { class: 'zg-bar-wrap' }, [els.bar]),
          h('div', { class: 'zg-meta-row' }, [els.conf, els.updated]),
          els.reset, els.forecast, els.breakdown, els.status, els.suggest,
          h('div', { class: 'zg-footer' }, [
            btn('refresh', 'Refresh', () => doScrape()),
            btn('minimize', 'Minimize', () => { UI.setMinimized(state.canEl, id, true); togglePanel(false); }),
            btn('hideOnSite', 'Hide on this site', () => hideOnSite())
          ]),
          extra.length ? h('div', { class: 'zg-footer' }, extra) : null
        ])
      ]);
      panel.addEventListener('keydown', onPanelKeydown);
      document.body.appendChild(panel);
      state.panelEl = panel;
      themeClasses(panel);
      return panel;
    }

    /** Pre-build the (hidden) panel when the browser is idle so the first open has no build cost. */
    function prebuildPanel() {
      const run = () => { if (!state.panelEl && document.body && canVisible()) buildPanel(); };
      try {
        if (global.requestIdleCallback) global.requestIdleCallback(run, { timeout: 4000 });
        else setTimeout(run, 1500);
      } catch (_) { setTimeout(run, 1500); }
    }

    function focusables() {
      const p = state.panelEl;
      if (!p) return [];
      return Array.from(p.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    }

    /** Escape closes; Tab / Shift+Tab stay inside the open panel. */
    function onPanelKeydown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        togglePanel(false);
        return;
      }
      if (e.key !== 'Tab' || !state.open) return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !state.panelEl.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !state.panelEl.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    function positionPanel() {
      const p = state.panelEl;
      if (!p) return;
      const W = 272, H = p.offsetHeight || 300, gap = 10;
      let left, top;
      const c = state.canEl && state.canEl.isConnected && state.canEl.style.display !== 'none' ? state.canEl.getBoundingClientRect() : null;
      if (c && c.width) {
        left = c.left + c.width / 2 > window.innerWidth / 2 ? c.left - W - gap : c.right + gap;
        top = c.top + c.height / 2 > window.innerHeight / 2 ? c.bottom - H : c.top;
      } else {
        left = window.innerWidth - W - 20;
        top = window.innerHeight - H - 20;
      }
      p.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, left)) + 'px';
      p.style.top = Math.max(8, Math.min(window.innerHeight - H - 8, top)) + 'px';
      // grow out of (and shrink back into) the can's side
      const fromRight = c && c.width ? c.left + c.width / 2 > window.innerWidth / 2 : true;
      const fromBottom = c && c.width ? c.top + c.height / 2 > window.innerHeight / 2 : true;
      p.style.transformOrigin = (fromBottom ? 'bottom ' : 'top ') + (fromRight ? 'right' : 'left');
    }

    /**
     * Open/close with an opacity + transform transition (content.css). The panel
     * stays in the DOM; closed = visibility:hidden + inert + aria-hidden. Focus
     * moves to the close button on open and back to where it was (or the can)
     * on close.
     */
    function togglePanel(force) {
      buildPanel();
      const p = state.panelEl;
      const was = state.open;
      state.open = force == null ? !state.open : !!force;
      if (state.open) {
        if (!was) {
          const a = document.activeElement;
          state.returnFocus = a && a !== document.body && !p.contains(a) ? a : null;
        }
        render();
        positionPanel();
        p.removeAttribute('inert');
        p.removeAttribute('aria-hidden');
        p.classList.add('zg-open');
        refreshExtras();
        const first = p.querySelector('.zg-close');
        try { first && first.focus({ preventScroll: true }); } catch (_) {}
      } else {
        if (p.contains(document.activeElement)) {
          const back = state.returnFocus && state.returnFocus.isConnected ? state.returnFocus
            : state.canEl && state.canEl.isConnected && state.canEl.style.display !== 'none' ? state.canEl : null;
          try { back ? back.focus({ preventScroll: true }) : document.activeElement.blur(); } catch (_) {}
        }
        state.returnFocus = null;
        p.classList.remove('zg-open');
        p.setAttribute('aria-hidden', 'true');
        p.setAttribute('inert', '');
      }
      if (state.canEl) state.canEl.setAttribute('aria-expanded', String(state.open));
    }

    async function hideOnSite() {
      togglePanel(false);
      await send({ type: 'HIDE_SITE', host: location.hostname, hidden: true });
      state.settings.hiddenSites = [...(state.settings.hiddenSites || []), location.hostname.toLowerCase()];
      ensureMounted();
    }

    // ---------- rendering
    function render() {
      const d = state.data;
      const rem = S.remainingOf(d);
      const now = Date.now();
      const resetAt = d && S.toResetMs(d.resetAt);
      const atLimit = rem != null && rem <= 2;
      const conf = d ? S.confidenceOf(d.source) : null;
      const needsUpdate = state.status === 'needs-update';
      let big = null;
      if (needsUpdate) big = '?';
      else if (atLimit && resetAt && resetAt > now) big = S.formatDuration(resetAt - now);
      else if (rem == null && d && S.isNum(d.remaining)) big = String(d.remaining);
      else if (rem == null && d && S.isNum(d.count)) big = String(d.count);
      let secondary = '';
      if (!needsUpdate && d) {
        if (!atLimit && resetAt && resetAt > now) secondary = '↻ ' + S.formatDuration(resetAt - now);
        else if (S.isNum(d.weeklyRemaining)) secondary = t('weeklyShort', [String(Math.round(d.weeklyRemaining))], 'W $1%');
        else if (conf === 'estimate') secondary = t('estShort', null, 'est.');
      }
      const canEl = state.canEl;
      if (canEl) {
        UI.setLiquidLevel(canEl, needsUpdate ? null : rem, big);
        UI.setSecondary(canEl, secondary);
        canEl.classList.toggle('zg-at-limit', !!atLimit && !needsUpdate);
        canEl.classList.toggle('zg-estimate', conf === 'estimate');
        canEl.classList.toggle('zg-needs-update', needsUpdate);
        const summary = needsUpdate
          ? t('needsUpdateShort', [meta.label], '$1 tracking needs an update')
          : rem != null
            ? t('canSummary', [meta.label, String(Math.round(rem)), S.confidenceLabel(conf)], '$1: $2% left · $3')
            : t('canSummaryNoData', [meta.label], '$1: no reading yet');
        const mini = canEl.classList.contains('zg-mini');
        const expand = mini ? ' — ' + t('expandHint', null, 'click to expand') : '';
        canEl.setAttribute('aria-label', summary + expand);
        canEl.setAttribute('aria-expanded', String(!!state.open));
        canEl.title = summary + (resetAt && resetAt > now ? ' · ' + t('resetsIn', [S.formatDuration(resetAt - now)], 'Resets in $1') : '') + expand;
      }
      if (!state.panelEl || !els) return;
      els.big.textContent = needsUpdate ? '?' : rem != null ? ((conf === 'estimate' ? '~' : '') + Math.round(rem) + '%') : (d && S.isNum(d.remaining) ? t('nLeft', [String(d.remaining)], '$1 left') : d && S.isNum(d.count) ? t('nSent', [String(d.count)], '$1 sent') : '--%');
      els.label.textContent = d ? (d.windowHint || t('remaining', null, 'remaining')) : t('remaining', null, 'remaining');
      const frac = needsUpdate || rem == null ? 0 : Math.max(0, Math.min(1, rem / 100));
      els.bar.style.transform = 'scaleX(' + frac.toFixed(4) + ')';
      els.bar.className = 'zg-bar ' + (needsUpdate ? '' : UI.levelClass(rem));
      els.conf.textContent = d ? S.confidenceLabel(conf) : '';
      els.conf.className = 'zg-conf' + (conf ? ' zg-conf-' + conf : '');
      els.conf.style.display = d ? '' : 'none';
      els.updated.textContent = d && d.updatedAt ? t('updatedAgo', [relTime(d.updatedAt)], 'Updated $1') : '';
      if (resetAt && resetAt > now) {
        els.reset.textContent = t('resetsInAt', [S.formatDuration(resetAt - now), S.formatClock(resetAt)], 'Resets in $1 (at $2)');
      } else {
        els.reset.textContent = d && d.resetHint ? d.resetHint : '';
      }
      const f = state.forecast;
      els.forecast.textContent = !f || needsUpdate ? '' : f.status === 'eta'
        ? t('forecastEta', [S.formatClock(f.etaMs)], "At this pace you'll hit zero ~$1")
        : f.status === 'lasts' ? t('forecastLasts', null, 'At this pace it lasts until the reset') : '';
      while (els.breakdown.firstChild) els.breakdown.removeChild(els.breakdown.firstChild);
      const rows = (d && Array.isArray(d.breakdown) ? d.breakdown : []).slice(0, 8);
      for (const b of rows) {
        const val = S.isNum(b.remainingPercent) ? Math.round(b.remainingPercent) + '%' : S.isNum(b.remaining) ? t('nLeft', [String(b.remaining)], '$1 left') : '';
        const r = S.toResetMs(b.resetAt);
        els.breakdown.appendChild(h('div', { class: 'zg-bd-row' }, [
          h('span', { class: 'zg-bd-label', text: b.label }),
          h('span', { class: 'zg-bd-val', text: val + (r && r > now ? ' · ↻ ' + S.formatDuration(r - now) : '') })
        ]));
      }
      if (S.isNum(d && d.weeklyRemaining) && !rows.some((b) => /week/i.test(b.label))) {
        els.breakdown.appendChild(h('div', { class: 'zg-bd-row' }, [
          h('span', { class: 'zg-bd-label', text: t('weekly', null, 'Weekly') }),
          h('span', { class: 'zg-bd-val', text: Math.round(d.weeklyRemaining) + '%' })
        ]));
      }
      els.status.textContent = statusText();
      els.status.className = 'zg-status' + (needsUpdate ? ' zg-status-warn' : '');
      const sg = state.suggestion;
      els.suggest.textContent = sg ? t('suggestLong', [sg.fromLabel, String(Math.round(sg.fromRemaining)), sg.label, String(Math.round(sg.remaining))], '$1 is at $2% — $3 has $4% left.') : '';
      els.suggest.style.display = sg ? '' : 'none';
    }

    function statusText() {
      const d = state.data;
      if (state.status === 'needs-update') return t('needsUpdateLong', [meta.label], "$1 tracking needs an update — the site changed and Zero Grok can't read usage right now. Numbers are hidden instead of guessing.");
      if (state.status === 'signed-out') return t('statusSignedOut', [meta.label], 'Sign in to $1, then Refresh.');
      if (d && d.note) return d.note;
      if (d && S.confidenceOf(d.source) === 'estimate') return t('estimateNote', null, 'Local estimate from messages you sent in this browser — not official.');
      if (!d) return (def.messages && def.messages[state.statusDetail]) || def.noDataMessage || t('statusNoData', null, 'No reading yet — use the site normally, then Refresh.');
      return '';
    }

    async function refreshExtras() {
      if (!state.data || S.confidenceOf(state.data.source) === 'estimate') {
        state.forecast = null;
      } else {
        state.forecast = await send({ type: 'GET_FORECAST', provider: id });
      }
      state.suggestion = state.settings.suggestSwitch !== false ? await send({ type: 'GET_SUGGESTION', provider: id }) : null;
      render();
    }

    // ---------- data flow
    function setHealth(status, detail) {
      if (state.healthSent === status) return;
      state.healthSent = status;
      send({ type: 'PROVIDER_HEALTH', payload: { provider: id, status, detail: detail || '' } });
    }

    function applyData(data, opts) {
      opts = opts || {};
      const d = { ...data, provider: id };
      d.confidence = S.confidenceOf(d.source);
      if (!d.updatedAt) d.updatedAt = Date.now();
      const prevRem = S.remainingOf(state.data);
      state.data = d;
      if (d.confidence !== 'estimate') {
        state.failures = 0;
        state.status = 'ok';
        state.healthSent = 'ok';
      } else if (state.status !== 'needs-update') {
        state.status = 'estimate';
      }
      state.refillTriggered = false;
      render();
      const rem = S.remainingOf(d);
      if (FX && rem != null && d.confidence !== 'estimate') {
        FX.trackRefill(id, rem, state.canEl, state.settings.soundEnabled !== false, colors);
      }
      if (opts.persist !== false) send({ type: 'USAGE_DATA', payload: d });
      if (state.open || prevRem !== rem) refreshExtras();
    }

    async function applyEstimate(bump) {
      if (!estimateAllowed()) return false;
      if (state.data && S.confidenceOf(state.data.source) !== 'estimate' && Date.now() - (state.data.updatedAt || 0) < 30 * 60000) return false;
      const est = await send({ type: bump ? 'ESTIMATE_BUMP' : 'GET_ESTIMATE', provider: id });
      if (!est) return false;
      if (!bump && !est.count && state.data) return false;
      applyData(est, { persist: true });
      return true;
    }

    async function doScrape() {
      if (state.scraping || !enabled()) return;
      state.scraping = true;
      let r = null;
      try {
        r = await def.scrape({ selectors: state.selectors, settings: state.settings, previous: state.data, helpers });
      } catch (e) {
        r = { status: 'no-data', failure: true, detail: String(e && e.message || e) };
      }
      state.scraping = false;
      r = r || { status: 'no-data', failure: true };
      if (r.data && (S.isNum(r.data.remainingPercent) || S.isNum(r.data.usedPercent) || S.isNum(r.data.count) || S.isNum(r.data.remaining))) {
        applyData(r.data);
        return;
      }
      state.statusDetail = r.status === 'no-data' ? (r.detail || 'no-data') : r.status;
      if (r.status === 'signed-out') {
        state.failures = 0;
        if (!state.data || S.confidenceOf(state.data.source) !== 'estimate') state.data = null;
        state.status = 'signed-out';
        setHealth('signed-out');
      } else if (r.failure !== false) {
        state.failures++;
        if (state.failures >= FAILS_FOR_HEALTH) {
          state.status = 'needs-update';
          setHealth('needs-update', r.detail);
        } else if (!state.data) {
          state.status = 'no-data';
        }
      } else if (!state.data) {
        state.status = 'no-data';
      }
      if (state.status !== 'needs-update') await applyEstimate(false);
      render();
    }

    // ---------- estimates: count messages the user sends (local only)
    let lastBump = 0;
    function onSend() {
      if (!estimateAllowed() || !enabled()) return;
      const now = Date.now();
      if (now - lastBump < 1500) return;
      lastBump = now;
      applyEstimate(true);
      setTimeout(doScrape, 2500);
    }
    function bindSendDetection() {
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
        const el = e.target;
        if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable)) {
          const txt = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
          if (txt && txt.trim()) onSend();
        }
      }, true);
      document.addEventListener('click', (e) => {
        const b = e.target && e.target.closest && e.target.closest('button[data-testid*="send" i], button[aria-label*="send" i], button[aria-label*="submit" i], button[type="submit"]');
        if (b && !b.disabled) onSend();
      }, true);
    }

    // ---------- countdown ticker
    setInterval(() => {
      if (!state.data) return;
      const r = S.toResetMs(state.data.resetAt);
      if (r && r <= Date.now() && !state.refillTriggered) {
        state.refillTriggered = true;
        setTimeout(doScrape, 2000);
      }
      render();
    }, 30000);

    // ---------- messages
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return false;
      if (msg.type === 'SCRAPE_USAGE') {
        doScrape().then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg.type === 'USAGE_PUSH' && msg.payload && msg.payload.provider === id) {
        applyData(msg.payload, { persist: false });
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'TOGGLE_CAN') {
        state.userHidden = !state.userHidden && !!state.canEl && state.canEl.style.display !== 'none';
        ensureMounted();
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'TOGGLE_PANEL') {
        if (!enabled()) return false;
        togglePanel();
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'REFILL_POP' && (!msg.provider || msg.provider === id)) {
        if (FX && state.canEl) FX.popAnimation(state.canEl, state.settings.soundEnabled !== false, colors, 0);
        return false;
      }
      return false;
    });

    function applySettings(next) {
      state.settings = { ...S.DEFAULT_SETTINGS, ...(next || {}) };
      if (!enabled()) {
        if (state.canEl) state.canEl.style.display = 'none';
        if (state.open) togglePanel(false);
        return;
      }
      if (state.canEl) UI.applyPosition(state.canEl, state.settings, id);
      themeClasses(state.panelEl);
      start();
      ensureMounted();
      render();
    }

    try {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.zeroGrokSettings && changes.zeroGrokSettings.newValue) applySettings(changes.zeroGrokSettings.newValue);
      });
    } catch (_) {}

    // ---------- start
    function start() {
      if (state.started || !enabled()) return;
      state.started = true;
      ensureMounted();
      observeDom();
      watchNavigation();
      bindSendDetection();
      if (typeof def.init === 'function') {
        try { def.init({ helpers, applyData, state, scrape: doScrape }); } catch (_) {}
      }
      (def.initialDelays || [1500, 5000]).forEach((ms) => setTimeout(doScrape, ms));
      setInterval(doScrape, def.pollMs || 60000);
    }

    (async () => {
      const [settings, selectors, usage] = await Promise.all([
        send({ type: 'GET_SETTINGS' }),
        send({ type: 'GET_SELECTORS' }),
        send({ type: 'GET_USAGE' })
      ]);
      state.selectors = (selectors && selectors.providers && selectors.providers[id]) || {};
      state.settings = { ...S.DEFAULT_SETTINGS, ...(settings || {}) };
      if (!enabled()) return;
      const cached = usage && usage.byProvider && usage.byProvider[id];
      if (cached && cached.updatedAt && Date.now() - cached.updatedAt < (def.cacheMaxAgeMs || 30 * 60000)) {
        state.data = { ...cached };
        state.status = S.confidenceOf(cached.source) === 'estimate' ? 'estimate' : 'ok';
      }
      start();
      render();
    })();

    return api;
  }

  /**
   * Generic provider for sites without a documented usage API (Perplexity,
   * DeepSeek, Le Chat, Copilot, Meta AI). Order: same-origin JSON endpoints from
   * selectors.json (explicit fields only) → on-page counters → limit banners →
   * local estimate (handled by the core, clearly labelled). Never invents a %.
   */
  function registerGeneric(id, opts) {
    opts = opts || {};
    return register({
      id,
      initialDelays: [2000, 6000],
      pollMs: opts.pollMs || 60000,
      noDataMessage: opts.noDataMessage || t('genericNoData', [S.PROVIDER_BY_ID[id].label], "$1 doesn't publish usage limits. Zero Grok counts the messages you send here (local estimate) and flags limit banners."),
      async scrape(ctx) {
        const api = await ctx.helpers.fetchEndpoints(ctx.selectors);
        if (api && api.auth) return { status: 'signed-out' };
        if (api && api.fields) {
          return { data: { provider: id, remainingPercent: api.fields.remainingPercent, usedPercent: api.fields.usedPercent,
            remaining: api.fields.count, total: api.fields.total, resetAt: api.fields.resetAt,
            windowHint: opts.windowHint || t('fromSiteApi', null, 'From site'), source: 'site-api' } };
        }
        const cnt = ctx.helpers.scanCount(ctx.selectors);
        if (cnt) {
          const total = opts.totalFor ? opts.totalFor(ctx.settings.plans && ctx.settings.plans[id]) : null;
          const data = { provider: id, remaining: cnt.count, windowHint: cnt.text, source: 'dom-count' };
          if (total && cnt.count <= total) { data.total = total; data.remainingPercent = S.clampPct((cnt.count / total) * 100); }
          return { data };
        }
        const hit = ctx.helpers.scanLimitBanner(ctx.selectors);
        if (hit) {
          return { data: { provider: id, usedPercent: 100, remainingPercent: 0, windowHint: t('limitReached', null, 'Limit reached'),
            resetHint: hit.text, resetAt: S.parseRelativeReset(hit.text), source: 'dom-limit' } };
        }
        return { status: 'no-data', failure: false, detail: 'no-data' };
      }
    });
  }

  global.ZeroGrokProvider = { register, registerGeneric, helpers };
})(typeof window !== 'undefined' ? window : self);

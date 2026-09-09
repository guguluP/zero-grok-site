/**
 * Zero Grok – Claude.ai
 * Proven path (working extensions):
 *   GET /api/organizations → org uuid
 *   GET /api/organizations/{uuid}/usage → five_hour / seven_day utilization
 */
(async function () {
  'use strict';
  if (window.__ZERO_GROK_CLAUDE__) return;
  window.__ZERO_GROK_CLAUDE__ = true;

  let currentUsage = null;
  let canEl = null;
  let panelEl = null;
  let isExpanded = false;
  let settings = { canPosition: 'bottom-right', theme: 'auto', enableClaude: true, estimateMessagesEnabled: false, soundEnabled: true };
  let orgId = null;
  let claudeEstCount = 0;
  const CLAUDE_EST_CAP = 40;

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
        if (settings.enableClaude === false) return;
        if (settings.hideCan) return;
        showCan();
        updateCanVisual(null);
        scrape();
      });
    } catch (_) {
      showCan();
      updateCanVisual(null);
      scrape();
    }
  }

  function createCan() {
    if (canEl) return canEl;
    if (window.ZeroGrokCanUI) {
      canEl = window.ZeroGrokCanUI.mountCan({
        provider: 'claude',
        settings,
        onClick: togglePanel,
        colors: { a: '#d97757', b: '#fff' }
      });
      return canEl;
    }
    canEl = document.createElement('div');
    canEl.id = 'zero-grok-can-claude';
    canEl.classList.add('zg-can-root');
    canEl.dataset.provider = 'claude';
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
      if (data && Number.isFinite(data.weeklyRemaining)) {
        window.ZeroGrokCanUI.setSecondary(canEl, 'W ' + Math.round(data.weeklyRemaining) + '%');
      } else {
        window.ZeroGrokCanUI.setSecondary(canEl, '');
      }
      return;
    }
    const percentEl = canEl.querySelector('#zg-percent');
    if (percentEl) {
      percentEl.textContent = (rem == null || !Number.isFinite(rem)) ? '--%' : Math.round(rem) + '%';
    }
  }

  function createPanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.id = 'zero-grok-panel';
    panelEl.innerHTML = `
      <div class="zg-panel-header"><span>Zero · Claude</span><button class="zg-close">×</button></div>
      <div class="zg-panel-body">
        <div class="zg-big-percent" id="zg-big-percent">--%</div>
        <div class="zg-label" id="zg-label">remaining</div>
        <div class="zg-bar-wrap"><div class="zg-bar" id="zg-bar"></div></div>
        <div class="zg-reset" id="zg-reset">Waiting…</div>
        <div id="zg-weekly-row" style="margin-top:10px;font-size:12px;opacity:0.85;display:none">
          <div id="zg-weekly-label">Weekly</div>
          <div class="zg-bar-wrap" style="margin-top:4px"><div class="zg-bar" id="zg-weekly-bar" style="background:#d97757"></div></div>
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
    'signed-out': 'Sign in to Claude, then Refresh',
    'no-data': 'Could not read usage — try Refresh after a chat',
    'no-org': 'No organization found — open claude.ai once',
    'unavailable': 'Usage API unavailable for this account'
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
        : [data.windowHint, data.resetHint].filter(Boolean).join(' · ');
    }
    if (weeklyRow && weeklyBar && weeklyLabel) {
      if (data && Number.isFinite(data.weeklyRemaining)) {
        weeklyRow.style.display = 'block';
        weeklyBar.style.width = data.weeklyRemaining + '%';
        weeklyLabel.textContent = 'Weekly ' + Math.round(data.weeklyRemaining) + '% left';
      } else weeklyRow.style.display = 'none';
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
        window.ZeroGrokCanFx.trackRefill('claude', data.remainingPercent, canEl, settings.soundEnabled !== false, { a: '#d97757', b: '#fff' });
      }
    } catch (_) {}
    try {
      if (window.ZeroGrokCanFx) {
        const panelReset = panelEl && panelEl.querySelector('#zg-reset');
        if (data.remainingPercent != null && data.remainingPercent <= 2) {
          window.ZeroGrokCanFx.startLimitCountdown({
            provider: 'claude', data, canEl, panelResetEl: panelReset,
            onRefilled: () => { try { scrape(); } catch (_) {} }
          });
        } else {
          window.ZeroGrokCanFx.stopLimitCountdown('claude');
          canEl && canEl.classList.remove('zg-at-limit');
        }
      }
    } catch (_) {}
    try { chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: data }); } catch (_) {}
    console.log('[Zero Grok] Claude OK', Math.round(data.remainingPercent) + '%', data.windowHint, data.source);
  }

  async function fetchOrgs() {
    try {
      const res = await fetch('https://claude.ai/api/organizations', { credentials: 'include', cache: 'no-store' });
      if (res.status === 401 || res.status === 403) return { auth: true };
      if (!res.ok) return null;
      const json = await res.json();
      const list = Array.isArray(json) ? json : (json.organizations || json.data || []);
      const org = list.find(o => o.uuid || o.id) || list[0];
      if (!org) return null;
      return { id: org.uuid || org.id };
    } catch (e) {
      console.warn('[Zero Grok] Claude orgs error', e.message);
      return null;
    }
  }

  async function fetchUsage(id) {
    try {
      const res = await fetch('https://claude.ai/api/organizations/' + id + '/usage', {
        credentials: 'include', cache: 'no-store'
      });
      if (res.status === 401 || res.status === 403) return { auth: true };
      if (!res.ok) return null;
      const json = await res.json();
      return normalizeUsage(json);
    } catch (e) {
      console.warn('[Zero Grok] Claude usage error', e.message);
      return null;
    }
  }

  function normalizeUsage(json) {
    if (!json || typeof json !== 'object') return null;
    const five = json.five_hour || json.fiveHour || json.session || null;
    const seven = json.seven_day || json.sevenDay || json.weekly || null;

    function fromBucket(b, hint) {
      if (!b) return null;
      let util = b.utilization ?? b.used_percent ?? b.percent ?? b.usage;
      if (util == null && b.used != null && b.limit) util = (b.used / b.limit) * 100;
      if (util == null) return null;
      util = Number(util);
      if (!Number.isFinite(util)) return null;
      if (util >= 0 && util <= 1.5) util = util * 100;
      util = Math.max(0, Math.min(100, util));
      const remaining = Math.max(0, 100 - util);
      let resetHint = b.resets_at || b.reset_at || b.resetsAt || '';
      if (typeof resetHint === 'number') resetHint = new Date(resetHint * (resetHint < 1e12 ? 1000 : 1)).toLocaleString();
      if (resetHint && typeof resetHint === 'string' && /^\d+$/.test(resetHint)) {
        const n = parseInt(resetHint, 10);
        resetHint = new Date(n * (n < 1e12 ? 1000 : 1)).toLocaleString();
      }
      return { used: util, remaining, hint, reset: String(resetHint || '') };
    }

    const buckets = [];
    const f = fromBucket(five, '5-hour');
    const s = fromBucket(seven, 'Weekly');
    if (f) buckets.push(f);
    if (s) buckets.push(s);

    if (!buckets.length) {
      let util = json.utilization ?? json.used_percent ?? json.percent;
      if (util != null) {
        util = Number(util);
        if (util >= 0 && util <= 1.5) util *= 100;
        if (Number.isFinite(util)) buckets.push({ used: util, remaining: Math.max(0, 100 - util), hint: 'Session', reset: '' });
      }
    }
    if (!buckets.length) return null;
    buckets.sort((a, b) => b.used - a.used);
    const top = buckets[0];
    return {
      provider: 'claude',
      usedPercent: top.used,
      remainingPercent: top.remaining,
      windowHint: top.hint,
      resetHint: top.reset,
      weeklyUsed: s ? s.used : null,
      weeklyRemaining: s ? s.remaining : null,
      source: 'org-usage'
    };
  }

  function scrapeDomLimit() {
    const text = document.body?.innerText || '';
    const m = text.match(/you(?:'ve| have)?\s+(?:reached|hit)\s+(?:your\s+)?(?:usage\s+|message\s+)?limit[^.]{0,100}/i) ||
              text.match(/usage\s+limit\s+(?:reached|exceeded)/i);
    if (!m) return null;
    return {
      provider: 'claude', usedPercent: 100, remainingPercent: 0,
      windowHint: 'Limit reached', resetHint: 'Wait for reset', source: 'dom-limit'
    };
  }

  async function scrape() {
    console.log('[Zero Grok] Claude scrape…');
    if (!orgId) {
      const org = await fetchOrgs();
      if (org && org.auth) { applyUsage(null, 'signed-out'); return; }
      if (!org || !org.id) {
        const dom = scrapeDomLimit();
        if (dom) { applyUsage(dom, 'ok'); return; }
        applyUsage(null, 'no-org');
        return;
      }
      orgId = org.id;
    }
    const data = await fetchUsage(orgId);
    if (data && data.auth) { applyUsage(null, 'signed-out'); return; }
    if (data && Number.isFinite(data.remainingPercent)) { applyUsage(data, 'ok'); return; }
    const dom = scrapeDomLimit();
    if (dom) { applyUsage(dom, 'ok'); return; }
    applyUsage(null, currentUsage ? 'unavailable' : 'no-data');
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === 'SCRAPE_USAGE') {
      scrape().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === 'USAGE_PUSH' && msg.payload?.provider === 'claude') {
      applyUsage(msg.payload, 'ok');
      sendResponse({ ok: true });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!settings.estimateMessagesEnabled) return;
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (!t || (t.tagName !== 'TEXTAREA' && t.getAttribute('contenteditable') !== 'true')) return;
    claudeEstCount += 1;
    if (currentUsage && currentUsage.source === 'org-usage') return;
    const used = Math.min(100, (claudeEstCount / CLAUDE_EST_CAP) * 100);
    applyUsage({
      provider: 'claude',
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      windowHint: 'Estimate',
      resetHint: claudeEstCount + ' local msgs (cap ~' + CLAUDE_EST_CAP + ') — not official',
      source: 'estimate'
    }, 'estimate');
  }, true);

  loadSettings();
  setTimeout(scrape, 2000);
  setInterval(scrape, 60_000);
  console.log('[Zero Grok] Claude ready (org/usage)');
})();

/**
 * Zero Grok – ChatGPT
 * Session token from /api/auth/session (same-origin, never stored), then the
 * conversation-limit endpoints listed in selectors.json. Only explicit
 * remaining/limit pairs are accepted (no "any number named limit" guessing).
 * Falls back to on-page usage text / limit banners, then (opt-in) local estimate.
 */
(function () {
  'use strict';
  const S = window.ZeroGrokShared;
  const P = window.ZeroGrokProvider;
  if (!S || !P) return;

  let accessToken = null;

  async function fetchSession() {
    try {
      const res = await fetch(location.origin + '/api/auth/session', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      accessToken = json.accessToken || json.access_token || null;
      return accessToken;
    } catch (_) {
      return null;
    }
  }

  async function fetchWithAuth(path) {
    if (!accessToken) await fetchSession();
    const headers = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    return fetch(location.origin + path, { credentials: 'include', headers, cache: 'no-store' });
  }

  /** limits_progress (per feature) → breakdown rows; explicit pairs → headline. */
  function normalize(json) {
    if (!json || typeof json !== 'object') return null;
    const breakdown = [];
    if (Array.isArray(json.limits_progress)) {
      for (const l of json.limits_progress.slice(0, 10)) {
        if (!l || typeof l !== 'object') continue;
        const label = String(l.feature_name || l.feature || 'limit').replace(/_/g, ' ');
        breakdown.push({ label, remaining: S.isNum(l.remaining) ? l.remaining : null, resetAt: S.toResetMs(l.reset_after || l.resets_at) });
      }
    }
    const fields = S.pickUsageFields(json);
    if (fields) {
      return {
        provider: 'chatgpt',
        remainingPercent: fields.remainingPercent,
        usedPercent: fields.usedPercent,
        windowHint: S.t('chatgptSession', null, 'Message limit'),
        resetAt: fields.resetAt,
        resetHint: fields.count != null && fields.total ? S.t('nOfTotalLeft', [String(fields.count), String(fields.total)], '$1 / $2 left') : '',
        breakdown: breakdown.length ? breakdown : undefined,
        source: 'api-limit'
      };
    }
    return breakdown.length ? { breakdownOnly: breakdown } : null;
  }

  function scrapeDom(sel) {
    const pctRe = /(\d{1,3})\s*%\s*(used|remaining|left)\b/i;
    for (const text of P.helpers.collectTexts(sel.percentSurfaces, 300)) {
      const m = text.match(pctRe);
      if (!m) continue;
      const v = parseInt(m[1], 10);
      if (v < 0 || v > 100) continue;
      const isRem = /remaining|left/i.test(m[2]);
      return { provider: 'chatgpt', remainingPercent: isRem ? v : 100 - v, usedPercent: isRem ? 100 - v : v, windowHint: S.t('fromPage', null, 'From page'), source: 'dom-heuristic' };
    }
    const hit = P.helpers.scanLimitBanner(sel);
    if (hit) return { provider: 'chatgpt', usedPercent: 100, remainingPercent: 0, windowHint: S.t('limitReached', null, 'Limit reached'), resetHint: hit.text, source: 'dom-limit' };
    return null;
  }

  P.register({
    id: 'chatgpt',
    initialDelays: [1500, 5000],
    pollMs: 30000,
    messages: {
      'no-endpoint': S.t('chatgptNoEndpoint', null, 'No live meter for this plan — Zero Grok shows a number once ChatGPT displays a limit. Turn on local estimates in Options if you want a rough count.')
    },
    async scrape(ctx) {
      let breakdown = null;
      let signedOut = false;
      for (const path of ctx.selectors.endpoints || []) {
        try {
          const res = await fetchWithAuth(path);
          if (res.status === 401) { signedOut = true; accessToken = null; break; }
          if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) continue;
          const r = normalize(await res.json());
          if (r && r.breakdownOnly) breakdown = r.breakdownOnly;
          else if (r) return { data: r };
        } catch (_) {}
      }
      const dom = scrapeDom(ctx.selectors);
      if (dom) {
        if (breakdown) dom.breakdown = breakdown;
        return { data: dom };
      }
      if (signedOut || !(accessToken || (await fetchSession()))) return { status: 'signed-out' };
      // Signed in but this plan has no live meter: expected, not a breakage.
      return { status: 'no-data', failure: false, detail: 'no-endpoint' };
    }
  });
})();

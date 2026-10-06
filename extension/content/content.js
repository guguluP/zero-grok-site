/**
 * Zero Grok – Grok (grok.com / grok.x.ai / x.com/i/grok)
 *
 * 1. Free & paid rate limits: POST /rest/rate-limits per model (official numbers,
 *    gives a per-model breakdown).
 * 2. Paid weekly pool: GetGrokCreditsConfig. We first ask for JSON (explicit
 *    fields); only if that fails do we decode the gRPC-web protobuf and pick a
 *    float field – that path is labelled "Estimate" in the UI.
 * 3. Live: the page-world hook forwards the page's own rate-limit responses.
 */
(function () {
  'use strict';
  const S = window.ZeroGrokShared;
  const P = window.ZeroGrokProvider;
  if (!S || !P) return;

  const PROBES = [
    { modelName: 'grok-3', requestKind: 'DEFAULT', label: 'Fast' },
    { modelName: 'grok-3', requestKind: 'REASONING', label: 'Think' },
    { modelName: 'grok-3', requestKind: 'DEEPSEARCH', label: 'DeepSearch' },
    { modelName: 'grok-4', requestKind: 'DEFAULT', label: 'Grok 4' }
  ];
  const BILLING_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';

  /** Normalise one /rest/rate-limits response. */
  function normalizeRateLimit(json, label) {
    if (!json || typeof json !== 'object') return null;
    let remaining = json.remainingQueries ?? json.remaining;
    let total = json.totalQueries ?? json.total;
    if (remaining == null && json.lowEffortRateLimits) {
      remaining = json.lowEffortRateLimits.remainingQueries;
      total = json.lowEffortRateLimits.totalQueries ?? total;
    }
    if (remaining == null && json.highEffortRateLimits) {
      remaining = json.highEffortRateLimits.remainingQueries;
      total = json.highEffortRateLimits.totalQueries ?? total;
    }
    remaining = Number(remaining);
    total = Number(total);
    if (!Number.isFinite(remaining) || !Number.isFinite(total) || total <= 0) return null;
    const remainingPercent = S.clampPct((remaining / total) * 100);
    const wait = Number(json.waitTimeSeconds);
    const windowH = json.windowSizeSeconds ? Math.round(json.windowSizeSeconds / 3600) : null;
    return {
      label: label || 'Grok',
      remaining,
      total,
      remainingPercent,
      resetAt: Number.isFinite(wait) && wait > 0 ? Date.now() + wait * 1000 : null,
      windowHint: windowH ? S.t('grokWindow', [String(windowH)], '$1h rolling window') : S.t('grokRolling', null, 'Rolling window')
    };
  }

  function combine(models) {
    const ok = models.filter(Boolean);
    if (!ok.length) return null;
    // Headline = the most constrained model, de-duplicated by label.
    const seen = new Set();
    const uniq = ok.filter((m) => (seen.has(m.label) ? false : seen.add(m.label)));
    const top = uniq.slice().sort((a, b) => a.remainingPercent - b.remainingPercent)[0];
    return {
      provider: 'grok',
      remaining: top.remaining,
      total: top.total,
      remainingPercent: top.remainingPercent,
      usedPercent: 100 - top.remainingPercent,
      windowHint: top.label + ' · ' + top.windowHint,
      resetAt: top.resetAt,
      model: top.label,
      breakdown: uniq.length > 1 ? uniq.map((m) => ({ label: m.label, remainingPercent: m.remainingPercent, remaining: m.remaining, resetAt: m.resetAt })) : undefined,
      source: 'rate-limits'
    };
  }

  async function fetchRateLimits() {
    let auth = false;
    const results = await Promise.all(PROBES.map(async (probe) => {
      try {
        const body = { modelName: probe.modelName };
        if (probe.requestKind) body.requestKind = probe.requestKind;
        const res = await fetch('https://grok.com/rest/rate-limits', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.status === 401 || res.status === 403) { auth = true; return null; }
        if (!res.ok) return null;
        return normalizeRateLimit(await res.json(), probe.label);
      } catch (_) {
        return null;
      }
    }));
    for (const m of results) if (m) lastModels.set(m.label, m);
    return { data: combine(results), auth };
  }

  const lastModels = new Map();

  let lastPaid = null;

  /** Paid weekly usage: explicit JSON first, protobuf float decode as labelled fallback. */
  async function fetchPaidWeekly() {
    try {
      const res = await fetch(BILLING_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'connect-protocol-version': '1' },
        body: '{}'
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
        const fields = S.pickUsageFields(await res.json());
        if (fields) {
          return {
            provider: 'grok', isFree: false,
            remainingPercent: fields.remainingPercent, usedPercent: fields.usedPercent,
            weeklyRemaining: fields.remainingPercent, resetAt: fields.resetAt,
            windowHint: S.t('grokWeekly', null, 'Weekly pool'), source: 'grpc-json'
          };
        }
      }
    } catch (_) {}
    try {
      const res = await fetch(BILLING_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1', accept: 'application/grpc-web+proto' },
        body: new Uint8Array([0, 0, 0, 0, 0])
      });
      if (!res.ok) return null;
      const cands = S.protobufFloatCandidates(new Uint8Array(await res.arrayBuffer()));
      if (!cands.length) return null;
      let chosen = null;
      if (lastPaid) chosen = cands.find((c) => c.path === lastPaid.path && Math.abs(c.value - lastPaid.value) <= 40) || null;
      if (!chosen) chosen = cands.find((c) => c.value >= 1 && c.value <= 99) || cands[0];
      lastPaid = chosen;
      const used = S.clampPct(chosen.value);
      return {
        provider: 'grok', isFree: false,
        usedPercent: used, remainingPercent: 100 - used, weeklyRemaining: 100 - used,
        windowHint: S.t('grokWeeklyEst', null, 'Weekly pool (estimated)'),
        note: S.t('grokHeuristicNote', null, 'Decoded from a binary billing response without a documented field — treat as an estimate.'),
        source: 'grpc-heuristic'
      };
    } catch (_) {
      return null;
    }
  }

  function scanBanner(sel) {
    const hit = P.helpers.scanLimitBanner(sel);
    return hit ? { provider: 'grok', usedPercent: 100, remainingPercent: 0, windowHint: S.t('limitReached', null, 'Limit reached'), resetHint: hit.text, source: 'dom-limit' } : null;
  }

  P.register({
    id: 'grok',
    initialDelays: [1200, 4000],
    pollMs: 60000,
    init({ applyData }) {
      // Live updates from the page's own rate-limit calls (via page-hook.js).
      window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data || e.data.__zeroGrok !== 'rate-limits') return;
        const probe = PROBES.find((p) => p.modelName === e.data.modelName && (p.requestKind || '') === (e.data.requestKind || ''));
        const one = normalizeRateLimit(e.data.json, probe ? probe.label : 'Grok');
        if (!one) return;
        lastModels.set(one.label, one);
        applyData(combine([...lastModels.values()]));
      });
    },
    async scrape(ctx) {
      const free = await fetchRateLimits();
      if (free.data) return { data: free.data };
      const paid = await fetchPaidWeekly();
      if (paid) return { data: paid };
      const banner = scanBanner(ctx.selectors);
      if (banner) return { data: banner };
      if (free.auth) return { status: 'signed-out' };
      return { status: 'no-data', failure: true, detail: 'no-endpoint' };
    }
  });
})();

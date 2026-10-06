/**
 * Zero Grok – Claude.ai
 *   GET /api/organizations → org uuid
 *   GET /api/organizations/{uuid}/usage → five_hour / seven_day (+ per-model) utilization
 * The background worker also polls this every few minutes and pushes results.
 */
(function () {
  'use strict';
  const S = window.ZeroGrokShared;
  const P = window.ZeroGrokProvider;
  if (!S || !P) return;

  const LABELS = {
    five_hour: '5-hour session', seven_day: 'Weekly', seven_day_opus: 'Weekly · Opus',
    seven_day_sonnet: 'Weekly · Sonnet', seven_day_oauth_apps: 'Weekly · apps'
  };
  let orgId = null;

  async function fetchOrg() {
    const res = await fetch('https://claude.ai/api/organizations', { credentials: 'include', cache: 'no-store' });
    if (res.status === 401 || res.status === 403) return { auth: true };
    if (!res.ok) return null;
    const json = await res.json();
    const list = Array.isArray(json) ? json : (json.organizations || json.data || []);
    const chat = list.find((o) => Array.isArray(o.capabilities) && (o.capabilities.includes('chat') || o.capabilities.includes('claude_chat')));
    const org = chat || list.find((o) => o.uuid || o.id);
    return org ? { id: org.uuid || org.id } : null;
  }

  function fromBucket(key, b) {
    if (!b || typeof b !== 'object') return null;
    let util = b.utilization ?? b.used_percent ?? b.percent;
    if (util == null && S.isNum(b.used) && b.limit) util = (b.used / b.limit) * 100;
    util = Number(util);
    if (!Number.isFinite(util)) return null;
    util = S.clampPct(util);
    return { key, label: LABELS[key] || key.replace(/_/g, ' '), used: util, remaining: 100 - util, resetAt: S.toResetMs(b.resets_at || b.reset_at || b.resetsAt) };
  }

  function normalizeUsage(json) {
    if (!json || typeof json !== 'object') return null;
    const buckets = [];
    for (const [k, v] of Object.entries(json)) {
      const b = fromBucket(k, v);
      if (b) buckets.push(b);
    }
    if (!buckets.length) return null;
    buckets.sort((a, b) => b.used - a.used);
    const top = buckets[0];
    const weekly = buckets.find((b) => b.key === 'seven_day');
    return {
      provider: 'claude',
      usedPercent: top.used,
      remainingPercent: top.remaining,
      windowHint: top.label,
      resetAt: top.resetAt,
      weeklyRemaining: weekly ? weekly.remaining : null,
      breakdown: buckets.map((b) => ({ label: b.label, remainingPercent: b.remaining, resetAt: b.resetAt })),
      source: 'org-usage'
    };
  }

  P.register({
    id: 'claude',
    initialDelays: [2000],
    pollMs: 60000,
    messages: {
      'no-org': S.t('claudeNoOrg', null, 'No organization found — open claude.ai once while signed in.'),
      'no-data': S.t('claudeNoData', null, 'Could not read usage yet — try Refresh after a chat.')
    },
    async scrape(ctx) {
      try {
        if (!orgId) {
          const org = await fetchOrg();
          if (org && org.auth) return { status: 'signed-out' };
          if (org && org.id) orgId = org.id;
        }
        if (orgId) {
          const res = await fetch('https://claude.ai/api/organizations/' + encodeURIComponent(orgId) + '/usage', { credentials: 'include', cache: 'no-store' });
          if (res.status === 401 || res.status === 403) { orgId = null; return { status: 'signed-out' }; }
          if (res.ok) {
            const data = normalizeUsage(await res.json());
            if (data) return { data };
          }
        }
      } catch (_) {}
      const hit = ctx.helpers.scanLimitBanner(ctx.selectors);
      if (hit) {
        return { data: { provider: 'claude', usedPercent: 100, remainingPercent: 0, windowHint: S.t('limitReached', null, 'Limit reached'), resetHint: hit.text, source: 'dom-limit' } };
      }
      return { status: 'no-data', failure: true, detail: orgId ? 'no-data' : 'no-org' };
    }
  });
})();

const S = globalThis.ZeroGrokShared;
const { h, msg, applyI18n, applyTheme } = globalThis.ZeroGrokPage;
const t = S.t;
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = { usage: null, settings: null, health: {}, history: [], update: null, granted: {}, days: 7, chartProvider: null };

async function load() {
  const [usage, settings, health, history, update] = await Promise.all([
    msg('GET_USAGE'), msg('GET_SETTINGS'), msg('GET_HEALTH'), msg('GET_HISTORY'), msg('GET_UPDATE')
  ]);
  Object.assign(state, { usage: usage || { byProvider: {} }, settings: settings || S.DEFAULT_SETTINGS, health: health || {}, history: history || [], update });
  for (const p of S.PROVIDERS.filter((x) => x.optional && state.settings[x.settingKey])) {
    try { state.granted[p.id] = await chrome.permissions.contains({ origins: p.hosts }); } catch (_) { state.granted[p.id] = false; }
  }
  applyTheme(state.settings);
  render();
}

function enabledProviders() {
  const s = state.settings;
  return S.PROVIDERS.filter((p) => (p.optional ? s[p.settingKey] === true : s[p.settingKey] !== false));
}

function levelClass(rem) {
  return rem == null ? '' : rem <= 10 ? 'critical' : rem <= 30 ? 'warn' : 'ok';
}

function render() {
  renderUpdate();
  renderSuggestion();
  renderCards();
  renderHistory();
}

function renderUpdate() {
  const u = state.update;
  const el = document.getElementById('update-banner');
  const show = !!(state.settings.autoCheckUpdates && u && u.available && u.dismissedVersion !== u.latest);
  el.hidden = !show;
  if (!show) return;
  document.getElementById('update-title').textContent = t('updateAvailableVer', [u.latest], 'Zero Grok $1 is available');
  document.getElementById('update-notes').textContent = u.releaseNotes || '';
}

function renderSuggestion() {
  const el = document.getElementById('suggest-banner');
  el.hidden = true;
  if (state.settings.suggestSwitch === false) return;
  for (const p of enabledProviders()) {
    const sg = S.suggestSwitch(state.usage.byProvider || {}, state.settings, p.id);
    if (sg) {
      el.textContent = t('suggestLong', [sg.fromLabel, String(Math.round(sg.fromRemaining)), sg.label, String(Math.round(sg.remaining))], '$1 is at $2% — $3 has $4% left.');
      el.hidden = false;
      return;
    }
  }
}

function renderCards() {
  const root = document.getElementById('providers');
  const hint = document.getElementById('empty-hint');
  const by = state.usage.byProvider || {};
  const now = Date.now();
  root.replaceChildren();
  let any = false;
  for (const meta of enabledProviders()) {
    const data = by[meta.id];
    const health = state.health[meta.id];
    const needsUpdate = health && health.status === 'needs-update' && (!data || (health.since || 0) >= (data.updatedAt || 0));
    const rem = needsUpdate ? null : S.remainingOf(data);
    const conf = data ? S.confidenceOf(data.source) : null;
    const stale = data && data.updatedAt && now - data.updatedAt > 6 * 3600000;
    const resetAt = data && S.toResetMs(data.resetAt);
    any = any || rem != null || (data && (S.isNum(data.remaining) || S.isNum(data.count)));

    let pctText = '—';
    if (needsUpdate) pctText = '?';
    else if (rem != null) pctText = (conf === 'estimate' ? '~' : '') + Math.round(rem) + '%';
    else if (data && S.isNum(data.remaining)) pctText = t('nLeft', [String(data.remaining)], '$1 left');
    else if (data && S.isNum(data.count)) pctText = t('nSent', [String(data.count)], '$1 sent');

    const subParts = [];
    if (!data) subParts.push(t('noDataYet', null, 'No data yet'));
    else {
      if (data.windowHint) subParts.push(data.windowHint);
      if (resetAt && resetAt > now) subParts.push(t('resetsIn', [S.formatDuration(resetAt - now)], 'Resets in $1'));
      else if (data.resetHint) subParts.push(data.resetHint);
      if (data.updatedAt) subParts.push(new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (stale ? ' · ' + t('stale', null, 'stale') : ''));
    }

    const children = [
      h('div', { class: 'pc-head' }, [
        h('span', { class: 'pc-dot', style: { background: meta.color } }),
        h('span', { class: 'pc-name', text: meta.label }),
        conf ? h('span', { class: 'conf conf-' + conf, text: S.confidenceLabel(conf), title: t('confTooltip', null, 'Where this number comes from') }) : null,
        h('span', { class: 'pc-pct ' + (needsUpdate ? 'unknown' : levelClass(rem)), text: pctText })
      ]),
      h('div', { class: 'bar-wrap' }, [h('div', { class: 'bar', style: { width: (rem == null ? 0 : rem) + '%', background: meta.color } })]),
      h('div', { class: 'pc-sub', text: subParts.join(' · ') })
    ];
    if (needsUpdate) {
      children.push(h('div', { class: 'pc-warn', text: t('needsUpdateShort', [meta.label], '$1 tracking needs an update') }));
    } else if (data && conf !== 'estimate') {
      const f = S.forecastZero(state.history.filter((x) => x.provider === meta.id), { resetAtMs: resetAt });
      if (f && f.status === 'eta') children.push(h('div', { class: 'pc-forecast', text: t('forecastEta', [S.formatClock(f.etaMs)], "At this pace you'll hit zero ~$1") }));
      else if (f && f.status === 'lasts') children.push(h('div', { class: 'pc-forecast', text: t('forecastLasts', null, 'At this pace it lasts until the reset') }));
    }
    if (data && Array.isArray(data.breakdown) && data.breakdown.length > 1) {
      const bd = h('div', { class: 'pc-bd' });
      for (const b of data.breakdown.slice(0, 4)) {
        bd.appendChild(h('span', { text: b.label }));
        bd.appendChild(h('span', { text: S.isNum(b.remainingPercent) ? Math.round(b.remainingPercent) + '%' : S.isNum(b.remaining) ? t('nLeft', [String(b.remaining)], '$1 left') : '' }));
      }
      children.push(bd);
    }
    if (meta.optional && state.granted[meta.id] === false) {
      children.push(h('button', { class: 'pc-link', type: 'button', text: t('grantNeeded', [meta.label], 'Allow access to $1'), onclick: () => grant(meta) }));
    }
    root.appendChild(h('div', { class: 'provider-card' + (stale ? ' stale' : ''), 'data-provider': meta.id }, children));
  }
  hint.style.display = any ? 'none' : 'block';
}

async function grant(meta) {
  try {
    const ok = await chrome.permissions.request({ origins: meta.hosts });
    if (ok) await msg('SYNC_OPTIONAL_PROVIDERS');
  } catch (_) {}
  load();
}

function renderHistory() {
  const section = document.getElementById('history');
  const withData = enabledProviders().filter((p) => state.history.some((x) => x.provider === p.id));
  section.hidden = !withData.length;
  if (!withData.length) return;
  const sel = document.getElementById('history-provider');
  if (!state.chartProvider || !withData.some((p) => p.id === state.chartProvider)) state.chartProvider = withData[0].id;
  sel.replaceChildren(...withData.map((p) => h('option', { value: p.id, text: p.label, selected: p.id === state.chartProvider })));
  drawChart();
}

function svg(tag, attrs, children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const c of children || []) if (c) el.appendChild(c);
  return el;
}

function drawChart() {
  const meta = S.PROVIDER_BY_ID[state.chartProvider];
  const days = S.dailyPeaks(state.history, state.chartProvider, state.days);
  const W = 300, H = 90, pad = 14, base = H - 14;
  const bw = (W - pad * 2) / days.length;
  const bars = days.map((d, i) => {
    const x = pad + i * bw + bw * 0.15;
    const hgt = d.peak == null ? 0 : Math.max(1.5, ((base - 6) * d.peak) / 100);
    const label = new Date(d.day).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const title = svg('title');
    title.textContent = d.peak == null ? label + ': ' + t('noData', null, 'no data') : label + ': ' + t('peakUsed', [String(Math.round(d.peak))], 'peak $1% used');
    return svg('rect', { x: x.toFixed(1), y: (base - hgt).toFixed(1), width: (bw * 0.7).toFixed(1), height: hgt.toFixed(1), rx: 1.5, fill: d.peak == null ? 'rgba(127,127,127,0.25)' : meta.color, opacity: d.peak == null ? 1 : 0.9 }, [title]);
  });
  const axis = svg('line', { x1: pad, x2: W - pad, y1: base, y2: base, stroke: 'currentColor', 'stroke-opacity': 0.25 });
  const mk = (x, anchor, text) => { const el = svg('text', { x, y: H - 2, 'font-size': 9, 'text-anchor': anchor, fill: 'currentColor', 'fill-opacity': 0.6 }); el.textContent = text; return el; };
  const fmt = (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const top = svg('line', { x1: pad, x2: W - pad, y1: 6, y2: 6, stroke: 'currentColor', 'stroke-opacity': 0.12, 'stroke-dasharray': '3 3' });
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('chartAria', [meta.label, String(state.days)], '$1 daily peak usage, last $2 days') },
    [top, ...bars, axis, mk(pad, 'start', fmt(days[0].day)), mk(W - pad, 'end', t('today', null, 'Today'))]);
  document.getElementById('chart').replaceChildren(chart);
  const withData = days.filter((d) => d.peak != null);
  const avg = withData.length ? Math.round(withData.reduce((a, d) => a + d.peak, 0) / withData.length) : null;
  document.getElementById('chart-caption').textContent = avg == null ? '' : t('chartCaption', [String(avg), String(withData.length)], 'Avg daily peak $1% used · $2 days with data');
}

document.getElementById('history-provider').addEventListener('change', (e) => { state.chartProvider = e.target.value; drawChart(); });
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
  state.days = parseInt(b.dataset.days, 10);
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
  drawChart();
}));

document.getElementById('refresh').addEventListener('click', async () => {
  const btn = document.getElementById('refresh');
  btn.disabled = true;
  btn.textContent = t('refreshing', null, 'Refreshing…');
  try { await msg('REFRESH_ALL'); } catch (_) {}
  setTimeout(async () => {
    await load();
    btn.disabled = false;
    btn.textContent = t('refreshAll', null, 'Refresh all');
  }, 900);
});

document.getElementById('share').addEventListener('click', async () => {
  const card = globalThis.ZeroGrokShareCard;
  const rows = card.rowsFromUsage(state.usage, state.settings);
  const canvas = card.draw(rows, {
    title: t('shareTitle', null, 'My AI usage today'),
    subtitle: new Date().toLocaleString(),
    leftWord: t('leftWord', null, 'left'),
    footer: t('shareFooter', null, 'Zero Grok · data stays in my browser')
  });
  await card.download(canvas, 'zero-grok-usage-' + new Date().toISOString().slice(0, 10) + '.png');
});

document.getElementById('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('update-download').addEventListener('click', () => msg('OPEN_UPDATE'));
document.getElementById('update-dismiss').addEventListener('click', async () => {
  await msg('DISMISS_UPDATE');
  document.getElementById('update-banner').hidden = true;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.zeroGrokUsage || changes.zeroGrokHealth || changes.zeroGrokSettings) load();
});
setInterval(() => { if (state.usage) renderCards(); }, 30000);

applyI18n();
load();

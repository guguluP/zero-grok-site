const PROVIDER_META = [
  { id: 'grok', label: 'Grok', color: '#c41e3a' },
  { id: 'claude', label: 'Claude', color: '#d97757' },
  { id: 'chatgpt', label: 'ChatGPT', color: '#10a37f' },
  { id: 'gemini', label: 'Gemini', color: '#4285f4' }
];

async function load() {
  const [usage, settings] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_USAGE' }),
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
  ]);
  render(usage, settings || {});
}

function remainingOf(d) {
  if (!d) return null;
  if (typeof d.remainingPercent === 'number' && Number.isFinite(d.remainingPercent)) {
    return d.remainingPercent;
  }
  if (typeof d.usedPercent === 'number' && Number.isFinite(d.usedPercent)) {
    return Math.max(0, 100 - d.usedPercent);
  }
  return null;
}

function render(usage, settings) {
  const root = document.getElementById('providers');
  const hint = document.getElementById('empty-hint');
  const by = usage?.byProvider || {};
  root.innerHTML = '';

  let any = false;
  for (const meta of PROVIDER_META) {
    const flag =
      meta.id === 'chatgpt' ? settings.enableChatgpt :
      meta.id === 'gemini' ? settings.enableGemini :
      meta.id === 'claude' ? settings.enableClaude :
      settings.enableGrok;
    if (flag === false) continue;

    const data = by[meta.id];
    const rem = remainingOf(data);
    any = any || rem != null;

    const card = document.createElement('div');
    card.className = 'provider-card';
    const barClass =
      rem == null ? '' :
      rem <= 10 ? 'critical' :
      rem <= 30 ? 'warn' : 'ok';

    const pctText = rem == null ? '—' : `${Math.round(rem)}%`;
    let sub;
    if (!data) {
      sub = 'No data yet';
    } else if (rem != null && rem <= 2) {
      const refill = data.resetAt ? formatReset(data.resetAt) : (data.resetHint || '');
      sub = refill ? `Refilling ${refill.replace(/^refills\s+/i, 'in ')}` : (data.resetHint || 'At limit — waiting for refill');
    } else {
      sub = [data.windowHint, data.resetHint || (data.resetAt ? formatReset(data.resetAt) : '')]
          .filter(Boolean).join(' · ') || 'Updated';
    }
    const when = data?.updatedAt
      ? ` · ${new Date(data.updatedAt).toLocaleTimeString()}`
      : '';

    card.innerHTML = `
      <div class="pc-head">
        <span class="pc-dot" style="background:${meta.color}"></span>
        <span class="pc-name">${meta.label}</span>
        <span class="pc-pct ${barClass}">${pctText}</span>
      </div>
      <div class="bar-wrap"><div class="bar ${barClass}" style="width:${rem == null ? 0 : rem}%;background:${meta.color}"></div></div>
      <div class="pc-sub">${sub}${when}</div>
    `;
    root.appendChild(card);
  }

  if (hint) hint.style.display = any ? 'none' : 'block';
}

function formatReset(iso) {
  try {
    const d = new Date(iso);
    const diff = d - Date.now();
    if (diff > 0) {
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      if (days > 0) return `refills ${days}d ${hours}h`;
      if (hours > 0) return `refills ~${hours}h`;
      return `refills ~${Math.round(diff / 60000)}m`;
    }
    return d.toLocaleString();
  } catch (_) {
    return '';
  }
}

document.getElementById('refresh').addEventListener('click', async () => {
  const btn = document.getElementById('refresh');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    await chrome.runtime.sendMessage({ type: 'REFRESH_ALL' });
  } catch (_) {}
  setTimeout(async () => {
    await load();
    btn.disabled = false;
    btn.textContent = 'Refresh all';
  }, 900);
});

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

load();

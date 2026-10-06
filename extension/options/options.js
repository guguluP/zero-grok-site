const S = globalThis.ZeroGrokShared;
const { h, msg, applyI18n, applyTheme } = globalThis.ZeroGrokPage;
const t = S.t;
const $ = (id) => document.getElementById(id);

const PLAN_LABELS = {
  free: 'Free', supergrok: 'SuperGrok', heavy: 'SuperGrok Heavy', pro: 'Pro', max: 'Max', plus: 'Plus', ultra: 'Ultra'
};
let current = null;

function flash(text, ok = true) {
  const el = $('saved');
  el.textContent = text;
  el.style.color = ok ? '' : 'var(--crit)';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.textContent = ''; }, 2500);
}

function buildProviders(s) {
  const root = $('provider-list');
  root.replaceChildren();
  for (const p of S.PROVIDERS) {
    const on = p.optional ? s[p.settingKey] === true : s[p.settingKey] !== false;
    const cb = h('input', { type: 'checkbox', id: p.settingKey, 'data-provider': p.id });
    cb.checked = on;
    cb.addEventListener('change', () => onProviderToggle(p, cb));
    const plan = h('select', { id: 'plan-' + p.id, 'aria-label': t('planFor', [p.label], '$1 plan') },
      p.plans.map((pl) => h('option', { value: pl, text: PLAN_LABELS[pl] || pl })));
    plan.value = (s.plans && s.plans[p.id]) || p.plans[0];
    root.appendChild(h('div', { class: 'prov' }, [
      cb,
      h('label', { for: p.settingKey }, [
        h('span', { class: 'dot', style: { background: p.color } }), p.label,
        p.optional ? h('span', { class: 'tag', text: t('optionalTag', null, 'asks for site access') }) : null
      ]),
      plan
    ]));
  }
}

async function onProviderToggle(p, cb) {
  if (!p.optional) return;
  try {
    if (cb.checked) {
      const ok = await chrome.permissions.request({ origins: p.hosts });
      if (!ok) {
        cb.checked = false;
        flash(t('permDenied', [p.label], 'Access to $1 was not granted.'), false);
      }
    } else {
      await chrome.permissions.remove({ origins: p.hosts });
    }
  } catch (e) {
    cb.checked = false;
    flash(String(e.message || e), false);
  }
}

function buildBadgeModes(s) {
  const opts = [
    ['lowest', t('badgeLowest', null, 'Lowest remaining (all AIs)')],
    ['last', t('badgeLast', null, 'Last updated AI')],
    ...S.PROVIDERS.map((p) => [p.id, t('badgeOnly', [p.label], 'Only $1')]),
    ['off', t('badgeOff', null, 'Nothing (badge off)')]
  ];
  $('badgeMode').replaceChildren(...opts.map(([v, l]) => h('option', { value: v, text: l })));
  $('badgeMode').value = s.badgeMode;
}

function renderHiddenSites(list) {
  const ul = $('hidden-sites');
  ul.replaceChildren(...(list || []).map((host) => h('li', {}, [
    host,
    h('button', { type: 'button', 'aria-label': t('unhideSite', [host], 'Show the can on $1 again'), text: '×', onclick: async () => {
      const r = await msg('HIDE_SITE', { host, hidden: false });
      renderHiddenSites(r && r.hiddenSites);
    } })
  ])));
  $('hidden-empty').hidden = !!(list && list.length);
}

async function renderUpdateStatus(info) {
  info = info || (await msg('GET_UPDATE'));
  const el = $('update-status');
  const installed = chrome.runtime.getManifest().version;
  if (!info || !info.checkedAt) { el.textContent = t('updateNever', [installed], 'Installed $1 · not checked yet'); return; }
  const when = new Date(info.checkedAt).toLocaleString();
  el.textContent = info.error
    ? t('updateFailed', [installed, when], 'Installed $1 · check failed ($2)')
    : info.available
      ? t('updateNewer', [installed, info.latest, when], 'Installed $1 · $2 available (checked $3)')
      : t('updateCurrent', [installed, when], 'Installed $1 · up to date (checked $2)');
}

async function load() {
  const s = await msg('GET_SETTINGS');
  current = s;
  applyTheme(s);
  buildProviders(s);
  buildBadgeModes(s);
  $('position').value = s.canPosition;
  $('theme').value = s.theme;
  $('reduceMotion').checked = !!s.reduceMotion;
  $('hideCan').checked = !!s.hideCan;
  $('sound').checked = s.soundEnabled !== false;
  $('estimateMessages').checked = !!s.estimateMessagesEnabled;
  $('thresholds').value = (s.alertThresholds || []).join(', ');
  $('notifyOnReset').checked = s.notifyOnReset !== false;
  $('suggestSwitch').checked = s.suggestSwitch !== false;
  $('quietHoursEnabled').checked = !!s.quietHoursEnabled;
  $('quietStart').value = s.quietStart;
  $('quietEnd').value = s.quietEnd;
  $('poll').value = s.pollIntervalMinutes;
  $('autoCheckUpdates').checked = !!s.autoCheckUpdates;
  $('remoteSelectors').checked = s.remoteSelectors !== false;
  renderHiddenSites(s.hiddenSites);
  renderUpdateStatus();
}

function parseThresholds(str) {
  const parts = String(str || '').split(/[,\s]+/).filter(Boolean);
  const nums = parts.map((x) => parseInt(x, 10));
  if (!parts.length || nums.some((n) => !Number.isFinite(n) || n < 1 || n > 100)) return null;
  return [...new Set(nums)].sort((a, b) => a - b).slice(0, 6);
}

$('save').addEventListener('click', async () => {
  const thresholds = parseThresholds($('thresholds').value);
  $('thresholds-error').textContent = thresholds ? '' : t('thresholdsInvalid', null, 'Use numbers from 1 to 100, e.g. 50, 80, 95');
  if (!thresholds) return;
  const plans = {};
  const payload = {
    canPosition: $('position').value,
    theme: $('theme').value,
    reduceMotion: $('reduceMotion').checked,
    hideCan: $('hideCan').checked,
    soundEnabled: $('sound').checked,
    estimateMessagesEnabled: $('estimateMessages').checked,
    alertThresholds: thresholds,
    notifyOnReset: $('notifyOnReset').checked,
    suggestSwitch: $('suggestSwitch').checked,
    quietHoursEnabled: $('quietHoursEnabled').checked,
    quietStart: $('quietStart').value || '22:00',
    quietEnd: $('quietEnd').value || '07:00',
    badgeMode: $('badgeMode').value,
    pollIntervalMinutes: parseInt($('poll').value, 10) || 5,
    autoCheckUpdates: $('autoCheckUpdates').checked,
    remoteSelectors: $('remoteSelectors').checked,
    onboardingComplete: true,
    plans
  };
  for (const p of S.PROVIDERS) {
    payload[p.settingKey] = $(p.settingKey).checked;
    plans[p.id] = $('plan-' + p.id).value;
  }
  const r = await msg('SAVE_SETTINGS', { payload });
  if (r && r.ok) {
    current = r.settings;
    applyTheme(r.settings);
    flash(r.synced ? t('savedSynced', null, 'Saved ✓ (synced)') : t('savedLocal', null, 'Saved ✓ (this device)'));
  } else {
    flash(t('saveFailed', null, 'Could not save'), false);
  }
});

function downloadBlob(content, type, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const stamp = () => new Date().toISOString().slice(0, 10);

$('exportJson').addEventListener('click', async () => {
  const [usage, history] = await Promise.all([msg('GET_USAGE'), msg('GET_HISTORY')]);
  downloadBlob(JSON.stringify({ exportedAt: new Date().toISOString(), version: chrome.runtime.getManifest().version, usage, history }, null, 2),
    'application/json', `zero-grok-history-${stamp()}.json`);
});
$('exportCsv').addEventListener('click', async () => {
  const history = await msg('GET_HISTORY');
  downloadBlob(S.historyToCsv(history), 'text/csv', `zero-grok-history-${stamp()}.csv`);
});
$('shareCard').addEventListener('click', async () => {
  const [usage, settings] = await Promise.all([msg('GET_USAGE'), msg('GET_SETTINGS')]);
  const card = globalThis.ZeroGrokShareCard;
  const canvas = card.draw(card.rowsFromUsage(usage, settings), {
    title: t('shareTitle', null, 'My AI usage today'), leftWord: t('leftWord', null, 'left'),
    footer: t('shareFooter', null, 'Zero Grok · data stays in my browser')
  });
  await card.download(canvas, `zero-grok-usage-${stamp()}.png`);
});
$('clearHistory').addEventListener('click', async () => {
  if (!confirm(t('clearConfirm', null, 'Delete all locally stored usage history?'))) return;
  await msg('CLEAR_HISTORY');
  flash(t('historyCleared', null, 'History cleared'));
});
$('checkNow').addEventListener('click', async () => {
  $('update-status').textContent = t('checking', null, 'Checking…');
  renderUpdateStatus(await msg('CHECK_UPDATE_NOW'));
});
$('shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => flash(t('shortcutsManual', null, 'Open your browser’s extension shortcut settings'), false));
});
$('reopen-onboarding').addEventListener('click', (e) => {
  e.preventDefault();
  msg('OPEN_ONBOARDING');
});

applyI18n();
load();

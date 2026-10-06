const S = globalThis.ZeroGrokShared;
const { h, msg, applyI18n } = globalThis.ZeroGrokPage;
const t = S.t;
const $ = (id) => document.getElementById(id);
const PLAN_LABELS = { free: 'Free', supergrok: 'SuperGrok', heavy: 'SuperGrok Heavy', pro: 'Pro', max: 'Max', plus: 'Plus', ultra: 'Ultra' };

async function load() {
  const s = await msg('GET_SETTINGS');
  const root = $('providers');
  for (const p of S.PROVIDERS) {
    const cb = h('input', { type: 'checkbox', id: p.settingKey });
    cb.checked = p.optional ? s[p.settingKey] === true : s[p.settingKey] !== false;
    const plan = h('select', { id: 'plan-' + p.id, 'aria-label': t('planFor', [p.label], '$1 plan') },
      p.plans.map((pl) => h('option', { value: pl, text: PLAN_LABELS[pl] || pl })));
    plan.value = s.plans[p.id] || p.plans[0];
    root.appendChild(h('div', { class: 'prov-row' }, [
      cb,
      h('label', { for: p.settingKey }, [h('span', { class: 'dot', style: { background: p.color } }), p.label,
        p.optional ? h('span', { class: 'tag', text: t('optionalTag', null, 'asks for site access') }) : null]),
      plan
    ]));
  }
  $('position').value = s.canPosition;
  $('theme').value = s.theme;
  $('sound').checked = s.soundEnabled !== false;
  $('reduceMotion').checked = !!s.reduceMotion;
  $('autoCheckUpdates').checked = !!s.autoCheckUpdates;
  // Unpacked (ZIP) installs can't auto-update: pre-tick the GitHub check for them.
  if (!s.onboardingComplete) {
    try {
      const self = await chrome.management.getSelf();
      if (self.installType === 'development') $('autoCheckUpdates').checked = true;
    } catch (_) {}
  }
}

$('save').addEventListener('click', async () => {
  const payload = {
    canPosition: $('position').value,
    theme: $('theme').value,
    soundEnabled: $('sound').checked,
    reduceMotion: $('reduceMotion').checked,
    autoCheckUpdates: $('autoCheckUpdates').checked,
    onboardingComplete: true,
    plans: {}
  };
  const wantOptional = [];
  for (const p of S.PROVIDERS) {
    payload[p.settingKey] = $(p.settingKey).checked;
    payload.plans[p.id] = $('plan-' + p.id).value;
    if (p.optional && payload[p.settingKey]) wantOptional.push(p);
  }
  if (wantOptional.length) {
    let granted = false;
    try {
      // One prompt for every optional site the user picked (must run inside the click).
      granted = await chrome.permissions.request({ origins: wantOptional.flatMap((p) => p.hosts) });
    } catch (_) {}
    if (!granted) {
      for (const p of wantOptional) payload[p.settingKey] = false;
      $('status').textContent = t('onbPermSkipped', null, 'Optional sites were not enabled because access was not granted. You can turn them on later in Options.');
    }
  }
  await msg('SAVE_SETTINGS', { payload });
  if (payload.soundEnabled) {
    try { localStorage.removeItem('zeroGrokPopPlayed'); } catch (_) {}
  }
  if (!$('status').textContent) $('status').textContent = t('onbSaved', null, 'Saved! Open any supported AI site to see your can.');
  setTimeout(() => {
    try {
      chrome.tabs.getCurrent((tab) => { if (tab?.id) chrome.tabs.remove(tab.id); });
    } catch (_) {}
  }, 1200);
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

applyI18n();
load();

import './shared.js';

const S = globalThis.ZeroGrokShared;

export const STORAGE_KEYS = {
  USAGE: 'zeroGrokUsage',
  SETTINGS: 'zeroGrokSettings',
  LAST_ALERT: 'zeroGrokLastAlert',
  HISTORY: 'zeroGrokHistory',
  UPDATE: 'zeroGrokUpdate',
  HEALTH: 'zeroGrokHealth',
  ESTIMATES: 'zeroGrokEstimates',
  SELECTORS: 'zeroGrokSelectors'
};

export const DEFAULT_SETTINGS = S.DEFAULT_SETTINGS;
export const PROVIDERS = S.PROVIDERS;
export const PROVIDER_BY_ID = S.PROVIDER_BY_ID;

export const PRODUCT_LABELS = {
  2: 'Grok Build',
  4: 'Chat',
  5: 'Imagine',
  6: 'Voice'
};

export const ALARM_NAMES = {
  POLL: 'zeroGrokPoll',
  RESET: 'zeroGrokReset', // legacy single-name; prefer per-provider
  UPDATE: 'zeroGrokUpdateCheck',
  SELECTORS: 'zeroGrokSelectorsRefresh',
  resetFor(provider) {
    return 'zeroGrokReset:' + (provider || 'grok');
  }
};

const RAW_BASE = 'https://raw.githubusercontent.com/guguluP/zero-grok-site/main';

export const UPDATE_FEED = {
  versionJson: [RAW_BASE + '/downloads/version.json'],
  manifestJson: [RAW_BASE + '/extension/manifest.json'],
  zipUrl: 'https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip',
  repoUrl: 'https://github.com/guguluP/zero-grok-site'
};

/** Data-only selector file (never code). Bundled copy is the fallback. */
export const SELECTORS_URL = RAW_BASE + '/extension/selectors.json';

/** Tabs the background pings with SCRAPE_USAGE (built-in providers only; optional ones are added when granted). */
export const ALL_AI_TAB_URLS = [
  'https://grok.com/*',
  'https://grok.x.ai/*',
  'https://x.com/*',
  'https://claude.ai/*',
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://gemini.google.com/*'
];

/** Content-script bundle for each optional provider (registered at runtime once permission is granted). */
export function optionalScriptFor(id) {
  const p = PROVIDER_BY_ID[id];
  if (!p || !p.optional) return null;
  return [
    {
      id: 'zg-hook-' + id,
      matches: p.hosts,
      js: ['content/page-hook.js'],
      runAt: 'document_start',
      world: 'MAIN'
    },
    {
      id: 'zg-' + id,
      matches: p.hosts,
      js: ['utils/shared.js', 'content/can-fx.js', 'content/can-ui.js', 'content/provider-core.js', 'content/' + id + '.js'],
      css: ['content/content.css'],
      runAt: 'document_idle'
    }
  ];
}

export const STORAGE_KEYS = {
  USAGE: 'zeroGrokUsage',
  SETTINGS: 'zeroGrokSettings',
  LAST_ALERT: 'zeroGrokLastAlert',
  POSITION: 'zeroGrokPosition',
  HISTORY: 'zeroGrokHistory',
  UPDATE: 'zeroGrokUpdate'
};

export const DEFAULT_SETTINGS = {
  canPosition: 'bottom-right',
  alertThresholds: [70, 90, 100],
  theme: 'auto',
  hideCan: false,
  soundEnabled: true,
  badgeEnabled: true,
  badgeMode: 'lowest', // 'lowest' | 'last'
  pollIntervalMinutes: 5,
  enableGrok: true,
  enableClaude: true,
  enableChatgpt: true,
  enableGemini: true,
  estimateMessagesEnabled: false,
  onboardingComplete: false,
  autoCheckUpdates: true
};

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
  resetFor(provider) {
    return 'zeroGrokReset:' + (provider || 'grok');
  }
};

export const UPDATE_FEED = {
  versionJson: [
    'https://raw.githubusercontent.com/guguluP/zero-grok-site/main/downloads/version.json',
    'https://cdn.jsdelivr.net/gh/guguluP/zero-grok-site@main/downloads/version.json'
  ],
  manifestJson: [
    'https://raw.githubusercontent.com/guguluP/zero-grok-site/main/extension/manifest.json'
  ],
  zipUrl: 'https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip',
  repoUrl: 'https://github.com/guguluP/zero-grok-site'
};

export const ALL_AI_TAB_URLS = [
  'https://grok.com/*',
  'https://grok.x.ai/*',
  'https://x.com/*',
  'https://claude.ai/*',
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://gemini.google.com/*'
];

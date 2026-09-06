export const STORAGE_KEYS = {
  USAGE: 'zeroGrokUsage',
  SETTINGS: 'zeroGrokSettings',
  LAST_ALERT: 'zeroGrokLastAlert',
  POSITION: 'zeroGrokPosition',
  HISTORY: 'zeroGrokHistory'
};

export const DEFAULT_SETTINGS = {
  canPosition: 'bottom-right',
  alertThresholds: [70, 90, 100],
  theme: 'auto',
  hideCan: false,
  soundEnabled: true,
  badgeEnabled: true,
  badgeMode: 'lowest',
  pollIntervalMinutes: 5,
  enableGrok: true,
  enableClaude: true,
  enableChatgpt: true,
  enableGemini: true,
  estimateMessagesEnabled: false,
  onboardingComplete: false
};

export const PRODUCT_LABELS = {
  2: 'Grok Build',
  4: 'Chat',
  5: 'Imagine',
  6: 'Voice'
};

export const ALARM_NAMES = {
  POLL: 'zeroGrokPoll',
  RESET: 'zeroGrokReset'
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

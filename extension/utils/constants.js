// Zero Grok constants
export const PROVIDERS = ['grok', 'claude', 'chatgpt', 'gemini'];
export const STORAGE_KEYS = {
  BY_PROVIDER: 'byProvider',
  HISTORY: 'history',
  SETTINGS: 'settings',
  HIDE_CAN: 'hideCan',
  ESTIMATE_COUNTER: 'estimateCounter'
};
export const DEFAULT_SETTINGS = {
  warningThreshold: 20,
  badgeMode: 'lowest',
  enableEstimate: false,
  theme: 'auto'
};
export const REFILL_HINTS = {
  grok: 2 * 60 * 60 * 1000,
  claude: 5 * 60 * 60 * 1000,
  chatgpt: 3 * 60 * 60 * 1000,
  gemini: 5 * 60 * 60 * 1000
};

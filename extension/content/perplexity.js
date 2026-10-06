/**
 * Zero Grok – Perplexity (optional provider; enabled + permission granted in Options).
 * Perplexity shows "N Pro searches left" in its UI for some plans; we read that
 * number as-is (no invented total). Otherwise: limit banners and a clearly
 * labelled local estimate.
 */
(function () {
  'use strict';
  if (!window.ZeroGrokProvider) return;
  window.ZeroGrokProvider.registerGeneric('perplexity', { windowHint: 'Pro searches' });
})();

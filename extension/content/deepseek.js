/**
 * Zero Grok – DeepSeek (optional provider; enabled + permission granted in Options).
 * DeepSeek does not publish chat message limits.
 * No percentage is invented: you get limit-banner detection plus a local message
 * count, labelled "Estimate".
 */
(function () {
  'use strict';
  if (!window.ZeroGrokProvider) return;
  window.ZeroGrokProvider.registerGeneric('deepseek');
})();

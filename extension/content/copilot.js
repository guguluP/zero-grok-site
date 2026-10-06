/**
 * Zero Grok – Microsoft Copilot (optional provider; enabled + permission granted in Options).
 * Copilot does not expose a usage meter.
 * No percentage is invented: you get limit-banner detection plus a local message
 * count, labelled "Estimate".
 */
(function () {
  'use strict';
  if (!window.ZeroGrokProvider) return;
  window.ZeroGrokProvider.registerGeneric('copilot');
})();

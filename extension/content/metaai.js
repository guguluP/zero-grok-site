/**
 * Zero Grok – Meta AI (optional provider; enabled + permission granted in Options).
 * Meta AI does not expose a usage meter.
 * No percentage is invented: you get limit-banner detection plus a local message
 * count, labelled "Estimate".
 */
(function () {
  'use strict';
  if (!window.ZeroGrokProvider) return;
  window.ZeroGrokProvider.registerGeneric('metaai');
})();

/**
 * Zero Grok – Le Chat (Mistral) (optional provider; enabled + permission granted in Options).
 * Le Chat shows a banner when you hit a limit; we read it.
 * No percentage is invented: you get limit-banner detection plus a local message
 * count, labelled "Estimate".
 */
(function () {
  'use strict';
  if (!window.ZeroGrokProvider) return;
  window.ZeroGrokProvider.registerGeneric('mistral');
})();

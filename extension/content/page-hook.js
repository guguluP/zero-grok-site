/**
 * Zero Grok – page-world hook (runs in the page's MAIN world at document_start).
 *
 * Content scripts live in an isolated world, so they cannot see the page's own
 * history.pushState() calls or its fetch() responses. This tiny shim:
 *   1. fires a `zerogrok:navigate` DOM event on SPA navigations, and
 *   2. on grok.com only, forwards JSON bodies of the page's own rate-limit
 *      responses to the content script via window.postMessage (same origin).
 * It never sends anything off the page and never reads cookies or tokens.
 */
(function () {
  'use strict';
  if (window.__zeroGrokPageHook) return;
  window.__zeroGrokPageHook = true;

  function fire() {
    try { window.dispatchEvent(new Event('zerogrok:navigate')); } catch (_) {}
  }
  ['pushState', 'replaceState'].forEach(function (name) {
    var orig = history[name];
    if (typeof orig !== 'function') return;
    history[name] = function () {
      var r = orig.apply(this, arguments);
      fire();
      return r;
    };
  });

  var host = location.hostname;
  if (!/(^|\.)grok\.com$|^grok\.x\.ai$/.test(host)) return;
  var WATCH = /\/rest\/rate-limits/;
  var origFetch = window.fetch;
  if (typeof origFetch !== 'function') return;
  window.fetch = function () {
    var args = arguments;
    var p = origFetch.apply(this, args);
    try {
      var input = args[0];
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (WATCH.test(url)) {
        p.then(function (res) {
          if (!res || !res.ok) return;
          var ct = (res.headers.get('content-type') || '').toLowerCase();
          if (ct.indexOf('json') === -1) return;
          res.clone().json().then(function (json) {
            var body = {};
            try { body = JSON.parse(typeof args[1]?.body === 'string' ? args[1].body : '{}') || {}; } catch (_) {}
            window.postMessage({ __zeroGrok: 'rate-limits', json: json, modelName: String(body.modelName || ''), requestKind: String(body.requestKind || '') }, location.origin);
          }).catch(function () {});
        }).catch(function () {});
      }
    } catch (_) {}
    return p;
  };
})();

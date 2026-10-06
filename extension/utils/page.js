/**
 * Helpers for extension pages (popup, options, onboarding): i18n of static
 * markup via data-i18n attributes and theme application. Plain script.
 */
(function (g) {
  'use strict';
  const S = g.ZeroGrokShared;

  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = S.t(el.getAttribute('data-i18n'), null, el.textContent.trim());
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = S.t(el.getAttribute('data-i18n-title'), null, el.title);
    });
    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      el.setAttribute('aria-label', S.t(el.getAttribute('data-i18n-aria'), null, el.getAttribute('aria-label') || ''));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = S.t(el.getAttribute('data-i18n-placeholder'), null, el.placeholder);
    });
    try {
      const lang = chrome.i18n.getUILanguage();
      if (lang) document.documentElement.lang = lang;
    } catch (_) {}
  }

  function applyTheme(settings) {
    const theme = (settings && settings.theme) || 'auto';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('reduce-motion', !!(settings && settings.reduceMotion));
  }

  /** Small DOM builder for pages (text via textContent – never innerHTML). */
  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children || []) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  function msg(type, extra) {
    return chrome.runtime.sendMessage({ type, ...(extra || {}) });
  }

  g.ZeroGrokPage = { applyI18n, applyTheme, h, msg };
})(globalThis);

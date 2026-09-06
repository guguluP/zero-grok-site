/**
 * Shared can effects: first-use pop, refill pop after 100% used,
 * and "Refilling in Xh Ym" countdown when remaining hits 0.
 */
(function (global) {
  'use strict';

  function storageKey(provider, kind) {
    return `zeroGrok${kind}_${provider || 'default'}`;
  }

  function hasPlayedFirstPop(provider) {
    try {
      return localStorage.getItem(storageKey(provider, 'PopPlayed')) === '1';
    } catch (_) {
      return false;
    }
  }

  function markFirstPop(provider) {
    try {
      localStorage.setItem(storageKey(provider, 'PopPlayed'), '1');
    } catch (_) {}
  }

  function hasPlayedRefillPop(provider, windowId) {
    try {
      return localStorage.getItem(storageKey(provider, 'RefillPop') + '_' + (windowId || 'w')) === '1';
    } catch (_) {
      return false;
    }
  }

  function markRefillPop(provider, windowId) {
    try {
      localStorage.setItem(storageKey(provider, 'RefillPop') + '_' + (windowId || 'w'), '1');
    } catch (_) {}
  }

  function clearRefillPop(provider) {
    try {
      const prefix = storageKey(provider, 'RefillPop') + '_';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) localStorage.removeItem(k);
      }
    } catch (_) {}
  }

  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playPopSound() {
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const duration = 0.28;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 18) * (1 - t * 0.4);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noise.connect(nf); nf.connect(ng); ng.connect(ctx.destination);
    noise.start(now); noise.stop(now + duration);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.22, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    const of = ctx.createBiquadFilter();
    of.type = 'lowpass'; of.frequency.value = 2400;
    osc.connect(of); of.connect(og); og.connect(ctx.destination);
    osc.start(now); osc.stop(now + 0.26);

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(95, now);
    thump.frequency.exponentialRampToValueAtTime(40, now + 0.12);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.35, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    thump.connect(tg); tg.connect(ctx.destination);
    thump.start(now); thump.stop(now + 0.15);
  }

  function tryPlayCanPopWav() {
    try {
      const url = chrome.runtime.getURL('assets/sounds/can-pop.wav');
      const a = new Audio(url);
      a.volume = 0.7;
      const p = a.play();
      if (p && p.catch) p.catch(() => playPopSound());
      return true;
    } catch (_) {
      playPopSound();
      return false;
    }
  }

  function maybeFirstPop(provider, soundEnabled) {
    if (soundEnabled === false) return false;
    if (hasPlayedFirstPop(provider)) return false;
    markFirstPop(provider);
    tryPlayCanPopWav();
    return true;
  }

  function maybeRefillPop(provider, remainingPercent, usedPercent, soundEnabled, windowId) {
    if (soundEnabled === false) return false;
    const rem = typeof remainingPercent === 'number' ? remainingPercent : (typeof usedPercent === 'number' ? 100 - usedPercent : null);
    if (rem == null) return false;
    if (rem <= 2) {
      clearRefillPop(provider);
      return false;
    }
    if (rem < 95) return false;
    if (hasPlayedRefillPop(provider, windowId || 'default')) return false;
    markRefillPop(provider, windowId || 'default');
    tryPlayCanPopWav();
    return true;
  }

  function resolveResetMs(data) {
    if (!data) return null;
    if (data.resetAt) {
      const t = Date.parse(data.resetAt);
      if (Number.isFinite(t)) return t;
    }
    if (data.resetMs && Number.isFinite(data.resetMs)) return data.resetMs;
    const hint = (data.resetHint || data.windowHint || '') + '';
    const m = hint.match(/(\d+)\s*h(?:\s*(\d+)\s*m)?/i) || hint.match(/(\d+)\s*m/i);
    if (m) {
      const h = m[2] != null ? parseInt(m[1], 10) : (hint.includes('h') ? parseInt(m[1], 10) : 0);
      const min = m[2] != null ? parseInt(m[2], 10) : (hint.includes('h') ? 0 : parseInt(m[1], 10));
      return Date.now() + h * 3600000 + min * 60000;
    }
    return null;
  }

  function formatRefillIn(ms) {
    if (!ms || !Number.isFinite(ms)) return '';
    const diff = Math.max(0, ms - Date.now());
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return `Refilling in ${days}d ${hours}h`;
    if (hours > 0) return `Refilling in ${hours}h ${mins}m`;
    if (mins > 0) return `Refilling in ${mins}m`;
    return 'Refilling soon';
  }

  function formatRefillShort(ms) {
    if (!ms || !Number.isFinite(ms)) return '';
    const diff = Math.max(0, ms - Date.now());
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`;
    return `${mins}m`;
  }

  const countdownTimers = new Map();

  function startLimitCountdown(provider, el, resetMs, onTick) {
    stopLimitCountdown(provider);
    if (!el || !resetMs) return;
    const tick = () => {
      const text = formatRefillIn(resetMs);
      if (el) el.textContent = text;
      if (typeof onTick === 'function') onTick(text, resetMs);
      if (resetMs - Date.now() <= 0) stopLimitCountdown(provider);
    };
    tick();
    const id = setInterval(tick, 30000);
    countdownTimers.set(provider, id);
  }

  function stopLimitCountdown(provider) {
    const id = countdownTimers.get(provider);
    if (id) {
      clearInterval(id);
      countdownTimers.delete(provider);
    }
  }

  global.ZeroGrokFx = {
    playPopSound,
    tryPlayCanPopWav,
    maybeFirstPop,
    maybeRefillPop,
    markFirstPop,
    hasPlayedFirstPop,
    resolveResetMs,
    formatRefillIn,
    formatRefillShort,
    startLimitCountdown,
    stopLimitCountdown
  };
})(typeof window !== 'undefined' ? window : self);

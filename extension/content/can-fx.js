/**
 * Shared can effects: first-use pop, refill pop after the limit, fizz particles.
 * Countdown rendering now lives in provider-core.js.
 */
(function (global) {
  'use strict';
  if (global.ZeroGrokCanFx) return;

  function storageKey(provider, kind) {
    return `zeroGrok${kind}_${provider || 'default'}`;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }

  function hasPlayedFirstPop(provider) { return lsGet(storageKey(provider, 'PopPlayed')) === '1'; }
  function markFirstPop(provider) { lsSet(storageKey(provider, 'PopPlayed'), '1'); }
  function wasEmpty(provider) { return lsGet(storageKey(provider, 'WasEmpty')) === '1'; }
  function setWasEmpty(provider, empty) { lsSet(storageKey(provider, 'WasEmpty'), empty ? '1' : null); }

  function reducedMotion() {
    try {
      return !!global.__zgReduceMotion || global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function synthesizePop() {
    try {
      const ctx = new (global.AudioContext || global.webkitAudioContext)();
      const t0 = ctx.currentTime;
      const o1 = ctx.createOscillator();
      const g1 = ctx.createGain();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(110, t0);
      o1.frequency.exponentialRampToValueAtTime(45, t0 + 0.18);
      g1.gain.setValueAtTime(0.5, t0);
      g1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o1.connect(g1); g1.connect(ctx.destination);
      o1.start(t0); o1.stop(t0 + 0.25);
    } catch (_) {}
  }

  function playCanPopSound(soundEnabled) {
    if (soundEnabled === false) return;
    try {
      const audio = new Audio(chrome.runtime.getURL('assets/sounds/can-pop.wav'));
      audio.volume = 0.55;
      audio.play().catch(() => synthesizePop());
    } catch (_) {
      synthesizePop();
    }
  }

  function spawnFizz(originEl, a, b) {
    if (!originEl || reducedMotion() || !document.body) return;
    a = a || '#27ae60';
    b = b || '#fff';
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height * 0.3;
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('div');
      p.className = 'zg-fizz-particle';
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
      const dist = 30 + Math.random() * 40;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(angle) * dist - 18 + 'px');
      p.style.background = i % 3 === 0 ? a : b;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 850);
    }
  }

  function popAnimation(originEl, soundEnabled, colors, delay) {
    if (originEl && !reducedMotion()) originEl.classList.add('zg-pop-in');
    setTimeout(() => {
      playCanPopSound(soundEnabled);
      spawnFizz(originEl, colors?.a, colors?.b);
    }, delay);
    setTimeout(() => originEl?.classList.remove('zg-pop-in'), 800);
  }

  function playFirstUse(originEl, provider, soundEnabled, colors) {
    if (hasPlayedFirstPop(provider)) return;
    markFirstPop(provider);
    popAnimation(originEl, soundEnabled, colors, 280);
  }

  /** Pop once when a provider goes from (near) empty back to available. */
  function trackRefill(provider, remainingPercent, originEl, soundEnabled, colors) {
    if (remainingPercent == null || !Number.isFinite(remainingPercent)) return;
    if (remainingPercent <= 2) {
      setWasEmpty(provider, true);
      return;
    }
    if (remainingPercent >= 8 && wasEmpty(provider)) {
      setWasEmpty(provider, false);
      popAnimation(originEl, soundEnabled, { a: colors?.a || '#27ae60', b: colors?.b || '#fff' }, 200);
    }
  }

  global.ZeroGrokCanFx = {
    playCanPopSound, spawnFizz, playFirstUse, trackRefill, markFirstPop, hasPlayedFirstPop,
    setWasEmpty, popAnimation, reducedMotion
  };
})(typeof window !== 'undefined' ? window : self);

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

  function wasEmpty(provider) {
    try {
      return localStorage.getItem(storageKey(provider, 'WasEmpty')) === '1';
    } catch (_) {
      return false;
    }
  }

  function setWasEmpty(provider, empty) {
    try {
      if (empty) localStorage.setItem(storageKey(provider, 'WasEmpty'), '1');
      else localStorage.removeItem(storageKey(provider, 'WasEmpty'));
    } catch (_) {}
  }

  function synthesizePop() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
      const bufferSize = ctx.sampleRate * 0.12;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.3, t0);
      ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      noise.connect(ng); ng.connect(ctx.destination);
      noise.start(t0);
    } catch (_) {}
  }

  function playCanPopSound(soundEnabled) {
    if (soundEnabled === false) return;
    try {
      const url = chrome.runtime.getURL('assets/sounds/can-pop.wav');
      const audio = new Audio(url);
      audio.volume = 0.55;
      audio.play().catch(() => synthesizePop());
    } catch (_) {
      synthesizePop();
    }
  }

  function spawnFizz(originEl, a, b) {
    if (!originEl) return;
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

  function shouldPlayFirstUse(provider) {
    return !hasPlayedFirstPop(provider);
  }

  function playFirstUse(originEl, provider, soundEnabled, colors) {
    if (!shouldPlayFirstUse(provider)) return;
    markFirstPop(provider);
    if (originEl) originEl.classList.add('zg-pop-in');
    setTimeout(() => {
      playCanPopSound(soundEnabled);
      spawnFizz(originEl, colors?.a, colors?.b);
    }, 280);
    setTimeout(() => originEl?.classList.remove('zg-pop-in'), 800);
  }

  function trackRefill(provider, remainingPercent, originEl, soundEnabled, colors) {
    if (remainingPercent == null || !Number.isFinite(remainingPercent)) return;

    if (remainingPercent <= 2) {
      setWasEmpty(provider, true);
      return;
    }

    if (remainingPercent >= 8 && wasEmpty(provider)) {
      setWasEmpty(provider, false);
      if (originEl) originEl.classList.add('zg-pop-in');
      setTimeout(() => {
        playCanPopSound(soundEnabled);
        spawnFizz(originEl, colors?.a || '#27ae60', colors?.b || '#fff');
      }, 200);
      setTimeout(() => originEl?.classList.remove('zg-pop-in'), 800);
    }
  }

  function resolveResetMs(data) {
    if (!data) return null;
    if (data.resetAt) {
      const t = new Date(data.resetAt).getTime();
      if (Number.isFinite(t) && t > Date.now() - 60000) return t;
    }
    const hint = String(data.resetHint || data.windowHint || '');
    const rel = hint.match(/(\d+)\s*h(?:\s*(\d+)\s*m)?/i);
    if (rel) {
      const h = parseInt(rel[1], 10) || 0;
      const m = parseInt(rel[2], 10) || 0;
      return Date.now() + (h * 3600 + m * 60) * 1000;
    }
    return null;
  }

  function formatRefillIn(ms) {
    if (ms == null || !Number.isFinite(ms)) return '';
    const left = Math.max(0, ms - Date.now());
    const totalMin = Math.floor(left / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `Refilling in ${h}h ${m}m`;
    if (m > 0) return `Refilling in ${m}m`;
    return 'Refilling soon';
  }

  function formatRefillShort(ms) {
    if (ms == null || !Number.isFinite(ms)) return '';
    const left = Math.max(0, ms - Date.now());
    const totalMin = Math.floor(left / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  const _tickers = new Map();

  function startLimitCountdown(opts) {
    const { provider, canEl, resetMs, soundEnabled } = opts || {};
    if (!provider || !canEl || !resetMs) return;
    stopLimitCountdown(provider);
    const tick = () => {
      const left = resetMs - Date.now();
      if (left <= 0) {
        stopLimitCountdown(provider);
        canEl.classList.remove('zg-at-limit');
        return;
      }
      canEl.classList.add('zg-at-limit');
      const pct = canEl.querySelector('#zg-percent');
      if (pct) pct.textContent = formatRefillShort(resetMs);
    };
    tick();
    const id = setInterval(tick, 30000);
    _tickers.set(provider, { id, resetMs });
  }

  function stopLimitCountdown(provider) {
    const entry = _tickers.get(provider);
    if (entry) {
      clearInterval(entry.id);
      _tickers.delete(provider);
    }
  }

  function findCanElements() {
    const nodes = document.querySelectorAll('.zg-can-root, [id^="zero-grok-can"]');
    return Array.from(nodes);
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TOGGLE_CAN') {
        const cans = findCanElements();
        for (const canEl of cans) {
          const hidden = canEl.style.display === 'none' || canEl.classList.contains('zg-user-hidden');
          if (hidden) {
            canEl.style.display = 'flex';
            canEl.classList.remove('zg-user-hidden');
          } else {
            canEl.classList.add('zg-user-hidden');
            canEl.style.display = 'none';
          }
        }
      }
      if (msg.type === 'REFILL_POP') {
        const cans = findCanElements();
        if (cans.length && global.ZeroGrokCanFx) {
          try { localStorage.setItem('zeroGrokWasEmpty_grok', '1'); } catch(_){}
          try { localStorage.setItem('zeroGrokWasEmpty_claude', '1'); } catch(_){}
          try { localStorage.setItem('zeroGrokWasEmpty_chatgpt', '1'); } catch(_){}
          try { localStorage.setItem('zeroGrokWasEmpty_gemini', '1'); } catch(_){}
          playCanPopSound(true);
          for (const canEl of cans) {
            spawnFizz(canEl, '#27ae60', '#fff');
            canEl.classList.add('zg-pop-in');
            setTimeout(() => canEl.classList.remove('zg-pop-in'), 800);
          }
        }
      }
    });
  } catch (_) {}

  global.ZeroGrokCanFx = {
    playCanPopSound,
    spawnFizz,
    shouldPlayFirstUse,
    playFirstUse,
    trackRefill,
    markFirstPop,
    hasPlayedFirstPop,
    resolveResetMs,
    formatRefillIn,
    formatRefillShort,
    startLimitCountdown,
    stopLimitCountdown
  };
})(typeof window !== 'undefined' ? window : self);

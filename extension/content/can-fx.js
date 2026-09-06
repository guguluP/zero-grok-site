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
      o1.connect(g1);
      g1.connect(ctx.destination);
      o1.start(t0);
      o1.stop(t0 + 0.25);

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
      noise.connect(ng);
      ng.connect(ctx.destination);
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

  function spawnFizz(originEl, colorA, colorB) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height * 0.3;
    const a = colorA || '#c41e3a';
    const b = colorB || 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'zg-fizz-particle';
      const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.3;
      const dist = 28 + Math.random() * 36;
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
    const rel =
      hint.match(/(?:in|after|~)?\s*(\d+)\s*d(?:ays?)?\s*(?:(\d+)\s*h(?:ours?)?)?/i) ||
      hint.match(/(?:in|after|~)?\s*(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i) ||
      hint.match(/(?:in|after|~)?\s*(\d+)\s*m(?:in(?:utes?)?)?\b/i);
    if (rel) {
      let ms = 0;
      if (/d/i.test(hint) && rel[1] && !/h/i.test(rel[0].slice(0, 3))) {
        ms += parseInt(rel[1], 10) * 86400000;
        if (rel[2]) ms += parseInt(rel[2], 10) * 3600000;
      } else if (/h/i.test(rel[0]) || (rel[2] != null && /m/i.test(hint))) {
        ms += parseInt(rel[1], 10) * 3600000;
        if (rel[2]) ms += parseInt(rel[2], 10) * 60000;
      } else {
        ms += parseInt(rel[1], 10) * 60000;
      }
      if (ms > 0) return Date.now() + ms;
    }
    const sec = Number(data.reset_after_seconds ?? data.resetAfterSeconds);
    if (Number.isFinite(sec) && sec > 0) return Date.now() + sec * 1000;
    return null;
  }

  function formatRefillIn(msOrData) {
    let target = typeof msOrData === 'number' ? msOrData : resolveResetMs(msOrData);
    if (!target || !Number.isFinite(target)) return null;
    let diff = target - Date.now();
    if (diff <= 0) return 'Refilling now…';
    const days = Math.floor(diff / 86400000);
    diff %= 86400000;
    const hours = Math.floor(diff / 3600000);
    diff %= 3600000;
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    if (days > 0) return `Refilling in ${days}d ${hours}h`;
    if (hours > 0) return `Refilling in ${hours}h ${mins}m`;
    if (mins > 0) return `Refilling in ${mins}m`;
    return `Refilling in ${secs}s`;
  }

  function formatRefillShort(msOrData) {
    let target = typeof msOrData === 'number' ? msOrData : resolveResetMs(msOrData);
    if (!target || !Number.isFinite(target)) return '0%';
    let diff = target - Date.now();
    if (diff <= 0) return 'soon';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours >= 24) return `${Math.floor(hours / 24)}d`;
    if (hours > 0) return `${hours}h${mins > 0 ? mins + 'm' : ''}`;
    if (mins > 0) return `${mins}m`;
    return `${Math.floor(diff / 1000)}s`;
  }

  const _tickers = new Map();

  function startLimitCountdown(opts) {
    const { provider, data, canEl, panelResetEl, onRefilled } = opts || {};
    if (!provider || !canEl) return;

    stopLimitCountdown(provider);

    const rem = data?.remainingPercent;
    if (rem == null || !Number.isFinite(rem) || rem > 2) {
      return;
    }

    const target = resolveResetMs(data);
    const percentEl = canEl.querySelector('#zg-percent');

    function tick() {
      const short = target ? formatRefillShort(target) : '0%';
      const long = target ? formatRefillIn(target) : (data.resetHint || 'Limit reached — waiting for refill');

      if (percentEl) {
        percentEl.textContent = target ? short : '0%';
        percentEl.className = 'zg-percent zg-critical zg-refill';
        percentEl.title = long || 'At limit';
      }
      canEl.classList.add('zg-at-limit');
      if (panelResetEl) {
        panelResetEl.textContent = long;
        panelResetEl.classList.add('zg-refill-line');
      }

      if (target && Date.now() >= target) {
        stopLimitCountdown(provider);
        if (percentEl) {
          percentEl.textContent = '…';
          percentEl.className = 'zg-percent';
        }
        canEl.classList.remove('zg-at-limit');
        if (typeof onRefilled === 'function') {
          try { onRefilled(); } catch (_) {}
        }
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    _tickers.set(provider, { id, target });
  }

  function stopLimitCountdown(provider) {
    const entry = _tickers.get(provider);
    if (entry) {
      clearInterval(entry.id);
      _tickers.delete(provider);
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'TOGGLE_CAN') {
        const canEl = document.getElementById('zero-grok-can');
        if (!canEl) return;
        const hidden = canEl.style.display === 'none' || canEl.classList.contains('zg-user-hidden');
        if (hidden) {
          canEl.style.display = 'flex';
          canEl.classList.remove('zg-user-hidden');
        } else {
          canEl.classList.add('zg-user-hidden');
          canEl.style.display = 'none';
        }
      }
      if (msg.type === 'REFILL_POP') {
        const canEl = document.getElementById('zero-grok-can');
        if (canEl && global.ZeroGrokCanFx) {
          try { localStorage.setItem('zeroGrokWasEmpty_grok', '1'); } catch(_){}
          try { localStorage.setItem('zeroGrokWasEmpty_claude', '1'); } catch(_){}
          try { localStorage.setItem('zeroGrokWasEmpty_chatgpt', '1'); } catch(_){}
          try { localStorage.setItem('zeroGrokWasEmpty_gemini', '1'); } catch(_){}
          playCanPopSound(true);
          spawnFizz(canEl, '#27ae60', '#fff');
          canEl.classList.add('zg-pop-in');
          setTimeout(() => canEl.classList.remove('zg-pop-in'), 800);
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

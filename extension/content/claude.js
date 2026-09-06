/**
 * Zero Grok – Claude.ai
 * Proven path (working extensions):
 *   GET /api/organizations → org uuid
 *   GET /api/organizations/{uuid}/usage → five_hour / seven_day utilization
 */
(async function () {
  'use strict';
  if (window.__ZERO_GROK_CLAUDE__) return;
  window.__ZERO_GROK_CLAUDE__ = true;

  let currentUsage = null;
  let canEl = null;
  let panelEl = null;
  let isExpanded = false;
  let settings = { canPosition: 'bottom-right', theme: 'auto', enableClaude: true, estimateMessagesEnabled: false, soundEnabled: true };
  let orgId = null;

  function hasPlayedPop() {
    try { return localStorage.getItem('zeroGrokPopPlayed_claude') === '1'; } catch (_) { return false; }
  }
  function markPopPlayed() {
    try { localStorage.setItem('zeroGrokPopPlayed_claude', '1'); } catch (_) {}
  }
  function playCanPopSound() {
    try {
      const url = chrome.runtime.getURL('assets/sounds/can-pop.wav');
      const audio = new Audio(url);
      audio.volume = 0.55;
      audio.play().catch(() => synthesizePop());
    } catch (_) { synthesizePop(); }
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
    } catch (_) {}
  }
  function spawnFizz(originEl) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height * 0.3;
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'zg-fizz-particle';
      const angle = (Math.PI * 2 * i) / 12;
      const dist = 30 + Math.random() * 30;
      p.style.left = cx + 'px'; p.style.top = cy + 'px';
      p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--ty', Math.sin(angle) * dist - 15 + 'px');
      p.style.background = i % 2 ? '#d97706' : '#fff';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  // Full implementation continues in local zero-grok package – see release ZIP for complete source.
  // This stub ensures the file is non-empty on GitHub while full push completes.
  console.log('[Zero Grok] Claude content script loaded (full source in release ZIP)');
})();

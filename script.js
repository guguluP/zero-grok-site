const DOWNLOAD_URL = 'downloads/zero-grok.zip';
const installButtons = [document.getElementById('installBtn'), document.getElementById('downloadBtn')];
installButtons.forEach(btn => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.href = DOWNLOAD_URL;
    btn.setAttribute('download', 'zero-grok.zip');
  });
});

const liquid = document.getElementById('canLiquid');
const percent = document.getElementById('heroPercent');
const countdown = document.getElementById('countdown');
let remaining = 64;
let seconds = 2 * 3600 + 18 * 60;

function tick() {
  remaining -= 0.035;
  if (remaining < 8) {
    remaining = 92;
    seconds = 2 * 3600 + 18 * 60;
  }
  const pct = Math.round(remaining);
  if (liquid) liquid.style.height = pct + '%';
  if (percent) percent.textContent = pct + '%';
  seconds = Math.max(0, seconds - 1);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (countdown) countdown.textContent = `${h}h ${String(m).padStart(2, '0')}m`;
}
setInterval(tick, 1000);

const heroCan = document.getElementById('heroCan');
const popBurst = document.getElementById('popBurst');
let audioCtx = null;
let popBuffer = null;

async function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch (_) {}
  }
  if (!popBuffer) {
    try {
      const res = await fetch('assets/can-pop.wav');
      const arr = await res.arrayBuffer();
      popBuffer = await audioCtx.decodeAudioData(arr);
    } catch (err) {
      console.warn('Web Audio load failed', err);
    }
  }
}

function playPopSound() {
  if (popBuffer && audioCtx) {
    try {
      const src = audioCtx.createBufferSource();
      src.buffer = popBuffer;
      const gain = audioCtx.createGain();
      gain.gain.value = 0.55;
      src.connect(gain);
      gain.connect(audioCtx.destination);
      src.start(0);
      return;
    } catch (_) {}
  }
  const a = new Audio('assets/can-pop.wav');
  a.volume = 0.5;
  a.play().catch(() => {});
}

function makeParticles() {
  if (!popBurst) return;
  popBurst.replaceChildren();
  for (let i = 0; i < 8; i++) popBurst.appendChild(document.createElement('i'));
  popBurst.classList.remove('active');
  void popBurst.offsetWidth;
  popBurst.classList.add('active');
}

function popCan() {
  if (!heroCan) return;
  heroCan.classList.remove('pop');
  void heroCan.offsetWidth;
  heroCan.classList.add('pop');
  makeParticles();
  playPopSound();
  if (navigator.vibrate) {
    try { navigator.vibrate(12); } catch (_) {}
  }
}

function unlockOnGesture() {
  ensureAudio();
  document.removeEventListener('pointerdown', unlockOnGesture);
  document.removeEventListener('keydown', unlockOnGesture);
}
document.addEventListener('pointerdown', unlockOnGesture, { once: true, passive: true });
document.addEventListener('keydown', unlockOnGesture, { once: true });

heroCan?.addEventListener('pointerdown', () => ensureAudio(), { passive: true });
heroCan?.addEventListener('click', popCan);
heroCan?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    popCan();
  }
});

heroCan?.addEventListener('pointermove', (event) => {
  if (heroCan.classList.contains('pop')) return;
  const r = heroCan.getBoundingClientRect();
  const x = (event.clientX - r.left) / r.width - 0.5;
  const y = (event.clientY - r.top) / r.height - 0.5;
  heroCan.style.transform = `perspective(700px) rotateY(${x * 6}deg) rotateX(${y * -5}deg)`;
});
heroCan?.addEventListener('pointerleave', () => {
  if (!heroCan.classList.contains('pop')) heroCan.style.transform = '';
});
heroCan?.addEventListener('animationend', (event) => {
  if (event.animationName === 'canPop') {
    heroCan.classList.remove('pop');
    heroCan.style.transform = '';
  }
});

const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) e.target.classList.add('in');
  }),
  { threshold: 0.12 }
);
document.querySelectorAll('.problem-card,.feature-card,.popup-mock,.privacy-copy,.cta-can,.install-steps article').forEach((el) => io.observe(el));

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

function getAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playPopSound() {
  const ctx = getAudio();
  const now = ctx.currentTime;

  const duration = 0.28;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const t = i / bufferSize;
    const env = Math.exp(-t * 18) * (1 - t * 0.4);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1800;
  noiseFilter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.55, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + duration);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(920, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + 0.22);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.22, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  const oscFilter = ctx.createBiquadFilter();
  oscFilter.type = 'lowpass';
  oscFilter.frequency.value = 2400;
  osc.connect(oscFilter);
  oscFilter.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.26);

  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(95, now);
  thump.frequency.exponentialRampToValueAtTime(40, now + 0.12);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.35, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  thump.connect(thumpGain);
  thumpGain.connect(ctx.destination);
  thump.start(now);
  thump.stop(now + 0.15);
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
  try { playPopSound(); } catch (_) {}
  if (navigator.vibrate) {
    try { navigator.vibrate(14); } catch (_) {}
  }
}

function unlockOnGesture() {
  getAudio();
  document.removeEventListener('pointerdown', unlockOnGesture);
  document.removeEventListener('keydown', unlockOnGesture);
}
document.addEventListener('pointerdown', unlockOnGesture, { once: true, passive: true });
document.addEventListener('keydown', unlockOnGesture, { once: true });

heroCan?.addEventListener('pointerdown', () => getAudio(), { passive: true });
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
  heroCan.style.transform = `perspective(700px) rotateY(${x * 7}deg) rotateX(${y * -5}deg)`;
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
document
  .querySelectorAll('.problem-card,.feature-card,.popup-mock,.privacy-copy,.cta-can,.install-steps article')
  .forEach((el) => io.observe(el));

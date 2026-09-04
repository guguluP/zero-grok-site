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
const can3d = document.getElementById('can3d');
const popBurst = document.getElementById('popBurst');
let audioCtx = null;
let hasPlayedOpenPop = false;
const baseTilt = 'rotateX(8deg) rotateY(-18deg)';

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
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

function makeParticles() {
  if (!popBurst) return;
  popBurst.replaceChildren();
  for (let i = 0; i < 8; i++) popBurst.appendChild(document.createElement('i'));
  popBurst.classList.remove('active');
  void popBurst.offsetWidth;
  popBurst.classList.add('active');
}

function popCan(fromAuto) {
  if (!heroCan) return;
  heroCan.classList.remove('pop');
  void heroCan.offsetWidth;
  heroCan.classList.add('pop');
  makeParticles();
  try { playPopSound(); } catch (_) {}
  if (!fromAuto && navigator.vibrate) {
    try { navigator.vibrate(14); } catch (_) {}
  }
  hasPlayedOpenPop = true;
}

function tryFirstOpenPop() {
  if (hasPlayedOpenPop) return;
  getAudio();
  setTimeout(() => {
    if (hasPlayedOpenPop) return;
    popCan(true);
  }, 280);
}

function unlockAndMaybeOpen(e) {
  getAudio();
  const onCan = heroCan && (e.target === heroCan || heroCan.contains(e.target));
  if (!onCan) tryFirstOpenPop();
  document.removeEventListener('pointerdown', unlockAndMaybeOpen);
  document.removeEventListener('keydown', unlockAndMaybeOpen);
}
document.addEventListener('pointerdown', unlockAndMaybeOpen, { passive: true });
document.addEventListener('keydown', unlockAndMaybeOpen);

heroCan?.addEventListener('pointerdown', () => getAudio(), { passive: true });
heroCan?.addEventListener('click', () => popCan(false));
heroCan?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); popCan(false); }
});

heroCan?.addEventListener('pointermove', (event) => {
  if (!can3d || heroCan.classList.contains('pop')) return;
  const r = heroCan.getBoundingClientRect();
  const x = (event.clientX - r.left) / r.width - 0.5;
  const y = (event.clientY - r.top) / r.height - 0.5;
  const rotY = -18 + x * 28;
  const rotX = 8 + y * -16;
  can3d.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
});
heroCan?.addEventListener('pointerleave', () => {
  if (can3d && !heroCan.classList.contains('pop')) {
    can3d.style.transform = baseTilt;
  }
});
heroCan?.addEventListener('animationend', (event) => {
  if (event.animationName === 'canPop3d' || event.animationName === 'canPop') {
    heroCan.classList.remove('pop');
    if (can3d) can3d.style.transform = baseTilt;
  }
});

const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); }),
  { threshold: 0.12 }
);
document.querySelectorAll('.problem-card,.feature-card,.popup-mock,.privacy-copy,.cta-can,.install-steps article')
  .forEach((el) => io.observe(el));

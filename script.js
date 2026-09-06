/* Zero Grok landing — dietclaude-inspired crack-open flow */

const DOWNLOAD_URL =
  "https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip";

const hero = document.getElementById("hero");
const heroCan = document.getElementById("heroCan");
const can3d = document.getElementById("can3d");
const popBurst = document.getElementById("popBurst");
const liquid = document.getElementById("canLiquid");
const percentEl = document.getElementById("heroPercent");
const countdownEl = document.getElementById("countdown");
const ctaSlot = document.getElementById("ctaSlot");
const meterChip = document.getElementById("meterChip");
const replayBtn = document.getElementById("replayBtn");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let phase = "idle"; // idle | cracking | done
let audioCtx = null;
let remaining = 64;
let seconds = 2 * 3600 + 18 * 60;
const baseTilt = "rotateX(8deg) rotateY(-16deg)";

/* Download links */
document.querySelectorAll("#installBtn, #downloadBtn, #ghostCta, a[href*='zero-grok.zip']").forEach((a) => {
  if (a) a.href = DOWNLOAD_URL;
});

function setPhase(next) {
  phase = next;
  if (hero) hero.dataset.phase = next;
}

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

function playPopSound() {
  const ctx = getAudio();
  const now = ctx.currentTime;

  // metallic tick
  const tick = ctx.createOscillator();
  tick.type = "square";
  tick.frequency.setValueAtTime(2400, now);
  tick.frequency.exponentialRampToValueAtTime(900, now + 0.03);
  const tickG = ctx.createGain();
  tickG.gain.setValueAtTime(0.12, now);
  tickG.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  const tickF = ctx.createBiquadFilter();
  tickF.type = "highpass";
  tickF.frequency.value = 1200;
  tick.connect(tickF);
  tickF.connect(tickG);
  tickG.connect(ctx.destination);
  tick.start(now);
  tick.stop(now + 0.05);

  // pressure hiss
  const duration = 0.24;
  const n = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 14) * (1 - t * 0.35);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.value = 1600;
  nf.Q.value = 0.6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.48, now + 0.01);
  ng.gain.exponentialRampToValueAtTime(0.001, now + duration);
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(ctx.destination);
  noise.start(now + 0.01);
  noise.stop(now + duration);

  // low pop
  const thump = ctx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(110, now + 0.02);
  thump.frequency.exponentialRampToValueAtTime(38, now + 0.14);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.34, now + 0.02);
  tg.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  thump.connect(tg);
  tg.connect(ctx.destination);
  thump.start(now + 0.02);
  thump.stop(now + 0.17);

  // body
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(720, now + 0.02);
  osc.frequency.exponentialRampToValueAtTime(160, now + 0.2);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.16, now + 0.02);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  osc.connect(og);
  og.connect(ctx.destination);
  osc.start(now + 0.02);
  osc.stop(now + 0.24);

  // bubbles
  for (let b = 0; b < 3; b++) {
    const t0 = now + 0.12 + b * 0.04;
    const bub = ctx.createOscillator();
    bub.type = "sine";
    bub.frequency.setValueAtTime(900 + b * 220, t0);
    bub.frequency.exponentialRampToValueAtTime(400 + b * 80, t0 + 0.06);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.04, t0);
    bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    bub.connect(bg);
    bg.connect(ctx.destination);
    bub.start(t0);
    bub.stop(t0 + 0.08);
  }
}

function makeParticles() {
  if (!popBurst || reduceMotion) return;
  popBurst.replaceChildren();
  for (let i = 0; i < 8; i++) popBurst.appendChild(document.createElement("i"));
  popBurst.classList.remove("active");
  void popBurst.offsetWidth;
  popBurst.classList.add("active");
}

function crackOpen() {
  if (phase !== "idle") return;
  setPhase("cracking");
  getAudio();

  if (heroCan) {
    heroCan.classList.remove("pop");
    void heroCan.offsetWidth;
    heroCan.classList.add("pop");
  }
  makeParticles();
  try {
    playPopSound();
  } catch (_) {}
  if (navigator.vibrate) {
    try {
      navigator.vibrate(16);
    } catch (_) {}
  }

  // drain a little on open
  remaining = Math.max(8, remaining - 3);
  if (liquid) liquid.style.height = remaining + "%";
  if (percentEl) percentEl.textContent = Math.round(remaining) + "%";

  window.setTimeout(() => {
    setPhase("done");
    if (ctaSlot) ctaSlot.hidden = false;
    if (meterChip) meterChip.hidden = false;
  }, reduceMotion ? 80 : 520);
}

function replay() {
  setPhase("idle");
  if (ctaSlot) ctaSlot.hidden = true;
  if (meterChip) meterChip.hidden = true;
  if (heroCan) heroCan.classList.remove("pop");
  if (can3d) can3d.style.transform = baseTilt;
  remaining = 64;
  seconds = 2 * 3600 + 18 * 60;
  if (liquid) liquid.style.height = "64%";
  if (percentEl) percentEl.textContent = "64%";
  if (countdownEl) countdownEl.textContent = "2h 18m";
}

function onHeroActivate(e) {
  // Don't steal clicks from real links/buttons inside done phase
  if (phase === "done") {
    const t = e.target;
    if (t.closest && (t.closest("a") || t.closest("button"))) return;
    return;
  }
  if (phase === "idle") crackOpen();
}

hero?.addEventListener("click", onHeroActivate);
hero?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onHeroActivate(e);
  }
});
heroCan?.addEventListener("pointerdown", () => getAudio(), { passive: true });
heroCan?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (phase === "idle") crackOpen();
});

replayBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  replay();
});

/* Tilt while idle */
if (!reduceMotion) {
  heroCan?.addEventListener("pointermove", (event) => {
    if (!can3d || phase === "cracking" || heroCan.classList.contains("pop")) return;
    const r = heroCan.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width - 0.5;
    const y = (event.clientY - r.top) / r.height - 0.5;
    can3d.style.transform = `rotateX(${8 + y * -14}deg) rotateY(${-16 + x * 26}deg)`;
  });
  heroCan?.addEventListener("pointerleave", () => {
    if (can3d && !heroCan.classList.contains("pop")) can3d.style.transform = baseTilt;
  });
}

heroCan?.addEventListener("animationend", (event) => {
  if (event.animationName === "canPop3d") {
    heroCan.classList.remove("pop");
    if (can3d) can3d.style.transform = baseTilt;
  }
});

/* Demo meter tick after open */
setInterval(() => {
  if (phase !== "done") return;
  remaining -= 0.015;
  if (remaining < 8) remaining = 72;
  const pct = Math.round(remaining);
  if (liquid) liquid.style.height = pct + "%";
  if (percentEl) percentEl.textContent = pct + "%";
  seconds = Math.max(0, seconds - 1);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (countdownEl) countdownEl.textContent = `${h}h ${String(m).padStart(2, "0")}m`;
}, 1000);

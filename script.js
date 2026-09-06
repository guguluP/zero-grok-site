/* Zero Grok landing — download, can, audio, demo, nav */

const DOWNLOAD_URL =
  "https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip";

/* ---------- Download ---------- */
(function setupDownload() {
  const buttons = [
    document.getElementById("installBtn"),
    document.getElementById("downloadBtn"),
    ...document.querySelectorAll('a[href*="downloads/zero-grok.zip"]'),
  ];
  buttons.forEach((btn) => {
    if (!btn) return;
    btn.href = DOWNLOAD_URL;
  });
})();

/* ---------- Mobile nav ---------- */
(function setupNav() {
  const nav = document.querySelector(".nav");
  const menuBtn = document.getElementById("menuBtn");
  const links = document.getElementById("navLinks");
  if (!nav || !menuBtn) return;

  menuBtn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });

  links?.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      nav.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
      menuBtn.setAttribute("aria-label", "Open menu");
    });
  });

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();

/* ---------- Demo data ---------- */
const PROVIDERS = {
  grok: { name: "Grok", pct: 64, refill: "2h 18m", color: "#e31837" },
  claude: { name: "Claude", pct: 82, refill: "4h 02m", color: "#d97706" },
  chatgpt: { name: "ChatGPT", pct: 47, refill: "1h 40m", color: "#10a37f" },
  gemini: { name: "Gemini", pct: 91, refill: "5h 12m", color: "#4285f4" },
};

let activeProvider = "grok";
let remaining = PROVIDERS.grok.pct;
let seconds = 2 * 3600 + 18 * 60;

const liquid = document.getElementById("canLiquid");
const percentEl = document.getElementById("heroPercent");
const countdownEl = document.getElementById("countdown");

function setDemoProvider(key) {
  const p = PROVIDERS[key];
  if (!p) return;
  activeProvider = key;
  remaining = p.pct;
  const parts = p.refill.match(/(\d+)h\s*(\d+)m/);
  if (parts) seconds = Number(parts[1]) * 3600 + Number(parts[2]) * 60;

  if (liquid) liquid.style.height = p.pct + "%";
  if (percentEl) percentEl.textContent = p.pct + "%";
  if (countdownEl) countdownEl.textContent = p.refill;

  document.querySelectorAll(".provider-row").forEach((row) => {
    row.classList.toggle("active", row.dataset.provider === key);
  });
  document.querySelectorAll(".provider-tabs .tab").forEach((tab) => {
    const on = tab.dataset.tab === key;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });

  const pdName = document.getElementById("pdName");
  const pdPct = document.getElementById("pdPct");
  const pdBar = document.getElementById("pdBar");
  const pdRemain = document.getElementById("pdRemain");
  const pdRefill = document.getElementById("pdRefill");
  if (pdName) pdName.textContent = p.name;
  if (pdPct) pdPct.textContent = p.pct + "%";
  if (pdBar) {
    pdBar.style.width = p.pct + "%";
    pdBar.style.background = `linear-gradient(90deg, ${p.color}, ${p.color}cc)`;
  }
  if (pdRemain) pdRemain.textContent = p.pct + "%";
  if (pdRefill) pdRefill.textContent = p.refill;
}

document.querySelectorAll(".provider-row").forEach((row) => {
  row.addEventListener("click", () => setDemoProvider(row.dataset.provider));
});
document.querySelectorAll(".provider-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => setDemoProvider(tab.dataset.tab));
});

/* Simulated drain for the active demo (clearly labeled as demo) */
function tickDemo() {
  remaining -= 0.02;
  if (remaining < 8) {
    remaining = PROVIDERS[activeProvider].pct;
    const p = PROVIDERS[activeProvider];
    const parts = p.refill.match(/(\d+)h\s*(\d+)m/);
    if (parts) seconds = Number(parts[1]) * 3600 + Number(parts[2]) * 60;
  }
  const pct = Math.round(remaining);
  if (liquid) liquid.style.height = pct + "%";
  if (percentEl) percentEl.textContent = pct + "%";
  seconds = Math.max(0, seconds - 1);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (countdownEl) countdownEl.textContent = `${h}h ${String(m).padStart(2, "0")}m`;
}
setInterval(tickDemo, 1000);

/* ---------- Audio + can interaction ---------- */
const heroCan = document.getElementById("heroCan");
const can3d = document.getElementById("can3d");
const popBurst = document.getElementById("popBurst");
const soundToggle = document.getElementById("soundToggle");
let audioCtx = null;
let soundOn = true;
const baseTilt = "rotateX(8deg) rotateY(-18deg)";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

try {
  const stored = localStorage.getItem("zg-sound");
  if (stored === "off") soundOn = false;
} catch (_) {}

function updateSoundUi() {
  if (!soundToggle) return;
  soundToggle.textContent = soundOn ? "Sound on" : "Sound off";
  soundToggle.setAttribute("aria-pressed", soundOn ? "true" : "false");
}
updateSoundUi();

soundToggle?.addEventListener("click", (e) => {
  e.stopPropagation();
  soundOn = !soundOn;
  try {
    localStorage.setItem("zg-sound", soundOn ? "on" : "off");
  } catch (_) {}
  updateSoundUi();
  if (soundOn) getAudio();
});

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

/** Three-layer pop: metallic tick + pressure release + low pop + tiny bubble tail */
function playPopSound() {
  if (!soundOn) return;
  const ctx = getAudio();
  const now = ctx.currentTime;

  // Layer 1 — metallic tick
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

  // Layer 2 — pressure release (noise band)
  const duration = 0.22;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const t = i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 14) * (1 - t * 0.35);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass";
  nf.frequency.value = 1600;
  nf.Q.value = 0.6;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.45, now + 0.01);
  ng.gain.exponentialRampToValueAtTime(0.001, now + duration);
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(ctx.destination);
  noise.start(now + 0.01);
  noise.stop(now + duration);

  // Layer 3 — low pop / thump
  const thump = ctx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(110, now + 0.02);
  thump.frequency.exponentialRampToValueAtTime(38, now + 0.14);
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.32, now + 0.02);
  tg.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  thump.connect(tg);
  tg.connect(ctx.destination);
  thump.start(now + 0.02);
  thump.stop(now + 0.17);

  // Soft triangle body
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

  // Tiny bubble tail
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

function popCan() {
  if (!heroCan) return;
  heroCan.classList.remove("pop");
  void heroCan.offsetWidth;
  heroCan.classList.add("pop");
  makeParticles();
  try {
    playPopSound();
  } catch (_) {}
  if (navigator.vibrate) {
    try {
      navigator.vibrate(14);
    } catch (_) {}
  }
  // Tiny usage dip on pop to reinforce the product metaphor
  remaining = Math.max(1, remaining - 1);
  const pct = Math.round(remaining);
  if (liquid) liquid.style.height = pct + "%";
  if (percentEl) percentEl.textContent = pct + "%";
}

heroCan?.addEventListener("pointerdown", () => getAudio(), { passive: true });
heroCan?.addEventListener("click", () => popCan());
heroCan?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    popCan();
  }
});

if (!reduceMotion) {
  heroCan?.addEventListener("pointermove", (event) => {
    if (!can3d || heroCan.classList.contains("pop")) return;
    const r = heroCan.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width - 0.5;
    const y = (event.clientY - r.top) / r.height - 0.5;
    const rotY = -18 + x * 28;
    const rotX = 8 + y * -16;
    can3d.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  });
  heroCan?.addEventListener("pointerleave", () => {
    if (can3d && !heroCan.classList.contains("pop")) {
      can3d.style.transform = baseTilt;
    }
  });
}

heroCan?.addEventListener("animationend", (event) => {
  if (event.animationName === "canPop3d" || event.animationName === "canPop") {
    heroCan.classList.remove("pop");
    if (can3d) can3d.style.transform = baseTilt;
  }
});

/* ---------- Scroll reveals ---------- */
(function setupReveal() {
  if (reduceMotion) {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add("in");
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
})();

const DOWNLOAD_URL = 'https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip';
const installButtons = [document.getElementById('installBtn'), document.getElementById('downloadBtn')];
installButtons.forEach((btn) => {
  if (!btn) return;
  btn.href = DOWNLOAD_URL;
  btn.setAttribute('download', 'zero-grok.zip');
});
document.querySelectorAll('a[download="zero-grok.zip"]').forEach((a) => { a.href = DOWNLOAD_URL; });
(function () {
  const nav = document.querySelector('.nav');
  const menuBtn = document.querySelector('.menu-btn');
  if (menuBtn && nav) menuBtn.addEventListener('click', () => nav.classList.toggle('open'));
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const el = document.querySelector(id);
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); nav && nav.classList.remove('open'); }
    });
  });
})();

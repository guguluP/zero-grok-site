/**
 * Shareable usage card: drawn locally on a <canvas> and downloaded as PNG.
 * Nothing is uploaded anywhere.
 */
(function (g) {
  'use strict';
  const S = g.ZeroGrokShared;

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Small Zero Grok can watermark (same shapes as the on-page can, 64×128 units).
   * `level` (0-100 or null) sets how full it is.
   */
  function drawCan(ctx, x, y, scale, level, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const metal = ctx.createLinearGradient(10, 0, 54, 0);
    [[0, '#2c2c2c'], [0.28, '#c8c8c8'], [0.42, '#efefef'], [0.72, '#9a9a9a'], [1, '#1e1e1e']].forEach(([o, c]) => metal.addColorStop(o, c));
    ctx.fillStyle = '#3a3a3a';
    ctx.beginPath(); ctx.ellipse(32, 113, 20, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = metal;
    roundRect(ctx, 10, 16, 44, 96, 6); ctx.fill();
    const lvl = level == null ? 0 : Math.max(0, Math.min(100, level));
    const lh = (88 * lvl) / 100;
    if (lh > 0) {
      const liquid = ctx.createLinearGradient(0, 20, 0, 108);
      liquid.addColorStop(0, '#e63950'); liquid.addColorStop(1, '#8b0a1a');
      ctx.fillStyle = liquid;
      roundRect(ctx, 12, 108 - lh, 40, lh, 4); ctx.fill();
    }
    const band = ctx.createLinearGradient(0, 48, 0, 76);
    band.addColorStop(0, '#e31837'); band.addColorStop(0.5, '#c41e3a'); band.addColorStop(1, '#9b1020');
    ctx.fillStyle = band;
    ctx.fillRect(10, 48, 44, 28);
    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath(); ctx.ellipse(32, 16, 20, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e8e8';
    ctx.beginPath(); ctx.ellipse(32, 15, 14, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '900 9px Arial Black, Helvetica, sans-serif';
    ctx.fillText('ZERO', 32, 60);
    ctx.font = '700 9px Arial Black, Helvetica, sans-serif';
    ctx.fillText('GROK', 32, 71);
    ctx.restore();
  }

  /** rows: [{label, color, remaining (0-100|null), confidence}] */
  function draw(rows, opts) {
    const W = 1200, H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1a1a1a');
    bg.addColorStop(0.5, '#2d1f1f');
    bg.addColorStop(1, '#141414');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = '900 54px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText((opts && opts.title) || 'My AI usage today', 70, 110);
    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText((opts && opts.subtitle) || new Date().toLocaleString(), 70, 155);

    const shown = rows.slice(0, 6);
    const top = 205, rowH = Math.min(62, (H - top - 80) / Math.max(1, shown.length));
    shown.forEach((r, i) => {
      const y = top + i * rowH;
      ctx.fillStyle = r.color || '#888';
      ctx.beginPath();
      ctx.arc(84, y + 20, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 30px system-ui, sans-serif';
      ctx.fillText(r.label, 108, y + 31);
      const bx = 380, bw = 560, bh = 22;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, bx, y + 9, bw, bh, 11);
      ctx.fill();
      if (r.remaining != null) {
        ctx.fillStyle = r.color || '#27ae60';
        roundRect(ctx, bx, y + 9, Math.max(bh, (bw * r.remaining) / 100), bh, 11);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.font = '800 30px system-ui, sans-serif';
      const pct = r.remaining == null ? '—' : (r.confidence === 'estimate' ? '~' : '') + Math.round(r.remaining) + '% ' + ((opts && opts.leftWord) || 'left');
      ctx.fillText(pct, bx + bw + 24, y + 31);
    });

    // brand watermark, top-right; filled to the lowest remaining level shown
    const levels = shown.map((r) => r.remaining).filter((v) => v != null);
    drawCan(ctx, W - 70 - 64 * 1.15, 34, 1.15, levels.length ? Math.min(...levels) : 60, 0.55);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText((opts && opts.footer) || 'Zero Grok · data stays in my browser', 70, H - 40);
    return canvas;
  }

  function download(canvas, name) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name || 'zero-grok-usage.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); resolve(true); }, 500);
      }, 'image/png');
    });
  }

  function rowsFromUsage(usage, settings) {
    const by = (usage && usage.byProvider) || {};
    return S.PROVIDERS.filter((p) => settings[p.settingKey] !== false && (!p.optional || settings[p.settingKey]))
      .map((p) => ({ label: p.label, color: p.color, remaining: S.remainingOf(by[p.id]), confidence: by[p.id] ? S.confidenceOf(by[p.id].source) : null }))
      .filter((r) => r.remaining != null);
  }

  g.ZeroGrokShareCard = { draw, download, rowsFromUsage, drawCan };
})(globalThis);

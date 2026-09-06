/**
 * Zero Grok – Usage scraper
 * Primary: POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig
 * Fallback: other REST candidates + DOM scrape of Settings → Usage
 */

const PRODUCT_LABELS = {
  2: 'Grok Build',
  4: 'Chat',
  5: 'Imagine',
  6: 'Voice'
};

function emptyGrpcWebFrame() {
  return new Uint8Array([0, 0, 0, 0, 0]);
}

function readVarint(bytes, offset) {
  let result = 0, shift = 0, pos = offset;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, pos };
}

function readLengthDelimited(bytes, offset) {
  const { value: len, pos } = readVarint(bytes, offset);
  return { data: bytes.subarray(pos, pos + len), pos: pos + len };
}

function parseFloat32(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}

function parseCreditsConfig(bytes) {
  let data = bytes;
  if (bytes.length > 5 && bytes[0] === 0) {
    const len = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
    if (len > 0 && len + 5 <= bytes.length) {
      data = bytes.subarray(5, 5 + len);
    }
  }

  let usedPercent = null;
  let resetAt = null;
  const products = [];

  let pos = 0;
  while (pos < data.length) {
    const { value: tag, pos: p1 } = readVarint(data, pos);
    pos = p1;
    const field = tag >>> 3;
    const wire = tag & 0x7;

    if (wire === 2) {
      const { data: sub, pos: p2 } = readLengthDelimited(data, pos);
      pos = p2;
      if (field === 1) {
        const inner = parseInnerConfig(sub);
        if (inner.usedPercent != null) usedPercent = inner.usedPercent;
        if (inner.resetAt) resetAt = inner.resetAt;
        if (inner.products.length) products.push(...inner.products);
      }
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 0) {
      const r = readVarint(data, pos);
      pos = r.pos;
    } else {
      break;
    }
  }

  if (usedPercent == null) {
    const inner = parseInnerConfig(data);
    usedPercent = inner.usedPercent;
    resetAt = inner.resetAt || resetAt;
    if (inner.products.length) products.push(...inner.products);
  }

  if (usedPercent == null || !Number.isFinite(usedPercent)) return null;

  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    remainingPercent: Math.max(0, 100 - usedPercent),
    resetAt,
    products,
    source: 'grpc',
    isPaid: true
  };
}

function parseInnerConfig(data) {
  let usedPercent = null;
  let resetAt = null;
  const products = [];
  let pos = 0;

  while (pos < data.length) {
    const { value: tag, pos: p1 } = readVarint(data, pos);
    pos = p1;
    const field = tag >>> 3;
    const wire = tag & 0x7;

    if (wire === 5 && field === 1) {
      usedPercent = parseFloat32(data, pos);
      pos += 4;
    } else if (wire === 2) {
      const { data: sub, pos: p2 } = readLengthDelimited(data, pos);
      pos = p2;
      if (field === 7) {
        const prod = parseProduct(sub);
        if (prod) products.push(prod);
      } else if (field === 5 || field === 4) {
        try {
          const ts = readTimestamp(sub);
          if (ts) resetAt = ts;
        } catch (_) {}
      }
    } else if (wire === 0) {
      const r = readVarint(data, pos);
      pos = r.pos;
      if ((field === 5 || field === 4) && r.value > 1e9) {
        resetAt = r.value * 1000;
      }
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      break;
    }
  }
  return { usedPercent, resetAt, products };
}

function parseProduct(data) {
  let id = null;
  let percent = null;
  let pos = 0;
  while (pos < data.length) {
    const { value: tag, pos: p1 } = readVarint(data, pos);
    pos = p1;
    const field = tag >>> 3;
    const wire = tag & 0x7;
    if (wire === 0) {
      const r = readVarint(data, pos);
      pos = r.pos;
      if (field === 1) id = r.value;
    } else if (wire === 5) {
      const f = parseFloat32(data, pos);
      pos += 4;
      if (field === 2) percent = f;
    } else if (wire === 2) {
      const { pos: p2 } = readLengthDelimited(data, pos);
      pos = p2;
    } else {
      break;
    }
  }
  if (id != null && percent != null) {
    return { name: PRODUCT_LABELS[id] || `Product ${id}`, percent };
  }
  return null;
}

function readTimestamp(data) {
  if (data.length >= 1) {
    const { value } = readVarint(data, 0);
    if (value > 1e9 && value < 2e10) return value * 1000;
  }
  return null;
}

export async function fetchViaGrpc() {
  try {
    const res = await fetch('https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/grpc-web+proto',
        'x-grpc-web': '1',
        'accept': 'application/grpc-web+proto',
        'origin': 'https://grok.com',
        'referer': 'https://grok.com/'
      },
      body: emptyGrpcWebFrame()
    });

    if (!res.ok) {
      console.debug('[Zero Grok] gRPC status', res.status);
      return null;
    }

    const buf = await res.arrayBuffer();
    const parsed = parseCreditsConfig(new Uint8Array(buf));
    if (parsed) {
      console.log('[Zero Grok] gRPC success', parsed);
      return parsed;
    }
  } catch (e) {
    console.debug('[Zero Grok] gRPC error', e);
  }
  return null;
}

export async function fetchViaRest() {
  const candidates = [
    '/rest/subscriptions',
    '/rest/billing/usage',
    '/rest/usage',
    '/rest/user',
    '/rest/app-chat/usage'
  ];

  for (const path of candidates) {
    try {
      const res = await fetch(path, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) continue;
      const json = await res.json();
      const normalized = normalizeJson(json);
      if (normalized) {
        console.log('[Zero Grok] REST success via', path, normalized);
        return normalized;
      }
    } catch (_) {}
  }
  return null;
}

function normalizeJson(json) {
  if (!json || typeof json !== 'object') return null;

  let used = null;
  let resetAt = null;
  let products = [];

  const candidates = [
    json.creditUsagePercent,
    json.credit_usage_percent,
    json.usedPercent,
    json.used_percent,
    json.usagePercent,
    json.percent,
    json.usage?.percent,
    json.config?.creditUsagePercent,
    json.data?.creditUsagePercent
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && c >= 0 && c <= 100) {
      used = c;
      break;
    }
  }

  const resetCandidates = [
    json.resetAt, json.reset_at, json.periodEnd, json.period_end,
    json.currentPeriod?.end, json.config?.currentPeriod?.end,
    json.billingPeriodEnd
  ];
  for (const r of resetCandidates) {
    if (r) {
      const t = new Date(r).getTime();
      if (!isNaN(t)) {
        resetAt = t;
        break;
      }
    }
  }

  if (Array.isArray(json.products)) {
    products = json.products.map(p => ({
      name: p.name || p.displayName || p.label || 'Unknown',
      percent: p.percent ?? p.percentOfPool ?? p.usage ?? 0
    }));
  }

  if (used == null) return null;

  return {
    usedPercent: used,
    remainingPercent: Math.max(0, 100 - used),
    resetAt,
    products,
    source: 'rest',
    isPaid: true
  };
}

export function scrapeDom() {
  let used = null;

  document.querySelectorAll('[role="progressbar"]').forEach(el => {
    const v = parseFloat(el.getAttribute('aria-valuenow'));
    if (!isNaN(v) && v >= 0 && v <= 100 && used == null) used = v;
  });

  if (used == null) {
    document.querySelectorAll('[class*="progress"], [class*="usage"], [class*="bar"]').forEach(el => {
      const w = el.style?.width;
      if (w && w.endsWith('%')) {
        const v = parseFloat(w);
        if (!isNaN(v) && v >= 0 && v <= 100) used = v;
      }
    });
  }

  const text = document.body?.innerText || '';
  if (used == null) {
    const m = text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:used|of\s+(?:your\s+)?weekly|of\s+the\s+pool)/i);
    if (m) used = parseFloat(m[1]);
  }

  if (used == null) return null;

  const products = [];
  for (const [id, label] of Object.entries(PRODUCT_LABELS)) {
    const re = new RegExp(label + '\\s*[·:\\-–]?\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*%', 'i');
    const m = text.match(re);
    if (m) products.push({ name: label, percent: parseFloat(m[1]) });
  }

  return {
    usedPercent: used,
    remainingPercent: Math.max(0, 100 - used),
    resetAt: null,
    products,
    source: 'dom',
    isPaid: true
  };
}

export async function getUsage() {
  console.log('[Zero Grok] scraping usage…');

  let data = await fetchViaGrpc();
  if (data) return data;

  data = await fetchViaRest();
  if (data) return data;

  data = scrapeDom();
  if (data) {
    console.log('[Zero Grok] DOM fallback', data);
    return data;
  }

  console.warn('[Zero Grok] no usage data found. Open Settings → Usage once.');
  return null;
}

# Zero Grok site

Landing page + browser extension (local beta).

## Live

https://zero-grok-landing.vercel.app/

## Extension (v1.4.1)

Full source lives in [`extension/`](./extension/).

| Path | Purpose |
|------|---------|
| `extension/` | Load this folder unpacked in Chrome/Edge |
| `downloads/zero-grok.zip` | ZIP of the same tree (folder name `zero-grok` inside) |

### Load unpacked

1. Download [downloads/zero-grok.zip](./downloads/zero-grok.zip) (or clone and use `extension/`)
2. Unzip if needed
3. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked**
4. Select the `zero-grok` (or `extension`) folder

### Providers

Grok · Claude · ChatGPT · Gemini — local-only usage meter, refill countdown, multi-provider popup.

## Develop

Static HTML/CSS/JS landing (`index.html`, `styles.css`, `script.js`). Vercel deploys from this repo on push to `main`.

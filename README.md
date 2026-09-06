# Zero Grok

Landing + browser extension source for **Zero Grok** — know your AI limit before it hits zero.

**Live:** [zero-grok-landing.vercel.app](https://zero-grok-landing.vercel.app/)

## Extension

The full Chromium extension lives under [`extension/`](./extension/).

- Manifest V3, multi-provider (Grok · Claude · ChatGPT · Gemini)
- Floating can UI with bubbles, drag & save, refill countdown
- Popup overview, options, onboarding

### Install (local beta)

1. Download [`downloads/zero-grok.zip`](./downloads/zero-grok.zip) from the site, **or** clone this repo.
2. Unzip / open the folder that contains `manifest.json` (the `extension` folder if using the repo, or the root of the dedicated ZIP).
3. Chrome → `chrome://extensions` → Developer mode → **Load unpacked**.

## Repo layout

- `index.html` / `styles.css` / `script.js` — marketing landing
- `extension/` — browser extension source
- `downloads/zero-grok.zip` — packaged extension for one-click install (served by Vercel)

© 2026 Zero Grok

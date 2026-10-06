# Zero Grok

Diet Coke-style floating usage meter for **Grok**, **Claude**, **ChatGPT** and **Gemini**, plus optional **Perplexity**, **DeepSeek**, **Le Chat (Mistral)**, **Microsoft Copilot** and **Meta AI**.

A soda can in the corner of each AI site drains as you use your quota. It shows the % left, a countdown to the next reset, and where each number comes from (*Site usage API*, *Read from page* or *Estimate*). Everything stays in your browser.

## Download (always latest)

**ZIP (GitHub):** https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip

The ZIP is rebuilt automatically by GitHub Actions whenever files under `extension/` change on `main`.

**Landing:** https://zero-grok-landing.vercel.app
**Source:** `extension/` in this repo · **Changelog:** [CHANGELOG.md](CHANGELOG.md) · **Privacy:** [extension/PRIVACY.md](extension/PRIVACY.md)

## Install

1. Download the ZIP from the link above
2. Unzip
3. Chrome / Edge / Brave → Extensions → Developer mode → **Load unpacked** → select the extracted folder
4. A short first-run page lets you pick your AI sites and plans. Optional sites ask for access only when you turn them on.

## What you get

- **The can**: % left, a reset countdown, and a confidence label on every number. Drag it anywhere (it snaps to corners), shrink it to a dot, or hide it on one site.
- **Alt+Shift+Z** opens the usage panel on the current AI site. **Alt+U** shows or hides the can.
- **Popup**: every provider at a glance, a burn-rate forecast ("at this pace you'll hit zero ~4:10 PM"), per-model breakdowns, 7/30-day history, and a share card (PNG made locally).
- **Alerts**: your own thresholds (default 70/90/100%), quiet hours, a "limit reset" notification, and a suggestion to switch to an AI that still has room.
- **Health check**: if a site changes and Zero Grok can't read it, you see "tracking needs an update" instead of a wrong number.
- **Your data**: CSV/JSON export. Settings sync through your browser profile.
- Light and dark themes, a reduce-motion option, and English + हिन्दी.

## Update

Update checks are **off by default**. Turn them on in **Options → Updates** (or on the first-run page). When they're on, the extension reads `downloads/version.json` from `raw.githubusercontent.com` every 6 hours.

When a newer version is published:

1. You get a notification and a banner in the popup
2. Click **Download ZIP**
3. Unzip over the folder you loaded, then **Reload** the extension on `chrome://extensions`

Chrome can't silently replace a *Load unpacked* extension, so this checker plus the ZIP download is how updates work for this distribution.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Settings (synced) plus local usage history |
| `alarms` | Background refresh, reset reminders, the optional update check |
| `notifications` | Threshold and reset alerts |
| `scripting` | Registers the content script for optional sites after you allow them |
| Built-in AI sites | Read your usage on grok.com, claude.ai, chatgpt.com and gemini.google.com |
| `raw.githubusercontent.com/guguluP/zero-grok-site/*` | Optional update check and the data-only `selectors.json` |
| Optional sites (asked at runtime) | Perplexity, DeepSeek, Le Chat, Copilot, Meta AI |

No analytics and no third-party servers. See [PRIVACY.md](extension/PRIVACY.md).

## Gemini tip

Open https://gemini.google.com/usage once while signed in. Your other Gemini tabs then reuse that reading, with its age shown.

## Development

```bash
cd tests
npm ci
npm run lint        # web-ext lint (0 errors expected)
npx playwright install chromium
npm test            # unit tests + end-to-end tests with the extension loaded in Chromium
python3 ../tools/gen_assets.py   # regenerate icons + can-pop.wav (needs Pillow)
```

CI (`.github/workflows/extension-ci.yml`) runs lint and both test suites on every PR that touches `extension/` or `tests/`.

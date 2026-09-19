# Zero Grok

Diet Coke-style floating usage meter for **Grok**, **Claude**, **ChatGPT**, and **Gemini**.

## Download (always latest)

**ZIP (GitHub):** https://github.com/guguluP/zero-grok-site/raw/main/downloads/zero-grok.zip

The ZIP is rebuilt automatically by GitHub Actions whenever files under `extension/` change.

**Landing:** https://zero-grok-landing.vercel.app  
**Source:** `extension/` in this repo

## Install

1. Download the ZIP from the link above  
2. Unzip  
3. Chrome → Extensions → Developer mode → **Load unpacked** → select the extracted folder

## Update

The extension checks `downloads/version.json` on this repo every 6 hours (and on browser startup).

When a newer version is published:

1. You get a desktop notification and a banner in the popup  
2. Click **Download ZIP**  
3. Unzip over the folder you loaded, then **Reload** the extension on `chrome://extensions`

Chrome cannot silently replace a *Load unpacked* extension. The checker + ZIP download is the automatic path for this distribution.

Turn the checker off in Options → Updates.

## Gemini tip

Open https://gemini.google.com/usage once while signed in, then Refresh on the can.

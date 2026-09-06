# Zero Grok

Diet Coke-style floating usage meter for **Grok**, **Claude**, **ChatGPT**, and **Gemini**.

## Download (v1.4.2)

**ZIP:** https://litter.catbox.moe/zzo66p.zip  
**Source:** this repo (`extension/`)  
**Landing:** https://zero-grok-landing.vercel.app

## Install

1. Download and unzip  
2. Chrome → Extensions → Developer mode → **Load unpacked**  
3. Select the extracted folder

## Gemini blank % (fixed in 1.4.2)

1. Reload the extension after updating  
2. Open https://gemini.google.com/usage while signed in  
3. Click **Refresh** on the can panel (or wait a few seconds)

The can now uses:
- Live DOM scrape on `/usage`
- Stronger % / progress-bar parsers
- Network intercept for usage JSON
- DNR rules so the usage iframe can load

## Providers

| Provider | How usage is read |
|----------|-------------------|
| Grok | rate-limits + SuperGrok |
| Claude | org usage API |
| ChatGPT | session + settings scrape |
| Gemini | usage page + live DOM + DNR iframe |

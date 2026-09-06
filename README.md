# Zero Grok

Diet Coke-style floating usage meter for **Grok**, **Claude**, **ChatGPT**, and **Gemini**.

## Download

- **Latest ZIP (v1.4.2):** https://litter.catbox.moe/w6trqb.zip
- **Source:** this repo (`extension/`)
- **Landing:** https://zero-grok-landing.vercel.app

## Install

1. Download and unzip
2. Chrome → Extensions → Developer mode → **Load unpacked**
3. Select the extracted folder

## Gemini blank % fix (v1.4.2)

- Live scrape when you are on `gemini.google.com/usage`
- Stronger % parsers + progress bars
- Network intercept for usage JSON
- DNR rules to allow the usage iframe (strip X-Frame-Options)
- **Tip:** open [gemini.google.com/usage](https://gemini.google.com/usage) once while signed in, then click Refresh on the can panel

## Providers

| Provider | Source |
|----------|--------|
| Grok | rate-limits + SuperGrok |
| Claude | org usage API |
| ChatGPT | session + settings scrape |
| Gemini | usage page + live DOM + DNR iframe |

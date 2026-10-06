# Changelog

## 1.5.0 – 2026-10-06

### Fixed
- **Icons**: real 16/32/48/128 px PNGs. The old files weren't valid images.
- **Sound**: `assets/sounds/can-pop.wav` now ships and is listed in `web_accessible_resources`.
- **Updater**:
  - It is now actually wired up: `checkForUpdate` runs on a 6-hour alarm, the popup banner has Download / Later, and Options has an Updates toggle with "Check now".
  - It is **opt-in** (`autoCheckUpdates`, off by default).
  - It reads only `raw.githubusercontent.com/guguluP/zero-grok-site/*`. The broad `github.com/*` and jsDelivr host permissions were removed.
- **Can position**: `applyPosition` toggles classes instead of overwriting `className`, so `zg-can-root` and state classes survive.
- **Gemini**: removed the declarativeNetRequest rule that stripped `X-Frame-Options`/CSP, and with it the `declarativeNetRequest` permission and the iframe fallback. Gemini is read from the live `/usage` page, a same-origin fetch of `/usage`, or limit banners. Its last reading is cached and shown with its age.
- **Settings**: `SAVE_SETTINGS` merges partial updates instead of replacing the whole object.
- **Paid Grok detection**: explicit JSON fields first, labelled *Site usage API*. The gRPC-web protobuf decoding is only a fallback and is labelled *Estimate*.
- **SPA navigation**: the can and panel re-mount after client-side navigation and body swaps. This uses a MutationObserver plus `pushState`/`replaceState`/`popstate` hooks, debounced.
- **Element ids**: panels use unique per-provider ids (`zero-grok-panel-<provider>`). API- and page-sourced text is written with `textContent` only, and content scripts no longer use `innerHTML`, so they work under Trusted Types.
- **Firefox**: added a `background.scripts` fallback, `strict_min_version` 140 (128+ was required; 140 for `data_collection_permissions`), and `data_collection_permissions: none`.
- **Defaults**: ChatGPT's `estimateMessagesEnabled` default now matches the constants (off).
- **Permissions**: removed `tabs`, `declarativeNetRequest` and unused hosts.

### Added
- **Reset countdown** on the can, in the panel and in the popup, plus an optional "limit reset" notification.
- **Burn-rate forecast**: "At this pace you'll hit zero ~4:10 PM" or "lasts until the reset".
- **Per-model tracking**: a breakdown of Grok models, Claude 5-hour vs weekly windows, ChatGPT features and Gemini windows.
- **History**: 7- and 30-day charts (inline SVG). History is kept for 31 days, downsampled to one sample per 10 minutes.
- **Confidence label** on every number: *Site usage API*, *Read from page* or *Estimate*.
- **Alerts**: custom thresholds, quiet hours, a suggestion to switch provider when one runs low, and badge modes (lowest, last updated, a specific AI, off).
- **First-run setup**: pick providers and plans, position, theme, sound and updates.
- **Can controls**: the can is draggable with corner snapping, can be minimized to a dot, and can be hidden on a single site.
- **Shortcuts**: `Alt+Shift+U` toggles the usage panel; `Alt+U` shows or hides the can. The background now handles these shortcuts. (`Alt+Shift+Z` was planned, but Chromium silently refuses to assign it, as found by the e2e suite.)
- **Appearance**: light, dark and auto themes, and a reduce-motion option.
- **Languages**: i18n via `_locales`, with English and Hindi.
- **Optional providers** via `optional_host_permissions`: Perplexity, DeepSeek, Le Chat (Mistral), Microsoft Copilot and Meta AI.
  - They read on-page counters and limit banners, and otherwise show a clearly labelled local message count.
  - No limits are invented.
- **Settings sync**: settings are stored in `chrome.storage.sync`, with a local mirror and migration.
- **Exports**: CSV/JSON export, and a share card (a canvas PNG downloaded locally).
- **Privacy**: `PRIVACY.md` and a privacy note in the popup. No analytics.
- **Health check**: after repeated failed reads you see "tracking needs an update" instead of a wrong number.
- **Remote `selectors.json`**: a data-only file that is validated and never executed, refreshed daily. It can be turned off in Options.

### UI & animation polish (from the visual review)
- **The can no longer covers the message box or Send.** Bottom corners now sit 96px above the viewport bottom, and `avoidComposer()` (in `can-ui.js`) detects the site's composer (textarea / contenteditable / Send button and its `<form>`) and lifts the can 12px above it when it's taller. Re-checked on resize, after SPA navigation and every 2s; never pushed off-screen. Works on all 9 providers. Corner snapping now also snaps when you drop the can near its resting spot.
- **Contrast (WCAG AA).** New shared design tokens in `utils/tokens.css`, used by the popup, options, onboarding *and* the on-page panel. Text colours are separate from bar colours: warn text `#8f5400`, critical `#b8352a`, ok `#1a7a43` (light) and `#ffb347` / `#ff8a80` / `#5fd68f` (dark). Refresh button is `#1a7a43` with white text (5.37:1). Confidence chips, muted text and the panel no longer use `opacity` to dim text. The % on the can and the countdown sit on a dark pill, so they stay ≥ 4.5:1 over any liquid colour or bare metal. Every text token is checked in the unit tests; every rendered text is checked in the e2e tests.
- **Panel opens and closes with a fade + scale** (opacity/transform, 220ms in / 160ms out, growing from the can's side) instead of a `display` toggle. Closed panels are `visibility:hidden`, `inert` and `aria-hidden`. Focus moves to the close button on open, Tab/Shift+Tab stay inside the panel, and Escape closes it and returns focus to the can. The panel is pre-built when the browser is idle, so the first open has no build cost.
- **Liquid level slides** to the new value (requestAnimationFrame ease-out tween of the clip `y`) instead of jumping. The useless `transition: fill` is gone.
- **Bars**: popup and panel bars use the same green / orange / red level colours (the brand colour stays on the dot) and animate with `transform: scaleX()` instead of `width`.
- **Reset countdown** is 11px on a pill under the can (was 9px over the can).
- **Minimized state** is a 28px ring (level colour, brand colour when unknown) with a white outline, a "click to expand" tooltip, and a smooth can → ring morph (Web Animations, transform/opacity only).
- **At-limit pulse** is now an opacity/scale halo instead of an animated `filter`.
- **Keyboard**: visible focus rings everywhere (panel, can, minimize button, pages), 24px minimize button.
- **Hindi**: page titles, the 7d/30d range buttons, the can's label, the weekly "W" prefix and the new tooltip are translated. Note for testing: on Linux, Chrome takes its UI language from `LANGUAGE`/`LANG`; `--lang` alone doesn't change `chrome.i18n`.
- **Share card** has a small can watermark (filled to the lowest level shown).
- **Options**: the sticky Save bar has a top border, shadow and z-index so it doesn't blend into the sections.
- **Reduced motion**: the setting and the OS preference both turn off the panel/bar transitions, liquid tween, ring morph, halo pulse (shown static), bubbles, pop and fizz.

### Quality
- `tests/`:
  - unit tests (`node --test`)
  - a Playwright end-to-end suite that loads the real extension and serves fixture pages on the real provider origins
  - `web-ext lint`
- `.github/workflows/extension-ci.yml` runs lint and tests on PRs.
- `tools/gen_assets.py` regenerates the icons and the sound.

### Not in this release
- API-usage tracking for developers (OpenAI / Anthropic / xAI API keys). It needs secret keys in the extension and is a follow-up.
- Store listings (Chrome Web Store / AMO / Edge).

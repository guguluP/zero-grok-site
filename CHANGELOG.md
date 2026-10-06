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

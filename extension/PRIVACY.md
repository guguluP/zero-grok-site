# Zero Grok – Privacy

**Short version:** Zero Grok has no servers and no analytics. Your usage data never leaves your browser.

## What is stored, and where

| Data | Where | How long |
|---|---|---|
| Settings (providers, plans, thresholds, theme, …) | `chrome.storage.sync`, which follows your browser profile if sync is on, with a local copy | Until you change or uninstall |
| Latest reading per AI site (% left, reset time, source) | `chrome.storage.local` on this device | Replaced on every read |
| Usage history (one sample per site per 10 minutes) | `chrome.storage.local` on this device | 31 days; **Options → Your data → Clear history** deletes it |
| Local message counts (only for sites with no usage data, or when you turn on estimates) | `chrome.storage.local` | 7 days |
| Can position and "minimized" flag | The AI site's own `localStorage` | Until cleared |

No account details, cookies, prompts or chat content are stored. Access tokens a site uses for its own usage endpoint (for example ChatGPT's session token) are kept in memory only for that request.

## Network requests

Zero Grok only talks to:

1. **The AI sites themselves.** It calls their own usage or rate-limit endpoints, using the session you are already signed in with. Examples: `grok.com/rest/rate-limits`, `claude.ai/api/organizations/…/usage`, `gemini.google.com/usage`.
2. **`raw.githubusercontent.com/guguluP/zero-grok-site/…`**, for two optional things:
   - the update check (`downloads/version.json`). It is **off by default** and you turn it on in Options → Updates.
   - the data-only `extension/selectors.json`, so page selectors can be fixed without a release. It is on by default and can be turned off in Options. The file is validated and never executed.

   These requests are sent without cookies (`credentials: 'omit'`).

Nothing else is contacted. There is no telemetry, crash reporting, advertising or third-party SDK.

## Permissions

- `storage`, `alarms`, `notifications`, `scripting`: see the README table.
- Built-in AI sites are host permissions so the meter works out of the box.
- Perplexity, DeepSeek, Le Chat, Copilot and Meta AI are **optional**. The browser asks for access only when you enable them, and turning them off removes that access again.

## Exports and share card

CSV/JSON exports and the share-card PNG are created in your browser and saved with a normal download. Nothing is uploaded.

## Contact

Open an issue at https://github.com/guguluP/zero-grok-site/issues.

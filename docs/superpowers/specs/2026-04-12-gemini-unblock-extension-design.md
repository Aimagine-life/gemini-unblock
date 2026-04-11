# Gemini Unblock — Browser Extension Design

**Date:** 2026-04-12
**Status:** Draft pending user review
**Distribution:** GitHub release (`.zip`), manual install via `chrome://extensions` "Load unpacked" / drag-and-drop. Not Chrome Web Store.

---

## 1. Goal

A Chromium browser extension that lets users route a configurable list of domains through their own HTTP/HTTPS/SOCKS proxy, while leaving all other browser traffic direct. Primary use case: accessing Google Gemini and AI Studio (and similar AI services) from regions where Google geo-blocks them, by routing only those specific domains through a user-supplied proxy located in an allowed country.

The extension is a **client only**. It does not host, run, or recommend any proxy. The user brings their own proxy ("BYOP") from any source — paid VPN service, friend's VPS, self-hosted setup. The extension's job is to be a polished, well-behaved manager for `chrome.proxy` with per-domain routing rules and a usable UI.

## 2. Non-goals

The following are explicitly **out of scope for v1**:

- Hosting, providing, or recommending any proxy server
- Bundled proxy provider list, affiliate links, or built-in marketplace
- Telemetry, analytics, crash reporting, auto-update
- Cross-device sync of profiles or domain list
- Firefox / Safari builds (Chromium MV3 only)
- Chrome Web Store distribution
- Reverse-proxying or content rewriting (no `webRequest` content interception)
- Content scripts injected into target sites
- Any UI overlays or modifications on Google / AI Studio pages

## 3. Distribution & install model

- Source: public GitHub repository
- Releases: GitHub Releases with `.zip` of the unpacked extension
- Install path for users: download `.zip`, extract, open `chrome://extensions`, enable Developer Mode, click "Load unpacked", point at extracted folder. README walks through this with screenshots.
- No code signing. No CRX. No Web Store. README clearly states this is a manual-install extension and explains the security tradeoff (user must trust the source code).

## 4. High-level architecture

Single Manifest V3 extension with three logical components:

1. **Service worker** (`background.js`) — owns all state, the PAC script generator, the `chrome.proxy` API calls, the `onAuthRequired` listener, the context menu registration, the per-tab override tracker, the rotation engine, and the country-code poller.

2. **Popup UI** (`popup.html` + scripts) — two screens (main + settings), reads/writes state via `chrome.storage.local` and message-passes to the service worker for actions like "test connection" or "switch profile".

3. **Context menu items** — registered by the service worker on install. Right-click on the toolbar icon shows the menu. Click handlers live in the service worker.

There is no server-side component. There are no content scripts. There is no host permission requested.

## 5. Manifest permissions

```json
{
  "manifest_version": 3,
  "permissions": [
    "proxy",
    "storage",
    "webRequest",
    "webRequestAuthProvider",
    "contextMenus",
    "tabs",
    "alarms"
  ],
  "host_permissions": []
}
```

Justification per permission:

- **`proxy`** — set the PAC script via `chrome.proxy.settings.set`
- **`storage`** — persist profiles, routed domains, presets, rotation config, enabled flag
- **`webRequest`** — listen for `onErrorOccurred` to detect proxy failures and trigger failover
- **`webRequestAuthProvider`** — supply credentials to `onAuthRequired` for HTTP proxy 407 challenges (MV3-friendly alternative to `webRequestBlocking`)
- **`contextMenus`** — populate the right-click menu on the toolbar icon
- **`tabs`** — read `tab.url` for "Add this site" / "Force this tab", listen to `tabs.onUpdated` and `tabs.onRemoved` for per-tab override lifecycle
- **`alarms`** — drive the round-robin rotation timer and the periodic country-code poller (service workers can sleep, alarms wake them)

**No `host_permissions`.** The extension never reads, modifies, or otherwise touches page content. This is both a privacy property and a deliberate design choice to keep the manifest minimal and the trust surface small.

## 6. Storage schema

Single key in `chrome.storage.local`. All state is plain JSON.

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "profiles": [
    {
      "id": "uuid-v4",
      "name": "Hetzner DE",
      "host": "5.9.12.34",
      "port": 1080,
      "scheme": "auto",
      "detectedScheme": "socks5",
      "user": "myuser",
      "pass": "mypassword",
      "lastTest": {
        "ok": true,
        "ip": "5.9.12.34",
        "country": "DE",
        "latencyMs": 42,
        "at": 1712923000
      },
      "health": "healthy"
    }
  ],
  "activeProfileId": "uuid-v4",
  "rotation": {
    "mode": "failover",
    "intervalMin": 30
  },
  "presets": {
    "gemini":     { "enabled": true,  "domains": ["gemini.google.com"] },
    "aiStudio":   { "enabled": true,  "domains": ["aistudio.google.com", "alkalimakersuite-pa.clients6.google.com"] },
    "googleAuth": { "enabled": true,  "domains": ["accounts.google.com", "ogs.google.com"], "alwaysOnIfAnyAiPreset": true },
    "notebookLM": { "enabled": false, "domains": ["notebooklm.google.com"] },
    "chatgpt":    { "enabled": false, "domains": ["chatgpt.com", "chat.openai.com"] },
    "claude":     { "enabled": false, "domains": ["claude.ai"] },
    "perplexity": { "enabled": false, "domains": ["perplexity.ai", "www.perplexity.ai"] }
  },
  "customDomains": [
    { "value": "huggingface.co",   "mode": "suffix" },
    { "value": "*.anthropic.com",  "mode": "wildcard" }
  ]
}
```

Notes:

- `scheme: "auto"` means run protocol auto-detect on next save and store the result in `detectedScheme`. Manual override values: `http` / `https` / `socks5` / `socks4`. The PAC script always uses `detectedScheme` (or the manual scheme) at routing time.
- `googleAuth` is a hidden coupled preset: when `gemini`, `aiStudio`, or `notebookLM` is enabled, `accounts.google.com` and `ogs.google.com` must also be routed, otherwise login flow breaks. This is enforced by the PAC builder, not exposed in UI.
- `health` is per-profile runtime state: `"healthy" | "unhealthy"`. Set by the failover engine. Reset to `healthy` by background re-test.
- `customDomains[].mode` is one of `suffix` (plain `google.com` matches host + subdomains), `wildcard` (`*.google.com` matches subdomains only), `exact` (`=google.com` matches only the literal host).
- Per-tab override session state is **not** persisted — it lives in service-worker memory only and is wiped on worker startup.
- Pre-existing schemas are migrated by `schemaVersion`. v1 ships with `schemaVersion: 1`; future migrations live in a single `migrations.js`.

## 7. Routing logic — PAC script

The service worker generates a PAC script string from current state and pushes it via `chrome.proxy.settings.set({ value: { mode: "pac_script", pacScript: { data: ... } }, scope: "regular" })`.

PAC script structure:

```javascript
function FindProxyForURL(url, host) {
  // Suffix matches (plain entries)
  var suffixes = ["gemini.google.com", "aistudio.google.com", /* ... */];
  for (var i = 0; i < suffixes.length; i++) {
    if (dnsDomainIs(host, suffixes[i])) return "PROXY_DIRECTIVE";
  }

  // Wildcard matches (*.x.com — subdomains only, not x.com itself)
  var wildcards = ["anthropic.com", /* ... */];
  for (var i = 0; i < wildcards.length; i++) {
    if (host !== wildcards[i] && dnsDomainIs(host, wildcards[i])) return "PROXY_DIRECTIVE";
  }

  // Exact matches
  var exact = ["google.com", /* ... */];
  for (var i = 0; i < exact.length; i++) {
    if (host === exact[i]) return "PROXY_DIRECTIVE";
  }

  return "DIRECT";
}
```

Where `PROXY_DIRECTIVE` is computed from the active profile's detected scheme:

| Scheme  | PAC string                           |
|---------|--------------------------------------|
| http    | `PROXY host:port`                    |
| https   | `HTTPS host:port`                    |
| socks5  | `SOCKS5 host:port; SOCKS host:port`  |
| socks4  | `SOCKS host:port`                    |

The trailing `; DIRECT` fallback is **deliberately omitted**. If the proxy fails, the request must fail with `ERR_PROXY_CONNECTION_FAILED` rather than silently leak through the user's real IP. See §13.

The service worker re-generates and re-pushes the PAC script whenever:
- Profiles, presets, custom domains, or active profile change
- Master enable toggle flips
- A profile is marked unhealthy and failover swaps to a new active profile
- A per-tab override is added or removed
- Rotation timer fires and changes the active profile
- Service worker wakes from sleep (re-applies last-known config from storage)

When `enabled === false`, the PAC script is replaced by `chrome.proxy.settings.clear({ scope: "regular" })` and the icon goes to OFF state.

## 8. Domain validation & normalization

Triggered when the user adds a domain via the popup or the "Add this site" context menu item.

**Normalization steps (in order):**

1. Trim leading/trailing whitespace
2. Lowercase the entire string
3. Strip scheme: `http://`, `https://`, `//`
4. Strip userinfo: `user:pass@`
5. Strip path: anything after the first `/`
6. Strip query and fragment: anything after `?` or `#`
7. Strip port: `:1234`
8. Remove trailing dot
9. Convert IDN labels to punycode (use the platform-provided URL parser)

**Validation rules (after normalization):**

- Non-empty
- Contains at least one dot (rejects bare `localhost`, `intranet`)
- Each label: 1–63 characters, ASCII alphanumeric and hyphens, no leading/trailing hyphen
- Total length ≤ 253 characters
- IPv4 literals allowed
- IPv6 literals allowed (in bracket form, optional v1 polish)
- Optional leading `*.` for wildcard mode
- Optional leading `=` for exact mode

**Match-mode parsing:**

- Leading `*.` → store with `mode: "wildcard"`, value with the `*.` stripped
- Leading `=` → store with `mode: "exact"`, value with the `=` stripped
- Otherwise → `mode: "suffix"`

**Dedupe & overlap detection:**

- Exact duplicate already in `customDomains` → silently no-op
- Already covered by an enabled preset → show warning chip in UI but allow add
- Subset of an existing custom suffix entry (e.g. user adds `api.x.com` when `x.com` already routed in suffix mode) → show info note "already covered", allow add

## 9. Protocol auto-detect

When a profile has `scheme: "auto"`, the service worker probes protocols in order and locks in the first that works. Triggered on profile create, on host/port change, on explicit "Test proxy" click, and on `detectedScheme` being null.

**Probe order** (heuristic from port number, then fallback):

| Port hint           | First-try order                             |
|---------------------|---------------------------------------------|
| 1080                | `socks5 → socks4 → http → https`            |
| 443                 | `https → http → socks5 → socks4`            |
| 8080, 3128, 8118    | `http → https → socks5 → socks4`            |
| anything else       | `http → socks5 → https → socks4`            |

**Probe procedure:**

1. Save current `chrome.proxy` settings.
2. For each candidate scheme in order:
   1. Build a temporary PAC script that **preserves the full existing routing rules** (so in-flight traffic on Gemini etc. continues going through the currently-active proxy) and **additionally** routes `ipinfo.io` through the candidate scheme/host/port. The candidate rule is checked before the existing rules to ensure it wins for the test host.
   2. Push the temporary PAC.
   3. `fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(4000), cache: "no-store" })`.
   4. If the response is 200 and parses to JSON with a `country` field → success. Record the scheme as `detectedScheme`, record `lastTest` from the response, exit the loop.
   5. On error/timeout → next candidate.
3. Restore the original `chrome.proxy` settings.
4. If all four candidates fail → set profile to unhealthy, surface "could not auto-detect, pick manually" in the popup.

**Why preserve existing routing during probe:** if the temp PAC sent everything else `DIRECT`, an in-flight request from a Gemini tab during the probe would briefly leave through the user's real IP — defeating the entire point of the extension. The temp PAC must be additive, never subtractive.

Worst case duration: ~16 seconds (4 candidates × 4s timeout). The popup shows the DETECTING icon state during probing.

**Caveat to verify on day 1 of implementation:** Chrome's SOCKS5 username/password authentication has historically been unreliable. The very first prototype task is to confirm whether SOCKS5 + auth works in current Chromium. If it does not, the SOCKS5 pill in the manual selector shows "auth not supported" when credentials are filled, and SOCKS5 is excluded from auto-detect when credentials are present.

## 10. Profile management

- **Create:** popup settings screen → "+ Add" → empty profile form. Auto-detect runs on first save with valid host/port.
- **Edit:** click ✎ on a profile card → form pre-filled. Auto-save on blur. PAC re-pushed if this is the active profile.
- **Rename:** click ✎ → edit name field → blur. Names are user-supplied free text; default is "Profile 1", "Profile 2", … on creation.
- **Delete:** click ⋯ → "Delete". Confirmation dialog. Active profile cannot be deleted while it's the only one — if user has only one profile, "Delete" is disabled.
- **Switch active:** popup main screen → click profile chip → dropdown of all profiles with health and country → click → PAC re-pushed immediately, no confirmation.

## 11. Rotation strategies

Three modes, set in settings under "Rotation strategy":

### 11.1 Manual only (no rotation)
Active profile is whatever the user last picked. No automatic switching. Failed proxy → ERROR icon state, user must intervene.

### 11.2 Failover on error (default, recommended)
- Listen to `chrome.webRequest.onErrorOccurred` for `error === "net::ERR_PROXY_CONNECTION_FAILED"` (and related proxy errors) on requests destined for routed domains.
- On hit: mark current profile `health: "unhealthy"`, find the next healthy profile in list order, run a 1-second test against it, swap active profile in storage, re-push PAC.
- If the test fails, mark that one unhealthy too and try the next.
- If all profiles unhealthy → ERROR state, popup shows "All profiles failing".
- Background re-test of unhealthy profiles every 5 minutes via `chrome.alarms`. On success → mark healthy. The active profile is not changed by re-test alone — only by an actual failure on the active profile.

### 11.3 Round-robin every N minutes (opt-in, with warning)
- `chrome.alarms.create("rotate", { periodInMinutes: N })`, minimum N = 5
- On alarm: pick next healthy profile in list order, brief test, swap if test passes
- UI shows the warning text: "⚠ Will likely force re-login on Google sessions"
- Same per-failure failover behavior also applies inside round-robin mode (errors short-circuit to the next profile)

## 12. Per-tab override

Activated via context menu → "Force this tab through proxy".

**Honest Chrome limitation:** there is no per-tab `chrome.proxy` API. "Force this tab" is implemented as a session-only routed domain entry tied to a tab id.

**Mechanism:**

- Service-worker memory map: `Map<tabId, Set<hostname>>`
- On click: read `tab.url`, extract hostname, normalize, add to the tab's set, re-generate PAC with the union of all session entries plus persisted entries
- Listen to `chrome.tabs.onUpdated`: if a forced tab navigates to a new hostname, **add** that hostname to the tab's set (so SPA navigation works, and the user can navigate back to the original domain without re-clicking Force)
- **Hostnames accumulate over the tab's lifetime — they are never removed mid-tab.** This is intentional: removing on navigation would break the back button and SPA history.
- Listen to `chrome.tabs.onRemoved`: drop the tab's entire entry from the map, re-generate PAC

**Side-effect disclosure:** while a forced tab is alive, any other tab visiting the same hostname is also routed through the proxy, because PAC matches by hostname not by tab. This is a hard limitation of the Chrome extension API. Documented in README and surfaced in the context-menu item description.

**Persistence:** none. The map is wiped on service worker startup. "Force" is by definition ephemeral.

**Visual indicator:** when the active tab is in forced mode, the toolbar icon switches to a forced variant (purple-green gradient with `⚡XX` badge instead of plain `XX`).

## 13. Failure mode policy

When the proxy is unreachable for a routed domain:

- The browser surfaces `ERR_PROXY_CONNECTION_FAILED`.
- We **do not** fall back to direct connection. The PAC script intentionally omits `; DIRECT` for this reason.
- The icon flips to ERROR state (red, badge `!`).
- The popup main-screen status banner shows "Proxy unreachable — click to retest".
- If failover mode is enabled and a healthy alternate exists, swap before the user notices.

When the proxy is reachable but Gemini/AI Studio still returns geo-block (proxy is in a country that's also blocked):

- "Test Gemini" button surfaces this distinctly: "Proxy reachable, but Gemini returned 451. Try a different country."
- Icon stays in ROUTED state (proxy itself is fine).
- No auto-action — this is a user judgment call about which proxy to use.

## 14. Icon states

Per-tab. Updated whenever the active tab changes (`chrome.tabs.onActivated`) and whenever PAC config changes.

| State           | Icon                              | Badge   | Tooltip                                         |
|-----------------|-----------------------------------|---------|-------------------------------------------------|
| ROUTED          | green-cyan gradient               | `XX`    | "X routed via IP (country) · latency"           |
| ROUTED (forced) | purple-green gradient             | `⚡XX`  | "X forced through proxy (this tab only)"        |
| DIRECT          | indigo-cyan gradient              | none    | "X is direct (not in routed list)"              |
| OFF             | grayscale                         | none    | "Master toggle is off"                          |
| SETUP NEEDED    | amber gradient                    | `?`     | "No proxy configured — click to set up"         |
| ERROR           | red gradient                      | `!`     | "Proxy unreachable: <reason>"                   |
| DETECTING       | indigo gradient with glow         | `···`   | "Probing proxy protocol…"                       |

`XX` is the ISO-3166 alpha-2 country code from the active profile's `lastTest.country`. Falls back to `✓` if not yet known.

**Country code refresh:** `chrome.alarms.create("countryRefresh", { periodInMinutes: 1 })` → fetch `ipinfo.io/json` through the active proxy → update `lastTest`. This costs ~1 fetch per minute per active profile. If the user disables the extension, the alarm is cleared. Cost is negligible and worth the user-visible value.

## 15. Context menu

Items registered on `chrome.runtime.onInstalled`:

```
Gemini Unblock
─────────────────────────────
● Enabled                     ← toggle, shows current state
─────────────────────────────
This site (<hostname>)
+ Add to routed domains       ← only enabled if not already routed
⚡ Force this tab through proxy
─────────────────────────────
Active profile
● <profile name>          ▸   ← submenu with all profiles, click to switch
─────────────────────────────
↻ Test connection
⚙ Open settings…
↗ Report issue (GitHub)
```

The "This site" section header and the dynamic hostname require re-creating the menu items on `chrome.tabs.onActivated` and `chrome.tabs.onUpdated`. This is done with `chrome.contextMenus.update`.

## 16. Popup UI

### 16.1 Main screen

- **Header:** logo, app name, status line (`● Active · IP · country · latency` or appropriate variant), master enable toggle, gear icon → settings
- **Profile chip row:** dropdown showing active profile name + count of saved profiles. Click → vertical list of all profiles with health indicators, click any → switch active.
- **Routed services section:** 6 preset cards in a 3-column grid (Gemini, AI Studio, NotebookLM, ChatGPT, Claude, Perplexity). Click toggles. Selected = green border + checkmark badge. Unselected = muted.
- **Custom domains section:** vertical list of user-added entries (each with health dot, hostname, ✕ to remove), then a "+ Add domain" affordance.

### 16.2 Settings screen

- **Header:** back arrow → main, title "Settings"
- **Profiles section:** list of profile cards (each with health dot, name, host:port:scheme:country line, ✎ edit, ⋯ overflow). "+ Add" button to create.
- **Profile editor (in-place expansion or modal):** Protocol selector (`⚡ Auto`, HTTP, HTTPS, SOCKS5, SOCKS4 — Auto is the 5th pill, default), host + port row, optional auth (username, password with eye toggle), Test proxy button, Test Gemini button, result block, "Saved automatically" indicator.
- **Rotation strategy section:** three radio cards (Manual / Failover [recommended] / Round-robin every N min [warning]).

### 16.3 First-run popup

When `profiles.length === 0`:

- Header with amber icon and "⚠ Setup needed"
- Centered illustration (gear emoji), "Connect a proxy to get started", brief help text, big "Open settings →" CTA
- Footer link "Don't have a proxy? Read the guide" → link to README section on GitHub

## 17. Service worker lifecycle

- All event listeners (`chrome.webRequest.onAuthRequired`, `chrome.tabs.onActivated`, `chrome.runtime.onMessage`, etc.) are registered at the **top level** of the service worker script, not inside other handlers. This ensures they re-register when the worker wakes from sleep.
- On wake, the worker reads state from `chrome.storage.local`, regenerates and re-pushes the PAC script, and ensures the right alarms are scheduled. If `enabled === true` and there's no active profile or no profiles at all, it pushes a clear-proxy and sets the icon to SETUP NEEDED.
- The auth listener uses async-mode `onAuthRequired` (returns a Promise resolving with the credentials) so it can read from storage without blocking.
- Per-tab override map and country-code cache live in worker memory and are rebuilt on wake.

## 18. Testing strategy

### 18.1 Unit tests
- Domain normalization and validation: every rule in §8 has at least one positive and one negative test
- PAC script generation: given a state object, assert the produced PAC string contains expected directives
- Match-mode parsing: `*.x`, `=x`, plain `x` → correct `mode` field
- Storage migrations: each migration round-trips a v(N-1) blob to vN

### 18.2 Manual integration tests
- Day-1 prototype task: SOCKS5 + auth in current Chromium — does it work? Document result.
- Auto-detect: against an HTTP proxy, an HTTPS proxy, and a SOCKS5 proxy. Verify correct detection.
- Failover: configure two profiles, kill the first, browse to a routed domain, observe automatic swap.
- Per-tab override: open `huggingface.co`, click "Force this tab", verify icon shows forced variant, verify other tabs of `huggingface.co` are also routed (the documented side-effect), close the tab, verify direct again.
- First-run flow: install fresh, click icon, see empty state, click "Open settings", configure, save, see green status.
- Country code badge: switch profiles between 2 different countries, verify badge updates within ~1 minute.

### 18.3 Regression checklist
A README section with a manual checklist for releases, covering all five icon states, all three rotation modes, both auth and no-auth, both v1-supported scheme types.

## 19. Repository layout

```
gemini-unblock/
├── README.md
├── LICENSE
├── extension/
│   ├── manifest.json
│   ├── background.js              ← service worker entry
│   ├── lib/
│   │   ├── storage.js             ← read/write/migrate state
│   │   ├── pac.js                 ← PAC script builder
│   │   ├── domain.js              ← normalize + validate
│   │   ├── detect.js              ← protocol auto-detect
│   │   ├── failover.js            ← failover engine
│   │   ├── rotation.js            ← round-robin alarm handler
│   │   ├── icon.js                ← icon state setter
│   │   ├── menu.js                ← context menu setup + handlers
│   │   ├── tabOverride.js         ← per-tab override map
│   │   └── countryPoll.js         ← periodic ipinfo refresh
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   ├── popup.js
│   │   └── icons/                 ← service preset icons
│   └── icons/                     ← toolbar icon variants per state
├── tests/
│   ├── domain.test.js
│   ├── pac.test.js
│   └── ...
└── docs/
    ├── superpowers/
    │   └── specs/
    │       └── 2026-04-12-gemini-unblock-extension-design.md   ← this file
    └── screenshots/               ← for README
```

## 20. Open risks & verifications needed

These do not block design approval, but they need to be resolved early in implementation.

1. **SOCKS5 + username/password auth in current Chromium.** Historical issue. Day-1 prototype task. If broken, document and degrade UI (mark SOCKS5 + auth combo unsupported).
2. **`webRequestAuthProvider` reliability for proxy 407 in MV3.** Should work without `webRequestBlocking`, but worth confirming with a real HTTP proxy that requires auth.
3. **Gemini-specific routed domain list.** Initial set is a best guess. During development, open Gemini and AI Studio with DevTools → Network panel and capture every domain that fails when only the obvious ones are routed. Add to the `googleAuth` and `aiStudio` preset definitions.
4. **PAC script update latency.** When PAC changes, in-flight requests are not affected — only new requests pick up the new PAC. Closing and reopening the Gemini tab may be necessary on profile switch. Document.
5. **Icon update on tab switch.** `chrome.tabs.onActivated` fires reliably; `chrome.action.setIcon` per-tab is supported in MV3. Verify no flicker or missed updates with rapid tab switching.

## 21. Legal framing (for the README and the YouTube video)

Per discussion, the public-facing framing of the project is **strictly technical and educational**, never "how to bypass a block":

- README title: "Gemini Unblock — per-domain proxy router for Chromium"
- README opening: "A browser extension that lets you route a configurable list of domains through your own HTTP/SOCKS proxy. Useful for any per-site routing need."
- No reference to Roskomnadzor, no reference to "blocked in Russia", no rhetoric of "bypass", no recommendation of specific proxy providers, no affiliate links.
- The "where to get a proxy" guide page is a generic explainer of HTTP/SOCKS proxies, not a procurement guide.
- YouTube video framing: technical walkthrough of the Chrome `chrome.proxy` API, PAC scripts, MV3 service workers. The fact that it works for Gemini is a side effect of the user's configuration, not the product's purpose.

This framing is intentional. It is not just cosmetic — it materially affects the legal exposure of the author under ФЗ-149 art. 15.1 (popularization of circumvention tools), discussed in the brainstorming session. The extension is genuinely a technical tool that has uses beyond the AI-services case (any per-site routing — internal corp resources, dev environments, regional content, etc.), and the marketing should reflect that real generality.

## 22. Anything that came up but was deferred

These are plausible v2+ ideas, captured here so they're not lost:

- Tags / grouping for profiles (e.g. "EU group", "US group")
- Drag-to-reorder profiles (for round-robin order)
- Import / export profile list as encrypted blob
- Per-profile per-domain overrides (use proxy A for Gemini, proxy B for ChatGPT)
- Quick "pause for 1 hour" item in context menu
- HTTPS proxy with self-signed cert support and CA-pinning UI
- Browser-action keyboard shortcut to toggle
- Localizations (start with EN + RU)

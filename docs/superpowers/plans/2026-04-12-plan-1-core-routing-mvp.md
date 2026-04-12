# Gemini Unblock — Plan 1: Core Routing MVP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Chromium MV3 extension that routes a configurable set of domains (presets + custom list) through one user-supplied HTTP/HTTPS/SOCKS4/SOCKS5 proxy. No profiles, no auto-detect, no rotation, no per-tab override, no context menu — those land in Plan 2.

**Architecture:** Pure-JS MV3 extension with no build step. Service worker owns state and pushes a PAC script via `chrome.proxy.settings.set`. Popup UI is a static HTML page that reads/writes `chrome.storage.local` and message-passes to the worker for actions. Pure logic modules (domain validation, PAC builder) live in `extension/lib/` and are imported as ES modules by both the worker and the popup. Tests use Node's built-in `node --test` runner against the pure modules.

**Tech Stack:** Vanilla ES Modules, Manifest V3, no bundler, no framework, no dependencies. Tests via `node --test` (Node ≥ 20). HTML/CSS hand-written.

**Spec reference:** [docs/superpowers/specs/2026-04-12-gemini-unblock-extension-design.md](../specs/2026-04-12-gemini-unblock-extension-design.md). The MVP storage shape in this plan is a **simplified single-profile variant** of the v2 schema in §6 of the spec — Plan 2 will migrate it.

---

## Files this plan creates

```
gemini-unblock/
├── package.json                       ← node test runner config (no runtime deps)
├── extension/
│   ├── manifest.json                  ← MV3 manifest
│   ├── background.js                  ← service worker entry (ES module)
│   ├── lib/
│   │   ├── domain.js                  ← normalize, validate, parseEntry — PURE
│   │   ├── presets.js                 ← preset definitions — PURE
│   │   ├── pac.js                     ← buildPacScript(state) — PURE
│   │   ├── storage.js                 ← chrome.storage.local wrapper
│   │   ├── proxy.js                   ← chrome.proxy + onAuthRequired wiring
│   │   └── icon.js                    ← chrome.action icon state setter
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── icons/                         ← toolbar icon PNGs (4 states × 4 sizes)
└── tests/
    ├── domain.test.js
    ├── pac.test.js
    └── storage.test.js
```

**Module rule:** files in `extension/lib/` that are PURE (`domain.js`, `presets.js`, `pac.js`) MUST NOT import or reference `chrome.*` — they take state in, return values out, and are tested in plain Node. The chrome glue (`storage.js`, `proxy.js`, `icon.js`) is tested manually inside Chromium.

---

## Storage shape (MVP, single proxy)

```json
{
  "schemaVersion": 1,
  "enabled": false,
  "proxy": {
    "host": "5.9.12.34",
    "port": 1080,
    "scheme": "http",
    "user": "myuser",
    "pass": "mypassword",
    "lastTest": {
      "ok": true,
      "ip": "5.9.12.34",
      "country": "DE",
      "latencyMs": 42,
      "at": 1712923000
    }
  },
  "presets": {
    "gemini":     { "enabled": true,  "domains": ["gemini.google.com"] },
    "aiStudio":   { "enabled": true,  "domains": ["aistudio.google.com", "alkalimakersuite-pa.clients6.google.com"] },
    "googleAuth": { "enabled": true,  "domains": ["accounts.google.com", "ogs.google.com"] },
    "notebookLM": { "enabled": false, "domains": ["notebooklm.google.com"] },
    "chatgpt":    { "enabled": false, "domains": ["chatgpt.com", "chat.openai.com"] },
    "claude":     { "enabled": false, "domains": ["claude.ai"] },
    "perplexity": { "enabled": false, "domains": ["perplexity.ai", "www.perplexity.ai"] }
  },
  "customDomains": [
    { "value": "huggingface.co", "mode": "suffix" }
  ]
}
```

`proxy` is `null` until the user configures one. `enabled` defaults to `false` so a fresh install does nothing until set up. `googleAuth` is auto-coupled to the AI presets in `pac.js` (see Task 7).

---

## Phase 0 — Setup

### Task 0.1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `extension/manifest.json`
- Create: `extension/icons/.gitkeep`
- Create: `extension/lib/.gitkeep`
- Create: `extension/popup/.gitkeep`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gemini-unblock",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

(Note: `node --test` with no path uses default discovery — picks up `tests/**/*.test.js` and `*.test.js` anywhere in the project. On Node 24, passing an explicit empty directory triggers a `MODULE_NOT_FOUND` error, so we let the runner discover tests itself.)

- [ ] **Step 2: Create the directories with placeholder `.gitkeep` files**

Run:
```bash
cd C:/Users/Konstantin/projects/gemini-unblock
mkdir -p extension/lib extension/popup extension/icons tests
touch extension/lib/.gitkeep extension/popup/.gitkeep extension/icons/.gitkeep tests/.gitkeep
```

- [ ] **Step 3: Create `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Gemini Unblock",
  "version": "0.1.0",
  "description": "Per-domain proxy router for Chromium. Routes a configurable list of domains through your own HTTP/SOCKS proxy.",
  "minimum_chrome_version": "120",
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Gemini Unblock",
    "default_icon": {
      "16": "icons/off-16.png",
      "32": "icons/off-32.png",
      "48": "icons/off-48.png",
      "128": "icons/off-128.png"
    }
  },
  "icons": {
    "16": "icons/off-16.png",
    "32": "icons/off-32.png",
    "48": "icons/off-48.png",
    "128": "icons/off-128.png"
  },
  "permissions": [
    "proxy",
    "storage",
    "webRequest",
    "webRequestAuthProvider",
    "tabs"
  ],
  "host_permissions": []
}
```

Note: `contextMenus`, `alarms` are deferred to Plan 2. `tabs` is included now for icon-state-on-tab-switch in Task 13.

- [ ] **Step 4: Verify Node version**

Run:
```bash
node --version
```
Expected: `v20.x.x` or higher. If lower, install Node 20+ before continuing.

- [ ] **Step 5: Verify test runner works (with empty test set)**

Run:
```bash
npm test
```
Expected: exits cleanly, "tests 0".

- [ ] **Step 6: Commit**

```bash
git add package.json extension/manifest.json extension/lib/.gitkeep extension/popup/.gitkeep extension/icons/.gitkeep tests/.gitkeep
git commit -m "chore: scaffold extension and test runner"
```

---

### Task 0.2: Day-1 verification — does SOCKS5 + auth work in current Chromium?

This is a **manual** task that gates several decisions in Plan 2. Do it now so Plan 2 doesn't get stuck.

- [ ] **Step 1: Set up a test SOCKS5 proxy with auth**

Use any reachable SOCKS5 proxy that requires username/password. If you don't have one, the cheapest path is:
```bash
docker run --rm -p 1080:1080 \
  -e PROXY_USER=test -e PROXY_PASSWORD=test123 \
  serjs/go-socks5-proxy
```
(Run from any machine with Docker. Point to its IP from Chromium.)

- [ ] **Step 2: Configure Chromium to use it via command line**

Close all Chrome windows, then launch:
```bash
chrome --proxy-server="socks5://<host>:1080"
```

Visit `https://ipinfo.io`. When prompted for proxy credentials, enter `test` / `test123`.

- [ ] **Step 3: Record the result in `docs/socks5-auth-status.md`**

Create the file with one of these two contents:

If it works:
```markdown
# SOCKS5 + auth status

**Tested:** 2026-04-12 (Chromium <version>)
**Result:** WORKS — credentials accepted via system auth dialog, traffic routed correctly.
**Implication for Plan 2:** SOCKS5 stays in the auto-detect candidate list when credentials are present.
```

If it does NOT work (e.g. fails silently or rejects auth):
```markdown
# SOCKS5 + auth status

**Tested:** 2026-04-12 (Chromium <version>)
**Result:** BROKEN — <description of failure mode>
**Implication for Plan 2:** SOCKS5 must be excluded from auto-detect when credentials are present. The manual UI must show "auth not supported" hint when SOCKS5 + credentials are selected. README must document this Chromium limitation.
```

- [ ] **Step 4: Commit**

```bash
git add docs/socks5-auth-status.md
git commit -m "docs: record day-1 SOCKS5 auth verification"
```

---

## Phase 1 — Pure logic modules (TDD)

### Task 1: domain.js — normalize basic cases

**Files:**
- Create: `extension/lib/domain.js`
- Create: `tests/domain.test.js`

- [ ] **Step 1: Write the failing tests for `normalizeDomain`**

`tests/domain.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, ValidationError } from '../extension/lib/domain.js';

test('normalizeDomain: lowercases', () => {
  assert.equal(normalizeDomain('GEMINI.Google.COM'), 'gemini.google.com');
});

test('normalizeDomain: trims whitespace', () => {
  assert.equal(normalizeDomain('  example.com  '), 'example.com');
});

test('normalizeDomain: strips http scheme', () => {
  assert.equal(normalizeDomain('http://example.com'), 'example.com');
});

test('normalizeDomain: strips https scheme', () => {
  assert.equal(normalizeDomain('https://example.com'), 'example.com');
});

test('normalizeDomain: strips protocol-relative scheme', () => {
  assert.equal(normalizeDomain('//example.com'), 'example.com');
});

test('normalizeDomain: strips path', () => {
  assert.equal(normalizeDomain('example.com/foo/bar'), 'example.com');
});

test('normalizeDomain: strips query', () => {
  assert.equal(normalizeDomain('example.com?x=1'), 'example.com');
});

test('normalizeDomain: strips fragment', () => {
  assert.equal(normalizeDomain('example.com#anchor'), 'example.com');
});

test('normalizeDomain: strips port', () => {
  assert.equal(normalizeDomain('example.com:8080'), 'example.com');
});

test('normalizeDomain: strips userinfo', () => {
  assert.equal(normalizeDomain('user:pass@example.com'), 'example.com');
});

test('normalizeDomain: strips trailing dot', () => {
  assert.equal(normalizeDomain('example.com.'), 'example.com');
});

test('normalizeDomain: full URL with everything', () => {
  assert.equal(
    normalizeDomain('  HTTPS://user:pass@HuggingFace.co:443/spaces/foo?x=1#hash  '),
    'huggingface.co'
  );
});

test('normalizeDomain: throws on empty', () => {
  assert.throws(() => normalizeDomain(''), ValidationError);
  assert.throws(() => normalizeDomain('   '), ValidationError);
});

test('normalizeDomain: IDN to punycode', () => {
  // 'яндекс.рф' should become 'xn--d1acpjx3f.xn--p1ai'
  assert.equal(normalizeDomain('яндекс.рф'), 'xn--d1acpjx3f.xn--p1ai');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```
Expected: errors about missing module `extension/lib/domain.js`.

- [ ] **Step 3: Implement `extension/lib/domain.js`**

```javascript
// Pure module — no chrome.* APIs allowed.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Normalize a user-entered hostname. Strips scheme, path, query, port, userinfo.
 * Lowercases. Converts IDN labels to punycode. Throws ValidationError if input
 * cannot be reduced to a hostname.
 */
export function normalizeDomain(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) throw new ValidationError('empty input');

  // Strip scheme: anything matching scheme:// or just //
  s = s.replace(/^[a-z][a-z0-9+.\-]*:\/\//, '');
  s = s.replace(/^\/\//, '');

  // Strip userinfo (user:pass@). Note: must run AFTER scheme strip and BEFORE path strip.
  // Match anything up to and including @, but only if there's no / before it.
  const atIdx = s.indexOf('@');
  const slashIdx = s.indexOf('/');
  if (atIdx !== -1 && (slashIdx === -1 || atIdx < slashIdx)) {
    s = s.slice(atIdx + 1);
  }

  // Strip path / query / fragment — anything from first /, ?, or #
  s = s.split(/[/?#]/, 1)[0];

  // Strip port (:digits at end)
  s = s.replace(/:\d+$/, '');

  // Trailing dot
  s = s.replace(/\.+$/, '');

  if (!s) throw new ValidationError('empty after normalization');

  // IDN to punycode via the URL parser
  try {
    const u = new URL('http://' + s + '/');
    s = u.hostname;
  } catch {
    throw new ValidationError(`not a valid hostname: ${input}`);
  }

  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```
Expected: all `normalizeDomain` tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/domain.js tests/domain.test.js
git commit -m "feat(domain): normalizeDomain with scheme/path/port/userinfo/IDN handling"
```

---

### Task 2: domain.js — validateNormalized

**Files:**
- Modify: `extension/lib/domain.js`
- Modify: `tests/domain.test.js`

- [ ] **Step 1: Append failing tests to `tests/domain.test.js`**

```javascript
import { validateNormalized } from '../extension/lib/domain.js';

test('validateNormalized: rejects empty', () => {
  assert.equal(validateNormalized(''), false);
});

test('validateNormalized: rejects bare label (no dot)', () => {
  assert.equal(validateNormalized('localhost'), false);
  assert.equal(validateNormalized('example'), false);
});

test('validateNormalized: accepts plain domain', () => {
  assert.equal(validateNormalized('example.com'), true);
  assert.equal(validateNormalized('a.b.c.example.com'), true);
});

test('validateNormalized: accepts IPv4', () => {
  assert.equal(validateNormalized('192.168.1.1'), true);
  assert.equal(validateNormalized('10.0.0.1'), true);
});

test('validateNormalized: rejects bad IPv4', () => {
  assert.equal(validateNormalized('999.0.0.1'), false);
  assert.equal(validateNormalized('1.2.3'), false);
});

test('validateNormalized: rejects label too long', () => {
  const longLabel = 'a'.repeat(64);
  assert.equal(validateNormalized(`${longLabel}.com`), false);
});

test('validateNormalized: rejects label with leading hyphen', () => {
  assert.equal(validateNormalized('-bad.com'), false);
});

test('validateNormalized: rejects label with trailing hyphen', () => {
  assert.equal(validateNormalized('bad-.com'), false);
});

test('validateNormalized: accepts punycode (xn--)', () => {
  assert.equal(validateNormalized('xn--d1acpjx3f.xn--p1ai'), true);
});

test('validateNormalized: rejects total length > 253', () => {
  const longDomain = ('a'.repeat(60) + '.').repeat(5) + 'com';
  assert.equal(validateNormalized(longDomain), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```
Expected: import errors for `validateNormalized`.

- [ ] **Step 3: Append `validateNormalized` and helpers to `extension/lib/domain.js`**

```javascript
const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function isIPv4(s) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return false;
  return s.split('.').every((n) => {
    const v = Number(n);
    return v >= 0 && v <= 255;
  });
}

/**
 * Returns true if the (already normalized) hostname is structurally valid:
 * non-empty, ≤ 253 chars, contains a dot, every label conforms to DNS rules
 * (or it's an IPv4 literal).
 */
export function validateNormalized(domain) {
  if (!domain || typeof domain !== 'string') return false;
  if (domain.length > 253) return false;

  if (isIPv4(domain)) return true;

  if (!domain.includes('.')) return false;

  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (!LABEL_RE.test(label)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/domain.js tests/domain.test.js
git commit -m "feat(domain): validateNormalized with label and IPv4 rules"
```

---

### Task 3: domain.js — parseEntry with match modes

**Files:**
- Modify: `extension/lib/domain.js`
- Modify: `tests/domain.test.js`

- [ ] **Step 1: Append failing tests**

```javascript
import { parseEntry } from '../extension/lib/domain.js';

test('parseEntry: plain domain → suffix mode', () => {
  assert.deepEqual(parseEntry('example.com'), { value: 'example.com', mode: 'suffix' });
});

test('parseEntry: leading *. → wildcard mode', () => {
  assert.deepEqual(parseEntry('*.example.com'), { value: 'example.com', mode: 'wildcard' });
});

test('parseEntry: leading = → exact mode', () => {
  assert.deepEqual(parseEntry('=example.com'), { value: 'example.com', mode: 'exact' });
});

test('parseEntry: normalizes URL form', () => {
  assert.deepEqual(parseEntry('https://Example.COM/foo'), { value: 'example.com', mode: 'suffix' });
});

test('parseEntry: normalizes wildcard URL form', () => {
  assert.deepEqual(parseEntry('*.https://Example.COM'), { value: 'example.com', mode: 'wildcard' });
});

test('parseEntry: throws on garbage', () => {
  assert.throws(() => parseEntry(''), ValidationError);
  assert.throws(() => parseEntry('not a domain'), ValidationError);
  assert.throws(() => parseEntry('localhost'), ValidationError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```
Expected: missing `parseEntry`.

- [ ] **Step 3: Append `parseEntry` to `extension/lib/domain.js`**

```javascript
/**
 * Parse a user-entered entry into { value, mode }. Recognizes leading *.  and =
 * prefixes for wildcard and exact match modes; otherwise defaults to suffix mode.
 * Normalizes and validates the resulting hostname. Throws ValidationError on bad input.
 */
export function parseEntry(input) {
  let raw = String(input ?? '').trim();
  if (!raw) throw new ValidationError('empty input');

  let mode = 'suffix';
  if (raw.startsWith('*.')) {
    mode = 'wildcard';
    raw = raw.slice(2);
  } else if (raw.startsWith('=')) {
    mode = 'exact';
    raw = raw.slice(1);
  }

  const value = normalizeDomain(raw);
  if (!validateNormalized(value)) {
    throw new ValidationError(`invalid hostname: ${input}`);
  }
  return { value, mode };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/domain.js tests/domain.test.js
git commit -m "feat(domain): parseEntry with suffix/wildcard/exact match modes"
```

---

### Task 4: presets.js — preset definitions

**Files:**
- Create: `extension/lib/presets.js`

- [ ] **Step 1: Create `extension/lib/presets.js`**

```javascript
// Pure data module. Single source of truth for the preset list.
// When adding a preset: also add it to popup.js render order and to
// docs/screenshots if applicable.

export const PRESET_DEFINITIONS = {
  gemini: {
    label: 'Gemini',
    icon: '✦',
    domains: ['gemini.google.com'],
    isAi: true,
  },
  aiStudio: {
    label: 'AI Studio',
    icon: '⚡',
    domains: [
      'aistudio.google.com',
      'alkalimakersuite-pa.clients6.google.com',
    ],
    isAi: true,
  },
  notebookLM: {
    label: 'NotebookLM',
    icon: '📓',
    domains: ['notebooklm.google.com'],
    isAi: true,
  },
  chatgpt: {
    label: 'ChatGPT',
    icon: '◎',
    domains: ['chatgpt.com', 'chat.openai.com'],
    isAi: false,
  },
  claude: {
    label: 'Claude',
    icon: '✱',
    domains: ['claude.ai'],
    isAi: false,
  },
  perplexity: {
    label: 'Perplexity',
    icon: '⬢',
    domains: ['perplexity.ai', 'www.perplexity.ai'],
    isAi: false,
  },
  // Hidden preset — auto-routes Google login domains when ANY isAi preset is enabled.
  // Not exposed in UI; managed by pac.js.
  googleAuth: {
    label: 'Google login (auto)',
    icon: '🔐',
    domains: ['accounts.google.com', 'ogs.google.com'],
    isAi: false,
    hidden: true,
  },
};

export const PRESET_ORDER = [
  'gemini',
  'aiStudio',
  'notebookLM',
  'chatgpt',
  'claude',
  'perplexity',
];

export const AI_PRESET_KEYS = Object.entries(PRESET_DEFINITIONS)
  .filter(([_, p]) => p.isAi)
  .map(([k, _]) => k);
```

- [ ] **Step 2: Verify it parses (no test yet)**

Run:
```bash
node -e "import('./extension/lib/presets.js').then(m => console.log(Object.keys(m.PRESET_DEFINITIONS)))"
```
Expected: `[ 'gemini', 'aiStudio', 'notebookLM', 'chatgpt', 'claude', 'perplexity', 'googleAuth' ]`.

- [ ] **Step 3: Commit**

```bash
git add extension/lib/presets.js
git commit -m "feat(presets): define preset list with metadata"
```

---

### Task 5: pac.js — buildPacScript with single suffix

**Files:**
- Create: `extension/lib/pac.js`
- Create: `tests/pac.test.js`

- [ ] **Step 1: Write the failing test**

`tests/pac.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPacScript } from '../extension/lib/pac.js';

function makeState(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    proxy: { host: '5.9.12.34', port: 1080, scheme: 'http', user: '', pass: '' },
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: true,  domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai'] },
    },
    customDomains: [],
    ...overrides,
  };
}

test('buildPacScript: returns null when disabled', () => {
  assert.equal(buildPacScript(makeState({ enabled: false })), null);
});

test('buildPacScript: returns null when no proxy configured', () => {
  assert.equal(buildPacScript(makeState({ proxy: null })), null);
});

test('buildPacScript: HTTP proxy directive for gemini.google.com', () => {
  const pac = buildPacScript(makeState());
  assert.match(pac, /function FindProxyForURL/);
  assert.match(pac, /"gemini\.google\.com"/);
  assert.match(pac, /PROXY 5\.9\.12\.34:1080/);
  assert.match(pac, /return "DIRECT"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```
Expected: missing `extension/lib/pac.js`.

- [ ] **Step 3: Implement `extension/lib/pac.js`**

```javascript
// Pure module — no chrome.* APIs allowed.

const AI_PRESET_KEYS = ['gemini', 'aiStudio', 'notebookLM'];

function pacDirective(scheme, host, port) {
  switch (scheme) {
    case 'http':   return `PROXY ${host}:${port}`;
    case 'https':  return `HTTPS ${host}:${port}`;
    case 'socks5': return `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`;
    case 'socks4': return `SOCKS ${host}:${port}`;
    default:       throw new Error(`Unknown proxy scheme: ${scheme}`);
  }
}

function collectDomains(state) {
  const suffixes = [];
  const wildcards = [];
  const exacts = [];

  const presets = state.presets || {};
  const anyAiEnabled = AI_PRESET_KEYS.some((k) => presets[k]?.enabled);

  for (const [key, preset] of Object.entries(presets)) {
    const isCoupledGoogleAuth = key === 'googleAuth' && anyAiEnabled;
    if (!preset.enabled && !isCoupledGoogleAuth) continue;
    for (const d of preset.domains || []) suffixes.push(d);
  }

  for (const entry of state.customDomains || []) {
    if (!entry || !entry.value) continue;
    if (entry.mode === 'wildcard') wildcards.push(entry.value);
    else if (entry.mode === 'exact') exacts.push(entry.value);
    else suffixes.push(entry.value);
  }

  return { suffixes, wildcards, exacts };
}

/**
 * Build a PAC script string from extension state. Returns null if the extension
 * is disabled or no proxy is configured — the caller should clear chrome.proxy
 * settings in that case.
 *
 * The script does NOT include a "; DIRECT" fallback after the proxy directive.
 * If the proxy fails, the request fails — never silently leak through the user's
 * real IP. See spec §13.
 */
export function buildPacScript(state) {
  if (!state || !state.enabled) return null;
  if (!state.proxy || !state.proxy.host || !state.proxy.port) return null;

  const directive = pacDirective(state.proxy.scheme, state.proxy.host, state.proxy.port);
  const { suffixes, wildcards, exacts } = collectDomains(state);

  if (suffixes.length === 0 && wildcards.length === 0 && exacts.length === 0) {
    // Nothing to route — same as having no proxy.
    return null;
  }

  const directiveJson = JSON.stringify(directive);

  return [
    'function FindProxyForURL(url, host) {',
    `  var suffixes = ${JSON.stringify(suffixes)};`,
    '  for (var i = 0; i < suffixes.length; i++) {',
    `    if (dnsDomainIs(host, suffixes[i])) return ${directiveJson};`,
    '  }',
    `  var wildcards = ${JSON.stringify(wildcards)};`,
    '  for (var i = 0; i < wildcards.length; i++) {',
    `    if (host !== wildcards[i] && dnsDomainIs(host, wildcards[i])) return ${directiveJson};`,
    '  }',
    `  var exacts = ${JSON.stringify(exacts)};`,
    '  for (var i = 0; i < exacts.length; i++) {',
    `    if (host === exacts[i]) return ${directiveJson};`,
    '  }',
    '  return "DIRECT";',
    '}',
  ].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/pac.js tests/pac.test.js
git commit -m "feat(pac): buildPacScript with HTTP scheme and suffix routing"
```

---

### Task 6: pac.js — all schemes + wildcard + exact

**Files:**
- Modify: `tests/pac.test.js`

(`pac.js` itself already implements all schemes — these tests just exercise them.)

- [ ] **Step 1: Append failing tests**

```javascript
test('buildPacScript: HTTPS scheme', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: 'p.example.com', port: 443, scheme: 'https' },
  }));
  assert.match(pac, /HTTPS p\.example\.com:443/);
});

test('buildPacScript: SOCKS5 scheme has fallback to SOCKS', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: '1.2.3.4', port: 1080, scheme: 'socks5' },
  }));
  assert.match(pac, /SOCKS5 1\.2\.3\.4:1080; SOCKS 1\.2\.3\.4:1080/);
});

test('buildPacScript: SOCKS4 scheme', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: '1.2.3.4', port: 1080, scheme: 'socks4' },
  }));
  assert.match(pac, /SOCKS 1\.2\.3\.4:1080/);
});

test('buildPacScript: never includes ; DIRECT fallback after proxy directive', () => {
  const pac = buildPacScript(makeState());
  // The string "; DIRECT" must NEVER appear in the directive.
  assert.equal(pac.includes('; DIRECT'), false);
});

test('buildPacScript: custom suffix domain routed', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'huggingface.co', mode: 'suffix' }],
  }));
  assert.match(pac, /"huggingface\.co"/);
  // Suffix list should contain it.
  assert.match(pac, /var suffixes = \[.*"huggingface\.co".*\]/);
});

test('buildPacScript: custom wildcard domain in wildcards array', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'anthropic.com', mode: 'wildcard' }],
  }));
  assert.match(pac, /var wildcards = \["anthropic\.com"\]/);
});

test('buildPacScript: custom exact domain in exacts array', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'example.com', mode: 'exact' }],
  }));
  assert.match(pac, /var exacts = \["example\.com"\]/);
});

test('buildPacScript: googleAuth auto-coupled when AI preset enabled', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com'] }, // explicitly false
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: false, domains: [] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
  }));
  // googleAuth should be active because gemini is on.
  assert.match(pac, /"accounts\.google\.com"/);
});

test('buildPacScript: googleAuth NOT included when no AI preset enabled', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: false, domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: true,  domains: ['chatgpt.com'] }, // chatgpt is NOT AI-preset
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
    customDomains: [],
  }));
  assert.equal(pac.includes('accounts.google.com'), false);
});

test('buildPacScript: returns null when no domains routed', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: false, domains: [] },
      aiStudio:   { enabled: false, domains: [] },
      googleAuth: { enabled: false, domains: [] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: false, domains: [] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
    customDomains: [],
  }));
  assert.equal(pac, null);
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npm test
```
Expected: all tests pass (no implementation changes needed; the tests just exercise existing code paths).

- [ ] **Step 3: Commit**

```bash
git add tests/pac.test.js
git commit -m "test(pac): cover all schemes, match modes, googleAuth coupling"
```

---

## Phase 2 — Storage

### Task 7: storage.js with default state

**Files:**
- Create: `extension/lib/storage.js`
- Create: `tests/storage.test.js`

- [ ] **Step 1: Write the failing test**

`tests/storage.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock chrome.storage.local for the duration of these tests.
let mockStore = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (key) => Promise.resolve(key in mockStore ? { [key]: mockStore[key] } : {}),
      set: (obj) => { Object.assign(mockStore, obj); return Promise.resolve(); },
      clear: () => { mockStore = {}; return Promise.resolve(); },
    },
  },
};

const { loadState, saveState, getDefaultState } = await import('../extension/lib/storage.js');

test('getDefaultState: schemaVersion is 1', () => {
  assert.equal(getDefaultState().schemaVersion, 1);
});

test('getDefaultState: enabled is false', () => {
  assert.equal(getDefaultState().enabled, false);
});

test('getDefaultState: proxy is null', () => {
  assert.equal(getDefaultState().proxy, null);
});

test('getDefaultState: gemini and aiStudio presets enabled by default', () => {
  const s = getDefaultState();
  assert.equal(s.presets.gemini.enabled, true);
  assert.equal(s.presets.aiStudio.enabled, true);
  assert.equal(s.presets.chatgpt.enabled, false);
});

test('loadState: returns default state when storage empty', async () => {
  await chrome.storage.local.clear();
  const s = await loadState();
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.enabled, false);
});

test('loadState/saveState: round-trip preserves data', async () => {
  await chrome.storage.local.clear();
  const original = getDefaultState();
  original.enabled = true;
  original.proxy = { host: '1.2.3.4', port: 1080, scheme: 'http', user: '', pass: '' };
  await saveState(original);
  const loaded = await loadState();
  assert.deepEqual(loaded, original);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test
```
Expected: missing module.

- [ ] **Step 3: Implement `extension/lib/storage.js`**

```javascript
// Wraps chrome.storage.local. Tested in node by mocking globalThis.chrome.

const STORAGE_KEY = 'state';

export function getDefaultState() {
  return {
    schemaVersion: 1,
    enabled: false,
    proxy: null,
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: true,  domains: ['aistudio.google.com', 'alkalimakersuite-pa.clients6.google.com'] },
      googleAuth: { enabled: true,  domains: ['accounts.google.com', 'ogs.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com', 'chat.openai.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai', 'www.perplexity.ai'] },
    },
    customDomains: [],
  };
}

export async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? getDefaultState();
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/storage.js tests/storage.test.js
git commit -m "feat(storage): chrome.storage.local wrapper with default state"
```

---

## Phase 3 — Service worker (manual verification from here on)

These tasks load the actual extension into Chromium because they touch `chrome.*` APIs that cannot be unit-tested in Node.

### Task 8: icon.js — placeholder PNGs and state setter

**Files:**
- Create: `extension/icons/off-16.png`, `off-32.png`, `off-48.png`, `off-128.png`
- Create: `extension/icons/routed-16.png`, `routed-32.png`, `routed-48.png`, `routed-128.png`
- Create: `extension/icons/direct-16.png`, `direct-32.png`, `direct-48.png`, `direct-128.png`
- Create: `extension/icons/error-16.png`, `error-32.png`, `error-48.png`, `error-128.png`
- Create: `extension/lib/icon.js`

- [ ] **Step 1: Generate placeholder solid-color PNGs**

For MVP we ship monochrome solid squares per state. Final art is a Plan 2 polish task. Use any image tool or this Python one-liner (run from project root):

```bash
python3 - <<'PY'
from PIL import Image
import os
os.makedirs('extension/icons', exist_ok=True)
colors = {
  'off':    (107, 114, 128, 255),  # gray
  'routed': (16, 185, 129, 255),   # green
  'direct': (99, 102, 241, 255),   # indigo
  'error':  (239, 68, 68, 255),    # red
}
for name, rgba in colors.items():
    for size in (16, 32, 48, 128):
        img = Image.new('RGBA', (size, size), rgba)
        img.save(f'extension/icons/{name}-{size}.png')
print('done')
PY
```

If Python/PIL isn't available, any 16/32/48/128 px PNG of the right color works. Manual fallback: export from Figma/online tool.

- [ ] **Step 2: Verify all 16 icons exist**

Run:
```bash
ls extension/icons/*.png | wc -l
```
Expected: `16`.

- [ ] **Step 3: Create `extension/lib/icon.js`**

```javascript
// chrome.action wrapper. Sets icon, badge, and tooltip per state.
// State machine documented in spec §14. Plan 1 implements 4 states:
// off, routed, direct, error. Plan 2 adds: setupNeeded, detecting, forced.

const STATES = {
  off: {
    iconBase: 'icons/off',
    badge: '',
    badgeColor: '#000000',
    tooltipFn: () => 'Gemini Unblock — disabled',
  },
  routed: {
    iconBase: 'icons/routed',
    badgeColor: '#10b981',
    tooltipFn: ({ host, country, latencyMs }) =>
      `Gemini Unblock — ${host} routed via proxy${country ? ' (' + country + ')' : ''}${latencyMs ? ' · ' + latencyMs + ' ms' : ''}`,
  },
  direct: {
    iconBase: 'icons/direct',
    badge: '',
    badgeColor: '#000000',
    tooltipFn: ({ host }) => `Gemini Unblock — ${host} is direct (not in routed list)`,
  },
  error: {
    iconBase: 'icons/error',
    badge: '!',
    badgeColor: '#ef4444',
    tooltipFn: ({ reason }) => `Gemini Unblock — proxy error: ${reason || 'unreachable'}`,
  },
};

/**
 * Set the toolbar icon for a single tab. `state` is one of:
 * 'off' | 'routed' | 'direct' | 'error'.
 * `info` is an object with optional fields: host, country, latencyMs, reason.
 */
export async function setIconState(tabId, state, info = {}) {
  const config = STATES[state];
  if (!config) throw new Error(`Unknown icon state: ${state}`);

  const sizes = [16, 32, 48, 128];
  const path = {};
  for (const size of sizes) path[size] = `${config.iconBase}-${size}.png`;
  await chrome.action.setIcon({ tabId, path });

  let badgeText = config.badge;
  if (state === 'routed') {
    badgeText = info.country || '✓';
  }
  await chrome.action.setBadgeText({ tabId, text: badgeText });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: config.badgeColor });

  await chrome.action.setTitle({ tabId, title: config.tooltipFn(info) });
}
```

- [ ] **Step 4: Commit**

```bash
git add extension/icons extension/lib/icon.js
git commit -m "feat(icon): placeholder PNGs and state setter for 4 MVP states"
```

---

### Task 9: proxy.js — push/clear PAC and supply auth credentials

**Files:**
- Create: `extension/lib/proxy.js`

- [ ] **Step 1: Create `extension/lib/proxy.js`**

```javascript
// Wraps chrome.proxy.settings.set/clear and chrome.webRequest.onAuthRequired.
// Listener registration is at the top level so it survives service-worker
// sleep — see spec §17.

import { loadState } from './storage.js';
import { buildPacScript } from './pac.js';

/**
 * Apply the current state to chrome.proxy. Pushes a generated PAC script when
 * one is producible, otherwise clears proxy settings entirely.
 */
export async function applyProxy(state) {
  const pac = buildPacScript(state);
  if (pac === null) {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    return { applied: false };
  }
  await chrome.proxy.settings.set({
    value: { mode: 'pac_script', pacScript: { data: pac, mandatory: true } },
    scope: 'regular',
  });
  return { applied: true };
}

/**
 * Top-level registration of the proxy auth listener. Runs every time the
 * service worker starts (on install, on browser launch, on wake from sleep).
 * Reads credentials from storage at fire time so updates are picked up live.
 */
export function registerAuthListener() {
  chrome.webRequest.onAuthRequired.addListener(
    async (details) => {
      // Only handle proxy challenges, not server-side auth.
      if (!details.isProxy) return {};
      const state = await loadState();
      const proxy = state?.proxy;
      if (!proxy || !proxy.user) return {};
      return {
        authCredentials: { username: proxy.user, password: proxy.pass || '' },
      };
    },
    { urls: ['<all_urls>'] },
    ['asyncBlocking']
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/lib/proxy.js
git commit -m "feat(proxy): apply PAC and supply credentials via webRequestAuthProvider"
```

---

### Task 10: background.js — service worker entry point

**Files:**
- Create: `extension/background.js`

- [ ] **Step 1: Create `extension/background.js`**

```javascript
// Service worker entry. Registers listeners at top level so they survive
// sleep/wake. On startup: load state, push PAC, set initial icon for the
// active tab.

import { loadState, saveState } from './lib/storage.js';
import { applyProxy, registerAuthListener } from './lib/proxy.js';
import { setIconState } from './lib/icon.js';
import { buildPacScript } from './lib/pac.js';

// 1. Auth listener — must be top-level for sleep/wake survival.
registerAuthListener();

// 2. Storage change → re-apply PAC and refresh icons.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.state) return;
  const state = changes.state.newValue;
  await applyProxy(state);
  await refreshActiveTabIcon(state);
});

// 3. Tab activation → refresh icon for newly-active tab.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await loadState();
  await refreshTabIcon(tabId, state);
});

// 4. Tab navigation completed → refresh icon (URL may have changed).
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const state = await loadState();
  await refreshTabIcon(tabId, state);
});

// 5. Boot/wake.
(async function boot() {
  const state = await loadState();
  await applyProxy(state);
  await refreshActiveTabIcon(state);
})();

// --- helpers --------------------------------------------------------------

async function refreshActiveTabIcon(state) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await refreshTabIcon(tab.id, state);
}

async function refreshTabIcon(tabId, state) {
  if (!state || !state.enabled) {
    await setIconState(tabId, 'off');
    return;
  }
  if (!state.proxy || !state.proxy.host) {
    await setIconState(tabId, 'error', { reason: 'not configured' });
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url || !tab.url.startsWith('http')) {
    await setIconState(tabId, 'direct', { host: '(internal)' });
    return;
  }

  const host = new URL(tab.url).hostname;
  const isRouted = isHostRouted(host, state);
  if (isRouted) {
    await setIconState(tabId, 'routed', {
      host,
      country: state.proxy.lastTest?.country,
      latencyMs: state.proxy.lastTest?.latencyMs,
    });
  } else {
    await setIconState(tabId, 'direct', { host });
  }
}

// Mirror of pac.js routing logic for icon state checks. Kept tiny on purpose.
function isHostRouted(host, state) {
  const pac = buildPacScript(state);
  if (!pac) return false;
  // Use a simple in-process evaluation: dnsDomainIs is just suffix match.
  const presets = state.presets || {};
  const aiOn = ['gemini', 'aiStudio', 'notebookLM'].some((k) => presets[k]?.enabled);
  for (const [key, p] of Object.entries(presets)) {
    if (!p.enabled && !(key === 'googleAuth' && aiOn)) continue;
    for (const d of p.domains || []) {
      if (host === d || host.endsWith('.' + d)) return true;
    }
  }
  for (const e of state.customDomains || []) {
    const v = e.value;
    if (e.mode === 'wildcard') {
      if (host !== v && host.endsWith('.' + v)) return true;
    } else if (e.mode === 'exact') {
      if (host === v) return true;
    } else {
      if (host === v || host.endsWith('.' + v)) return true;
    }
  }
  return false;
}
```

- [ ] **Step 2: Manual smoke test — load extension, verify worker boots**

1. Open `chrome://extensions`.
2. Enable Developer Mode (top right).
3. Click "Load unpacked", point at `C:/Users/Konstantin/projects/gemini-unblock/extension/`.
4. Verify the extension appears with no red errors.
5. Click "Service worker" link → opens DevTools for the worker.
6. In the worker console, run: `chrome.storage.local.get('state').then(console.log)`.
7. Expected: returns `{}` (no state yet) and the worker prints no errors.
8. Verify the toolbar icon appears (gray "off" placeholder).
9. Verify hover-tooltip says "Gemini Unblock — disabled".

- [ ] **Step 3: Commit**

```bash
git add extension/background.js
git commit -m "feat(background): service worker boot, listeners, icon refresh"
```

---

## Phase 4 — Popup UI

### Task 11: popup HTML structure

**Files:**
- Create: `extension/popup/popup.html`

- [ ] **Step 1: Create `extension/popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=360, initial-scale=1" />
  <title>Gemini Unblock</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <div id="app">
    <!-- Main screen -->
    <section id="screen-main" class="screen" hidden>
      <header class="header">
        <div class="logo">🌐</div>
        <div class="header-text">
          <div class="title">Gemini Unblock</div>
          <div class="status" id="status-line">—</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="master-toggle" />
          <span class="slider"></span>
        </label>
        <button class="gear" id="open-settings" title="Settings">⚙</button>
      </header>

      <section class="block">
        <div class="block-label">Routed services</div>
        <div class="preset-grid" id="preset-grid"></div>
      </section>

      <section class="block">
        <div class="block-label">Custom domains</div>
        <div class="custom-list" id="custom-list"></div>
        <form class="add-row" id="add-domain-form">
          <input type="text" id="add-domain-input" placeholder="example.com or *.example.com" autocomplete="off" />
          <button type="submit">+ Add</button>
        </form>
        <div class="error-text" id="add-domain-error" hidden></div>
      </section>
    </section>

    <!-- Settings screen -->
    <section id="screen-settings" class="screen" hidden>
      <header class="header">
        <button class="back" id="back-to-main" title="Back">←</button>
        <div class="header-text">
          <div class="title">Proxy settings</div>
        </div>
      </header>

      <section class="block">
        <div class="block-label">Protocol</div>
        <div class="pill-group" id="scheme-pills">
          <button data-scheme="http"   class="pill">HTTP</button>
          <button data-scheme="https"  class="pill">HTTPS</button>
          <button data-scheme="socks5" class="pill">SOCKS5</button>
          <button data-scheme="socks4" class="pill">SOCKS4</button>
        </div>
      </section>

      <section class="block">
        <div class="row">
          <div class="field grow">
            <div class="block-label">Host</div>
            <input type="text" id="cfg-host" autocomplete="off" />
          </div>
          <div class="field port">
            <div class="block-label">Port</div>
            <input type="text" id="cfg-port" autocomplete="off" inputmode="numeric" />
          </div>
        </div>
      </section>

      <section class="block">
        <div class="block-label-row">
          <span class="block-label">Authentication</span>
          <span class="hint">optional</span>
        </div>
        <input type="text" id="cfg-user" placeholder="username" autocomplete="off" />
        <input type="password" id="cfg-pass" placeholder="password" autocomplete="off" />
      </section>

      <section class="block">
        <div class="row">
          <button class="action" id="test-proxy">Test proxy</button>
          <button class="action" id="test-gemini">Test Gemini</button>
        </div>
        <div class="result-block" id="test-result" hidden></div>
      </section>

      <footer class="footer" id="settings-footer">
        <span class="dot ok"></span> Saved automatically
      </footer>
    </section>

    <!-- First-run screen -->
    <section id="screen-firstrun" class="screen" hidden>
      <header class="header">
        <div class="logo amber">🌐</div>
        <div class="header-text">
          <div class="title">Gemini Unblock</div>
          <div class="status amber">⚠ Setup needed</div>
        </div>
      </header>
      <section class="block centered">
        <div class="big-icon">⚙</div>
        <div class="cta-title">Connect a proxy to get started</div>
        <div class="cta-sub">Enter the host, port and auth of your<br />HTTP/SOCKS proxy.</div>
        <button class="cta" id="firstrun-open-settings">Open settings →</button>
      </section>
    </section>
  </div>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup/popup.html
git commit -m "feat(popup): HTML structure for main, settings, first-run screens"
```

---

### Task 12: popup CSS

**Files:**
- Create: `extension/popup/popup.css`

- [ ] **Step 1: Create `extension/popup/popup.css`**

```css
:root {
  --bg: #1a1d24;
  --bg-2: #0d1015;
  --bg-3: #222630;
  --border: #2a2e38;
  --text: #e5e7eb;
  --text-dim: #9ca3af;
  --text-mute: #6b7280;
  --green: #10b981;
  --indigo: #6366f1;
  --amber: #f59e0b;
  --red: #ef4444;
  --cyan: #06b6d4;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  width: 360px;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
}

#app { width: 360px; }

.screen { display: block; }
.screen[hidden] { display: none; }

.header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--indigo), var(--cyan));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.logo.amber {
  background: linear-gradient(135deg, var(--amber), #fbbf24);
}

.header-text { flex: 1; min-width: 0; }
.title { font-weight: 600; font-size: 14px; }
.status {
  font-size: 11px;
  color: var(--green);
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.status.amber { color: var(--amber); }
.status.error { color: var(--red); }
.status::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
}
.status.no-dot::before { display: none; }

.toggle { position: relative; width: 38px; height: 22px; flex-shrink: 0; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle .slider {
  position: absolute; inset: 0;
  background: var(--border);
  border-radius: 11px;
  cursor: pointer;
  transition: background 0.15s;
}
.toggle .slider::before {
  content: '';
  position: absolute;
  top: 2px; right: 18px;
  width: 18px; height: 18px;
  background: white;
  border-radius: 50%;
  transition: right 0.15s;
}
.toggle input:checked + .slider { background: var(--green); }
.toggle input:checked + .slider::before { right: 2px; }

.gear, .back {
  background: none;
  border: 0;
  color: var(--text-mute);
  font-size: 17px;
  cursor: pointer;
  padding: 4px;
}
.gear:hover, .back:hover { color: var(--text); }

.block { padding: 14px 16px 6px; }
.block:last-of-type { padding-bottom: 16px; }
.block.centered { text-align: center; padding: 24px 20px; }

.block-label,
.block-label-row .block-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-mute);
  font-weight: 700;
  margin-bottom: 8px;
}
.block-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.block-label-row .block-label { margin-bottom: 0; }
.hint { font-size: 11px; color: var(--text-mute); }

.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.preset-card {
  background: var(--bg-3);
  border: 1.5px solid var(--border);
  border-radius: 9px;
  padding: 11px 6px 9px;
  text-align: center;
  cursor: pointer;
  position: relative;
  user-select: none;
}
.preset-card .icon { font-size: 22px; line-height: 1; margin-bottom: 5px; opacity: 0.55; }
.preset-card .label { font-size: 10px; font-weight: 600; opacity: 0.7; }
.preset-card.on {
  background: rgba(16, 185, 129, 0.08);
  border-color: var(--green);
}
.preset-card.on .icon { opacity: 1; }
.preset-card.on .label { opacity: 1; }
.preset-card.on::after {
  content: '✓';
  position: absolute;
  top: 5px; right: 5px;
  width: 13px; height: 13px;
  background: var(--green);
  color: white;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
}

.custom-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 8px;
}
.custom-item {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
}
.custom-item .dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--green);
  flex-shrink: 0;
}
.custom-item .value {
  flex: 1;
  font-size: 12px;
  font-family: ui-monospace, "SF Mono", monospace;
}
.custom-item .remove {
  background: none;
  border: 0;
  color: var(--text-mute);
  font-size: 15px;
  cursor: pointer;
}
.custom-item .remove:hover { color: var(--text); }

.add-row {
  display: flex;
  gap: 6px;
}
.add-row input {
  flex: 1;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text);
  outline: none;
}
.add-row input:focus { border-color: var(--indigo); }
.add-row button {
  background: var(--bg-3);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 12px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.add-row button:hover { background: #2f3340; }

.error-text {
  color: var(--red);
  font-size: 11px;
  margin-top: 6px;
}

.row { display: flex; gap: 8px; }
.field { display: flex; flex-direction: column; }
.field.grow { flex: 1; }
.field.port { width: 90px; }
.field input,
.block > input[type="text"],
.block > input[type="password"] {
  width: 100%;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 9px 11px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text);
  outline: none;
}
.block > input + input { margin-top: 6px; }
.field input:focus,
.block > input:focus { border-color: var(--indigo); }

.pill-group {
  display: flex;
  gap: 6px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px;
}
.pill {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-mute);
  background: none;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.pill.active {
  background: var(--border);
  color: var(--text);
  font-weight: 600;
}

.action {
  flex: 1;
  text-align: center;
  padding: 9px 0;
  font-size: 12px;
  font-weight: 600;
  background: var(--border);
  color: var(--text);
  border: 0;
  border-radius: 7px;
  cursor: pointer;
}
.action:hover { background: #353a47; }
.action:disabled { opacity: 0.5; cursor: wait; }

.result-block {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 7px;
  font-size: 11px;
  font-family: ui-monospace, monospace;
  line-height: 1.5;
}
.result-block.ok {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid var(--green);
  color: var(--green);
}
.result-block.err {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid var(--red);
  color: var(--red);
}

.footer {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-mute);
  display: flex;
  align-items: center;
  gap: 6px;
}
.footer .dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-mute);
}
.footer .dot.ok { background: var(--green); }

.big-icon { font-size: 36px; margin-bottom: 10px; opacity: 0.7; }
.cta-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.cta-sub {
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.5;
  margin-bottom: 18px;
}
.cta {
  background: linear-gradient(135deg, var(--indigo), var(--cyan));
  color: white;
  font-weight: 700;
  font-size: 12px;
  padding: 11px 22px;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add extension/popup/popup.css
git commit -m "feat(popup): full CSS for main, settings, first-run screens"
```

---

### Task 13: popup.js — render main screen

**Files:**
- Create: `extension/popup/popup.js`

- [ ] **Step 1: Create `extension/popup/popup.js`**

```javascript
import { loadState, saveState } from '../lib/storage.js';
import { parseEntry, ValidationError } from '../lib/domain.js';
import { PRESET_DEFINITIONS, PRESET_ORDER } from '../lib/presets.js';

const $ = (sel) => document.querySelector(sel);

let state = null;

async function init() {
  state = await loadState();
  routeInitialScreen();
  bindMain();
  bindSettings();
  bindFirstRun();
}

function routeInitialScreen() {
  const screens = ['main', 'settings', 'firstrun'];
  for (const s of screens) $(`#screen-${s}`).hidden = true;

  if (!state.proxy || !state.proxy.host) {
    $('#screen-firstrun').hidden = false;
  } else {
    showMain();
  }
}

function showMain() {
  $('#screen-main').hidden = false;
  $('#screen-settings').hidden = true;
  $('#screen-firstrun').hidden = true;
  renderMain();
}

function showSettings() {
  $('#screen-main').hidden = true;
  $('#screen-settings').hidden = false;
  $('#screen-firstrun').hidden = true;
  renderSettings();
}

function renderMain() {
  // Status line
  const status = $('#status-line');
  if (!state.enabled) {
    status.textContent = 'Disabled';
    status.classList.add('no-dot');
  } else {
    status.classList.remove('no-dot');
    const t = state.proxy?.lastTest;
    if (t?.ok) {
      status.textContent = `Active · ${t.ip} · ${t.country || ''} · ${t.latencyMs} ms`;
    } else {
      status.textContent = `Active · ${state.proxy?.host}:${state.proxy?.port}`;
    }
  }

  $('#master-toggle').checked = !!state.enabled;

  // Preset grid
  const grid = $('#preset-grid');
  grid.innerHTML = '';
  for (const key of PRESET_ORDER) {
    const def = PRESET_DEFINITIONS[key];
    const stored = state.presets[key];
    const card = document.createElement('div');
    card.className = 'preset-card' + (stored?.enabled ? ' on' : '');
    card.dataset.key = key;
    card.innerHTML = `
      <div class="icon">${def.icon}</div>
      <div class="label">${def.label}</div>
    `;
    card.addEventListener('click', () => togglePreset(key));
    grid.appendChild(card);
  }

  // Custom list
  const list = $('#custom-list');
  list.innerHTML = '';
  for (const entry of state.customDomains) {
    const item = document.createElement('div');
    item.className = 'custom-item';
    const display = entry.mode === 'wildcard'
      ? `*.${entry.value}`
      : entry.mode === 'exact'
        ? `=${entry.value}`
        : entry.value;
    item.innerHTML = `
      <div class="dot"></div>
      <div class="value">${escapeHtml(display)}</div>
      <button class="remove" type="button" title="Remove">×</button>
    `;
    item.querySelector('.remove').addEventListener('click', () => removeCustom(entry));
    list.appendChild(item);
  }
}

function bindMain() {
  $('#master-toggle').addEventListener('change', async (e) => {
    state.enabled = e.target.checked;
    await persist();
    renderMain();
  });

  $('#open-settings').addEventListener('click', () => showSettings());

  $('#add-domain-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#add-domain-input');
    const errEl = $('#add-domain-error');
    errEl.hidden = true;
    try {
      const entry = parseEntry(input.value);
      // Dedupe
      const exists = state.customDomains.find(
        (x) => x.value === entry.value && x.mode === entry.mode
      );
      if (exists) {
        errEl.textContent = 'Already in list';
        errEl.hidden = false;
        return;
      }
      state.customDomains.push(entry);
      await persist();
      input.value = '';
      renderMain();
    } catch (err) {
      if (err instanceof ValidationError) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      } else {
        throw err;
      }
    }
  });
}

async function togglePreset(key) {
  state.presets[key].enabled = !state.presets[key].enabled;
  await persist();
  renderMain();
}

async function removeCustom(entry) {
  state.customDomains = state.customDomains.filter(
    (x) => !(x.value === entry.value && x.mode === entry.mode)
  );
  await persist();
  renderMain();
}

async function persist() {
  await saveState(state);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Settings + first-run bindings — implemented in next tasks.
function bindSettings() {}
function bindFirstRun() {}
function renderSettings() {}

init();
```

- [ ] **Step 2: Manual verification**

1. Reload the extension at `chrome://extensions` (click the circular arrow on the extension card).
2. Click the toolbar icon → popup opens, shows the **first-run screen** because `state.proxy` is null.
3. In `chrome://extensions`, open the service-worker DevTools, run:
   ```javascript
   chrome.storage.local.set({ state: { schemaVersion: 1, enabled: true, proxy: { host: '1.2.3.4', port: 1080, scheme: 'http', user: '', pass: '' }, presets: { gemini: { enabled: true, domains: ['gemini.google.com'] }, aiStudio: { enabled: false, domains: [] }, googleAuth: { enabled: true, domains: ['accounts.google.com'] }, notebookLM: { enabled: false, domains: [] }, chatgpt: { enabled: false, domains: [] }, claude: { enabled: false, domains: [] }, perplexity: { enabled: false, domains: [] } }, customDomains: [] } })
   ```
4. Re-open the popup. Now **main screen** appears with status line "Active · 1.2.3.4:1080", master toggle on, Gemini card highlighted green, others muted.
5. Click ChatGPT card → it lights green. Click again → it goes muted. (Confirms preset toggle works.)
6. In add-domain field, type `https://huggingface.co/spaces/foo` → click +Add. Item appears as `huggingface.co`. Click ×, item is removed. (Confirms parseEntry + add/remove.)
7. In add-domain field, type `garbage` → click +Add. Error "not a valid hostname: garbage" appears below.
8. Toggle the master switch off → status line becomes "Disabled". Toggle back on.

- [ ] **Step 3: Commit**

```bash
git add extension/popup/popup.js
git commit -m "feat(popup): main-screen render with presets, custom domains, master toggle"
```

---

### Task 14: popup.js — settings screen with auto-save

**Files:**
- Modify: `extension/popup/popup.js`

- [ ] **Step 1: Replace the empty `bindSettings`/`renderSettings` stubs**

Locate the stubs at the bottom of `popup.js` and replace them:

```javascript
function bindSettings() {
  $('#back-to-main').addEventListener('click', () => showMain());

  for (const pill of document.querySelectorAll('#scheme-pills .pill')) {
    pill.addEventListener('click', async () => {
      const scheme = pill.dataset.scheme;
      ensureProxyObject();
      state.proxy.scheme = scheme;
      await persist();
      renderSettings();
    });
  }

  const fields = [
    ['#cfg-host', 'host', (v) => v.trim()],
    ['#cfg-port', 'port', (v) => parseInt(v, 10) || 0],
    ['#cfg-user', 'user', (v) => v],
    ['#cfg-pass', 'pass', (v) => v],
  ];
  for (const [sel, key, parse] of fields) {
    const el = $(sel);
    el.addEventListener('blur', async () => {
      ensureProxyObject();
      state.proxy[key] = parse(el.value);
      await persist();
    });
  }
}

function renderSettings() {
  ensureProxyObject();
  $('#cfg-host').value = state.proxy.host || '';
  $('#cfg-port').value = state.proxy.port || '';
  $('#cfg-user').value = state.proxy.user || '';
  $('#cfg-pass').value = state.proxy.pass || '';

  for (const pill of document.querySelectorAll('#scheme-pills .pill')) {
    pill.classList.toggle('active', pill.dataset.scheme === state.proxy.scheme);
  }

  $('#test-result').hidden = true;
}

function ensureProxyObject() {
  if (!state.proxy) {
    state.proxy = { host: '', port: 0, scheme: 'http', user: '', pass: '' };
  }
}
```

- [ ] **Step 2: Manual verification**

1. Reload extension. Open popup.
2. Click ⚙ → settings screen.
3. Type `1.2.3.4` in host, tab out → no error.
4. Type `1080` in port, tab out.
5. Click `SOCKS5` pill → it lights up.
6. In service-worker DevTools console: `chrome.storage.local.get('state').then(s => console.log(s.state.proxy))` → shows `{host: '1.2.3.4', port: 1080, scheme: 'socks5', user: '', pass: ''}`.
7. Click ← → returns to main.
8. Re-open popup, click ⚙ → fields are pre-filled with the saved values.

- [ ] **Step 3: Commit**

```bash
git add extension/popup/popup.js
git commit -m "feat(popup): settings screen with scheme pills and auto-save fields"
```

---

### Task 15: popup.js — Test proxy and Test Gemini buttons

**Files:**
- Modify: `extension/popup/popup.js`
- Modify: `extension/background.js` (add message handler)

- [ ] **Step 1: Add a message handler in `extension/background.js`**

Append to the bottom of `background.js`:

```javascript
// --- popup messaging ------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'TEST_PROXY') {
    runProxyTest('https://ipinfo.io/json').then(sendResponse);
    return true; // async response
  }
  if (msg?.type === 'TEST_GEMINI') {
    runProxyTest('https://gemini.google.com/').then(sendResponse);
    return true;
  }
});

async function runProxyTest(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - start;
    let extra = {};
    if (url.includes('ipinfo.io')) {
      const data = await res.json();
      extra = { ip: data.ip, country: data.country };
      // Persist lastTest on the proxy.
      const state = await loadState();
      if (state.proxy) {
        state.proxy.lastTest = {
          ok: true,
          ip: data.ip,
          country: data.country,
          latencyMs,
          at: Math.floor(Date.now() / 1000),
        };
        await saveState(state);
      }
    } else {
      extra = { httpStatus: res.status };
    }
    return { ok: true, latencyMs, ...extra };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
```

- [ ] **Step 2: Add button handlers to `popup.js`**

Inside `bindSettings()` (append before the closing `}`):

```javascript
  $('#test-proxy').addEventListener('click', () => runTest('TEST_PROXY'));
  $('#test-gemini').addEventListener('click', () => runTest('TEST_GEMINI'));
}

async function runTest(type) {
  const btnProxy = $('#test-proxy');
  const btnGemini = $('#test-gemini');
  const result = $('#test-result');
  btnProxy.disabled = true;
  btnGemini.disabled = true;
  result.hidden = true;

  try {
    const res = await chrome.runtime.sendMessage({ type });
    result.hidden = false;
    if (res.ok) {
      result.className = 'result-block ok';
      if (type === 'TEST_PROXY') {
        result.innerHTML = `✓ Proxy reachable<br>IP: ${res.ip || '?'}<br>Country: ${res.country || '?'}<br>Latency: ${res.latencyMs} ms`;
      } else {
        result.innerHTML = `✓ Gemini reachable<br>HTTP ${res.httpStatus}<br>Latency: ${res.latencyMs} ms`;
      }
      // Re-render to pick up updated lastTest.
      state = await loadState();
    } else {
      result.className = 'result-block err';
      result.textContent = `✗ ${res.error}`;
    }
  } finally {
    btnProxy.disabled = false;
    btnGemini.disabled = false;
  }
}
```

(Move the closing `}` of `bindSettings` AFTER the two `addEventListener` lines, not before.)

- [ ] **Step 3: Manual verification — needs a real proxy**

1. Reload extension.
2. Open popup → ⚙ → enter a real working HTTP proxy you have access to.
3. Click "Test proxy". Wait. Result block should show "✓ Proxy reachable" with IP, country, latency.
4. Click "Test Gemini". Result block should show "✓ Gemini reachable" with HTTP 200 (or 302).
5. Disconnect from your proxy or break it (wrong port). Click "Test proxy" → error result.

- [ ] **Step 4: Commit**

```bash
git add extension/popup/popup.js extension/background.js
git commit -m "feat(test): Test proxy / Test Gemini buttons via background fetch"
```

---

### Task 16: popup.js — first-run screen wiring

**Files:**
- Modify: `extension/popup/popup.js`

- [ ] **Step 1: Replace the empty `bindFirstRun` stub**

```javascript
function bindFirstRun() {
  $('#firstrun-open-settings').addEventListener('click', () => {
    ensureProxyObject();
    showSettings();
  });
}
```

Note: clicking this from the first-run screen takes the user straight to settings without going through main. After they save valid proxy + go back, `showMain()` will pick up the new state automatically because `init()` re-runs on next popup open.

- [ ] **Step 2: Manual verification**

1. In service-worker DevTools: `chrome.storage.local.clear()`.
2. Open popup → first-run screen.
3. Click "Open settings →" → settings screen with empty fields.
4. Fill in host, port, save (auto-save on blur).
5. Click ← back arrow → main screen now appears (because `state.proxy` is no longer null).

- [ ] **Step 3: Commit**

```bash
git add extension/popup/popup.js
git commit -m "feat(popup): first-run screen routes to settings"
```

---

## Phase 5 — End-to-end smoke test

### Task 17: Full manual test against a real proxy

This task does not modify code. It's a checklist that proves the MVP actually works against a real proxy in a real browser, end to end.

- [ ] **Step 1: Acquire a real working proxy in a country where Gemini is available**

You need: host, port, scheme, optional user/pass. The country must NOT be one of the regions where Gemini is geo-blocked. Use whatever you have.

- [ ] **Step 2: Reload the extension fresh**

In `chrome://extensions`, click "Remove" then "Load unpacked" again. This clears all state.

- [ ] **Step 3: First-run path**

1. Click toolbar icon → first-run screen appears.
2. Click "Open settings →".
3. Fill in: host, port, scheme (use your real values), user/pass if applicable.
4. Click "Test proxy" → should show ✓ with country. If ✗, fix the proxy and retry.
5. Click "Test Gemini" → should show ✓ HTTP 200/302.
6. Click ← back.

- [ ] **Step 4: Master toggle ON, verify Gemini loads**

1. Master toggle → ON.
2. Open `https://gemini.google.com/` in a new tab.
3. Verify it loads (not a 451 / "not available" page).
4. Hover the toolbar icon — tooltip should say "Gemini Unblock — gemini.google.com routed via proxy ...".
5. Toolbar icon should be GREEN.
6. Open `https://youtube.com/` in another tab.
7. Toolbar icon should be INDIGO (direct).
8. Hover — tooltip says "youtube.com is direct (not in routed list)".
9. Switch back to the Gemini tab → icon goes back to GREEN.

- [ ] **Step 5: Custom domain**

1. Open popup on the main screen.
2. Add `huggingface.co` to custom domains.
3. Open `https://huggingface.co/` → should load through the proxy (icon GREEN).

- [ ] **Step 6: Failure mode**

1. In settings, change the proxy port to something invalid (e.g. 9).
2. Reload Gemini tab.
3. Page should show `ERR_PROXY_CONNECTION_FAILED`. **Verify it does NOT silently fall through to direct connection** (which would render Google's geo-block page).
4. Restore the correct port.
5. Reload Gemini tab → works again.

- [ ] **Step 7: Master toggle OFF**

1. Toggle master OFF in popup.
2. Open Gemini tab. It should now hit Google directly (and likely show the geo-block page from your real location).
3. Toolbar icon: gray "off".

- [ ] **Step 8: Browser restart**

1. Quit and re-open the browser.
2. Open popup → state is preserved (proxy still configured).
3. Open Gemini → still works (PAC re-applied on worker boot).

- [ ] **Step 9: Auth flow (skip if your proxy has no auth)**

1. Configure a proxy with valid user/pass.
2. Reload extension.
3. Visit Gemini → should NOT pop a system credential dialog (the extension's `onAuthRequired` listener handles it silently).
4. Configure with WRONG password.
5. Visit Gemini → should fail with proxy error after retry.

- [ ] **Step 10: Document any failures**

If anything in steps 3–9 fails, **stop and fix before continuing**. Open an issue or note in `docs/manual-test-notes.md`. Do NOT proceed to release packaging with broken behavior.

- [ ] **Step 11: Mark MVP smoke test as passed**

If everything passed, append the run to `docs/manual-test-notes.md`:

```markdown
## MVP smoke test — 2026-04-12
- Browser: <Chrome/Edge/Brave version>
- Proxy: <type, country>
- All 9 checklist steps: PASS
```

Then commit:

```bash
git add docs/manual-test-notes.md
git commit -m "test: MVP end-to-end smoke test passing"
```

---

### Task 18: README and release zip

**Files:**
- Create: `README.md`
- Create: `scripts/build-release.sh`

- [ ] **Step 1: Write `README.md`**

Per spec §21, framing is **technical and educational**, not "bypass blocks":

```markdown
# Gemini Unblock

A Chromium browser extension that lets you route a configurable list of domains through your own HTTP/HTTPS/SOCKS proxy. Useful for any per-site routing need: internal corporate resources, regional content, development environments, or accessing services that aren't reachable from your current network.

## What it does

- You bring your own proxy (BYOP). The extension is a client only — it does not host, run, or recommend any proxy.
- You pick which domains go through the proxy from a preset list (Gemini, AI Studio, NotebookLM, ChatGPT, Claude, Perplexity) or add your own.
- Everything else stays on your direct connection — fast, private, and untouched.
- Built on Chromium's `chrome.proxy` API and PAC scripts. No content scripts, no host permissions, no telemetry.

## How it works

The extension reads your routing list, generates a PAC script, and pushes it to Chromium via `chrome.proxy.settings.set`. Domains in your list are routed through the proxy you configured; everything else uses `DIRECT`. Authentication (when present) is supplied by the service worker via `chrome.webRequest.onAuthRequired`.

## Permissions

- `proxy` — set the PAC script
- `storage` — persist your config
- `webRequest`, `webRequestAuthProvider` — supply credentials to your proxy
- `tabs` — show the right toolbar icon for the current tab

**No host permissions.** The extension never reads or modifies page content.

## Install (manual)

This extension is not on the Chrome Web Store. You install it manually from a release `.zip`.

1. Download the latest `gemini-unblock-vX.Y.Z.zip` from the [Releases](https://github.com/<user>/gemini-unblock/releases) page.
2. Unzip it anywhere on your computer.
3. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked** and point at the unzipped folder.
6. Click the extension's icon in the toolbar to set up your proxy.

## Configuring a proxy

The extension does not provide a proxy. You bring one. Options include:
- A self-hosted proxy on your own VPS
- A commercial VPN that exposes a SOCKS5 endpoint
- A friend's proxy
- Anything else that speaks HTTP, HTTPS, SOCKS4, or SOCKS5

In the popup, click ⚙ to enter:
- **Protocol** — HTTP / HTTPS / SOCKS5 / SOCKS4
- **Host** and **Port**
- **Username / Password** (optional)

Then **Test proxy** to verify it's reachable, **Test Gemini** to verify Gemini is reachable through it.

## Building from source

No build step. The `extension/` directory IS the extension. Load it directly with **Load unpacked**, or zip it for distribution:

```bash
./scripts/build-release.sh
```

## Running tests

```bash
npm test
```

Requires Node 20+. Tests cover the pure logic modules (domain validation, PAC builder, storage). Browser-integration behavior is verified manually per the checklist in `docs/manual-test-notes.md`.

## License

MIT.
```

- [ ] **Step 2: Write `scripts/build-release.sh`**

```bash
mkdir -p scripts
```

`scripts/build-release.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./extension/manifest.json').version")
OUT="dist/gemini-unblock-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# Use Python's zipfile (cross-platform, present everywhere) instead of `zip`
python3 - <<PY
import os, zipfile
out = "$OUT"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk("extension"):
        for f in files:
            full = os.path.join(root, f)
            arc = os.path.relpath(full, "extension")
            z.write(full, arc)
print(f"Wrote {out}")
PY
```

- [ ] **Step 3: Make script executable and verify it builds**

```bash
chmod +x scripts/build-release.sh
./scripts/build-release.sh
ls dist/
```
Expected: `gemini-unblock-v0.1.0.zip` exists.

- [ ] **Step 4: Verify the zip is loadable**

1. Unzip `dist/gemini-unblock-v0.1.0.zip` somewhere temporary.
2. `chrome://extensions` → Load unpacked → the unzipped folder.
3. Verify it loads with no errors and behaves identically to the dev version.

- [ ] **Step 5: Add `dist/` to `.gitignore`**

Append to `.gitignore`:
```
dist/
```
(Already there from initial commit — verify it's present.)

- [ ] **Step 6: Commit**

```bash
git add README.md scripts/build-release.sh
git commit -m "docs: README and release build script for v0.1.0"
```

---

## Done — MVP shippable

At this point you have:
- A working Chromium MV3 extension routing Gemini and other configured domains through a user-supplied proxy
- 4 icon states (off, routed, direct, error) updating per-tab
- Popup with main + settings + first-run screens
- HTTP/HTTPS/SOCKS4/SOCKS5 protocol support with manual selection
- Proxy auth via `webRequestAuthProvider`
- Test buttons for proxy and Gemini reachability
- Pure-logic modules covered by node-test
- A release `.zip` ready to drop on a GitHub release
- Manual end-to-end smoke test passed
- Day-1 SOCKS5+auth status documented for Plan 2

**Next:** Plan 2 covers profiles + rotation + auto-detect + per-tab override + context menu + country-code badge + first-run polish. It will start by migrating the storage shape from this Plan 1's single-proxy form to the array-of-profiles form in spec §6.

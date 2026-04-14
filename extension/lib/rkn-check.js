// RKN compliance check. Detects whether a domain is blocked by Roskomnadzor
// (government block) vs. simply geo-restricted by the service itself.
//
// Legal context: geo-restriction by a service (Google blocking Gemini in RU) is
// not a government ban — using a proxy is legal. An RKN block IS a government ban —
// circumventing it may violate Russian law (149-FZ).

import { loadState, saveState } from './storage.js';
import { applyProxy } from './proxy.js';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5000;

// Known ISP block page patterns.
const BLOCK_PAGE_PATTERNS = [
  /rkn\.gov/i, /eais\.rkn/i, /blocklist/i, /zapret/i, /blocked/i,
  /warning\.rt\.ru/i, /block\.mts\.ru/i, /block\.beeline\.ru/i,
  /restrictor/i, /nap\.rkn/i,
];

/**
 * Check a single domain DIRECTLY (no proxy). Returns { blocked, reason }.
 * Temporarily clears proxy, fetches, restores proxy from saved state.
 */
export async function checkDomain(domain) {
  await chrome.proxy.settings.clear({ scope: 'regular' });

  try {
    const res = await fetch(`https://${domain}/`, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      const location = res.headers.get('location') || '';
      const redirectDomain = extractDomain(location);
      if (redirectDomain && redirectDomain !== domain && isBlockPage(location)) {
        return { blocked: true, reason: `redirect to ${redirectDomain}` };
      }
    }
    return { blocked: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    // Timeout / reset / refused. Could be RKN DPI but also plain network issue.
    // Err on side of allowing: treat as not-blocked.
    return { blocked: false, reason: `${err.message} (assumed not blocked)` };
  } finally {
    // Restore proxy from state so the extension keeps working.
    const state = await loadState();
    await applyProxy(state);
  }
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function isBlockPage(url) {
  return BLOCK_PAGE_PATTERNS.some((re) => re.test(url));
}

export async function checkAllPresets(presets) {
  const results = {};
  for (const [_key, preset] of Object.entries(presets)) {
    for (const domain of preset.domains || []) {
      if (results[domain]) continue;
      results[domain] = await checkDomain(domain);
    }
  }
  return results;
}

export function isCheckDue(lastCheckAt) {
  if (!lastCheckAt) return true;
  return (Date.now() - lastCheckAt) > CHECK_INTERVAL_MS;
}

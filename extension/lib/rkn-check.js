// RKN compliance check. Uses a hosted mirror of the official RKN registry
// (updated daily from zapret-info/z-i via our GitHub Action).
//
// Legal: geo-restriction by a service (Google blocking Gemini in RU) is not
// a government ban — using a proxy is legal. An RKN block IS a government ban —
// circumventing it may violate 149-FZ.

const LIST_URL = 'https://raw.githubusercontent.com/Aimagine-life/gemini-unblock/main/data/rkn-domains.txt';
const CACHE_KEY = 'rknListCache';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h refresh
const FETCH_TIMEOUT_MS = 20000;

/**
 * Fetch the RKN domain list from GitHub, cache in chrome.storage.
 * Returns a Set of blocked domain strings (lowercased).
 */
async function loadRknList() {
  const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  const fresh = cached && (Date.now() - cached.at) < CHECK_INTERVAL_MS;
  if (fresh && Array.isArray(cached.domains)) {
    return new Set(cached.domains);
  }

  try {
    const res = await fetch(LIST_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const domains = text.split('\n').map((s) => s.trim()).filter(Boolean);
    await chrome.storage.local.set({
      [CACHE_KEY]: { domains, at: Date.now() },
    });
    return new Set(domains);
  } catch (err) {
    // On fetch failure, use whatever cache we have (even if stale).
    if (cached?.domains) return new Set(cached.domains);
    throw err;
  }
}

function isHostInSet(host, set) {
  const h = host.toLowerCase().replace(/^\*\./, '');
  if (set.has(h)) return true;
  // Match any parent domain (e.g., sub.example.com matches example.com).
  const parts = h.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

/**
 * Check a single domain against the RKN registry.
 * Returns { blocked: boolean, reason: string }.
 */
export async function checkDomain(domain) {
  try {
    const set = await loadRknList();
    if (isHostInSet(domain, set)) {
      return { blocked: true, reason: 'in RKN registry' };
    }
    return { blocked: false, reason: 'not in RKN registry' };
  } catch (err) {
    // Can't reach the list — fail open (don't block user) but note it.
    return { blocked: false, reason: `list unavailable: ${err.message}` };
  }
}

export async function checkAllPresets(presets) {
  const set = await loadRknList().catch(() => null);
  const results = {};
  for (const [_key, preset] of Object.entries(presets)) {
    for (const domain of preset.domains || []) {
      if (results[domain]) continue;
      results[domain] = set && isHostInSet(domain, set)
        ? { blocked: true, reason: 'in RKN registry' }
        : { blocked: false, reason: set ? 'not in registry' : 'list unavailable' };
    }
  }
  return results;
}

export function isCheckDue(lastCheckAt) {
  if (!lastCheckAt) return true;
  return (Date.now() - lastCheckAt) > CHECK_INTERVAL_MS;
}

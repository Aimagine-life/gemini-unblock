// RKN compliance check. Uses a hosted mirror of the official RKN registry
// (updated daily from zapret-info/z-i via our GitHub Action).
//
// Legal: geo-restriction by a service (Google blocking Gemini in RU) is not
// a government ban — using a proxy is legal. An RKN block IS a government ban —
// circumventing it may violate 149-FZ.

const LIST_URL = 'https://raw.githubusercontent.com/Aimagine-life/gemini-unblock/main/data/rkn-domains.txt';
const CACHE_KEY = 'rknListCache';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30000;

// In-memory cache — persists for service worker lifetime.
let memorySet = null;
let memoryFetchedAt = 0;

async function loadRknList() {
  // 1. Hot path — in-memory cache.
  if (memorySet && (Date.now() - memoryFetchedAt) < CHECK_INTERVAL_MS) {
    return memorySet;
  }

  // 2. Warm path — chrome.storage (requires unlimitedStorage for our 18MB list).
  try {
    const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
    if (cached && typeof cached.text === 'string' && (Date.now() - cached.at) < CHECK_INTERVAL_MS) {
      memorySet = textToSet(cached.text);
      memoryFetchedAt = cached.at;
      console.log(`[RKN] Loaded ${memorySet.size} domains from cache`);
      return memorySet;
    }
  } catch (err) {
    console.warn('[RKN] Cache read failed:', err.message);
  }

  // 3. Cold path — fetch from GitHub.
  console.log('[RKN] Fetching fresh list from GitHub\u2026');
  const res = await fetch(LIST_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  memorySet = textToSet(text);
  memoryFetchedAt = Date.now();
  console.log(`[RKN] Loaded ${memorySet.size} domains from network`);

  // Try to cache, but don't fail if storage rejects it.
  try {
    await chrome.storage.local.set({ [CACHE_KEY]: { text, at: memoryFetchedAt } });
  } catch (err) {
    console.warn('[RKN] Cache write failed (list too large?):', err.message);
  }

  return memorySet;
}

function textToSet(text) {
  const s = new Set();
  for (const line of text.split('\n')) {
    const d = line.trim();
    if (d) s.add(d);
  }
  return s;
}

function isHostInSet(host, set) {
  const h = host.toLowerCase().replace(/^\*\./, '');
  if (set.has(h)) return true;
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
    const blocked = isHostInSet(domain, set);
    console.log(`[RKN] ${domain} → ${blocked ? 'BLOCKED' : 'ok'}`);
    return {
      blocked,
      reason: blocked ? 'in RKN registry' : 'not in RKN registry',
    };
  } catch (err) {
    console.error('[RKN] Check failed:', err);
    // Fail closed for safety — if we can't verify, don't allow.
    return { blocked: true, reason: `cannot verify: ${err.message}` };
  }
}

export async function checkAllPresets(presets) {
  let set = null;
  try { set = await loadRknList(); } catch {}
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

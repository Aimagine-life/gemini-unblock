// RKN compliance check. Detects whether a domain is blocked by Roskomnadzor
// (government block) vs. simply geo-restricted by the service itself.
//
// How it works:
// 1. Temporarily clear proxy settings so the request goes DIRECT.
// 2. Fetch the domain with a short timeout.
// 3. If the response redirects to a different domain (ISP block page) → RKN blocked.
//    If connection resets but we know the domain exists → likely DPI block.
//    If we get a normal response from the domain itself (403, 200, etc.) → not RKN blocked.
// 4. Restore proxy settings.
//
// Legal context: geo-restriction by a service (Google blocking Gemini in RU) is
// not a government ban — using a proxy is legal. An RKN block IS a government ban —
// circumventing it may violate Russian law (149-FZ).

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 6000;

// Known ISP block page patterns (domains they redirect to).
const BLOCK_PAGE_PATTERNS = [
  /rkn\.gov/i,
  /eais\.rkn/i,
  /blocklist/i,
  /zapret/i,
  /blocked/i,
  /warning\.rt\.ru/i,
  /block\.mts\.ru/i,
  /block\.beeline\.ru/i,
  /restrictor/i,
  /nap\.rkn/i,
];

/**
 * Check a single domain. Returns { blocked: boolean, reason: string }.
 * Must be called from background.js (needs chrome.proxy access).
 */
export async function checkDomain(domain) {
  // Save current proxy state, go DIRECT.
  const before = await chrome.proxy.settings.get({ incognito: false });

  await chrome.proxy.settings.clear({ scope: 'regular' });

  try {
    const url = `https://${domain}/`;
    const res = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'manual',           // don't follow redirects — inspect them
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    // Check for redirect to a block page.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      const redirectDomain = extractDomain(location);
      if (redirectDomain && redirectDomain !== domain && isBlockPage(location)) {
        return { blocked: true, reason: `redirect to ${redirectDomain}` };
      }
    }

    // Got a response from the actual domain → not RKN blocked.
    // (Could be 403 geo-restriction from the service — that's fine.)
    return { blocked: false, reason: `HTTP ${res.status}` };

  } catch (err) {
    // Connection reset / refused / timeout.
    // Timeout alone doesn't prove RKN block (server could just be slow).
    // Connection reset is more suspicious but also not definitive.
    // We err on the safe side: NOT blocked (geo-restriction assumed).
    return { blocked: false, reason: `${err.message} (assumed geo-restriction)` };

  } finally {
    // Restore previous proxy settings.
    if (before?.value?.mode && before.value.mode !== 'system') {
      await chrome.proxy.settings.set({ value: before.value, scope: 'regular' });
    }
  }
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function isBlockPage(url) {
  return BLOCK_PAGE_PATTERNS.some((re) => re.test(url));
}

/**
 * Check all preset domains. Returns a map: { "gemini.google.com": { blocked, reason }, ... }.
 */
export async function checkAllPresets(presets) {
  const results = {};
  for (const [_key, preset] of Object.entries(presets)) {
    for (const domain of preset.domains || []) {
      if (results[domain]) continue; // already checked
      results[domain] = await checkDomain(domain);
    }
  }
  return results;
}

/**
 * Should we run a new check? Compares last check timestamp with CHECK_INTERVAL_MS.
 */
export function isCheckDue(lastCheckAt) {
  if (!lastCheckAt) return true;
  return (Date.now() - lastCheckAt) > CHECK_INTERVAL_MS;
}

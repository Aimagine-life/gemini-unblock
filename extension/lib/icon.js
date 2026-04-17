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

function isNoTabError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('no tab with id') || msg.includes('tab not found');
}

async function safeActionCall(fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    // Tabs can disappear between event delivery and icon update.
    // Ignore this race to avoid noisy "Unchecked runtime.lastError" logs.
    if (isNoTabError(err)) return false;
    throw err;
  }
}

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
  const tabExists = await safeActionCall(() => chrome.action.setIcon({ tabId, path }));
  if (!tabExists) return;

  let badgeText = config.badge;
  if (state === 'routed') {
    badgeText = info.country || '✓';
  }
  await safeActionCall(() => chrome.action.setBadgeText({ tabId, text: badgeText }));
  await safeActionCall(() => chrome.action.setBadgeBackgroundColor({ tabId, color: config.badgeColor }));

  await safeActionCall(() => chrome.action.setTitle({ tabId, title: config.tooltipFn(info) }));
}

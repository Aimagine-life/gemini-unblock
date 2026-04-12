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

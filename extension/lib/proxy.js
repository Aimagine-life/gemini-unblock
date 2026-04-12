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

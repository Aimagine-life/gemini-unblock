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

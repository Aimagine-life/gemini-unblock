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
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
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
  const state = await loadState();
  if (!state.proxy?.host) return { ok: false, error: 'No proxy configured' };

  // Temporarily route ALL traffic through the proxy so the test URL actually
  // goes through it (ipinfo.io is not in the normal routing list).
  await chrome.proxy.settings.set({
    value: {
      mode: 'pac_script',
      pacScript: { data: buildAllThroughPac(state.proxy), mandatory: true },
    },
    scope: 'regular',
  });

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
      state.proxy.lastTest = {
        ok: true,
        ip: data.ip,
        country: data.country,
        latencyMs,
        at: Math.floor(Date.now() / 1000),
      };
      await saveState(state);
    } else {
      extra = { httpStatus: res.status };
    }
    return { ok: true, latencyMs, ...extra };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    // Restore normal PAC (routes only configured domains).
    await applyProxy(state);
  }
}

// Build a PAC that routes every URL through the proxy (used only for testing).
function buildAllThroughPac(proxy) {
  const { scheme, host, port } = proxy;
  let directive;
  switch (scheme) {
    case 'https':  directive = `HTTPS ${host}:${port}`; break;
    case 'socks5': directive = `SOCKS5 ${host}:${port}; SOCKS ${host}:${port}`; break;
    case 'socks4': directive = `SOCKS ${host}:${port}`; break;
    default:       directive = `PROXY ${host}:${port}`;
  }
  return `function FindProxyForURL(url, host) { return "${directive}"; }`;
}

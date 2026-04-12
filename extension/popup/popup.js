import { loadState, saveState } from '../lib/storage.js';
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

}

function bindMain() {
  $('#master-toggle').addEventListener('change', async (e) => {
    state.enabled = e.target.checked;
    await persist();
    renderMain();
  });

  $('#open-settings').addEventListener('click', () => showSettings());

}

async function togglePreset(key) {
  state.presets[key].enabled = !state.presets[key].enabled;
  await persist();
  renderMain();
}

async function persist() {
  await saveState(state);
}

// --- Settings screen ---

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

  // Auto-parse proxy URL when pasted/typed into host field.
  // Supports: socks5://user:pass@host:port, http://host:port, host:port, etc.
  const hostEl = $('#cfg-host');
  hostEl.addEventListener('blur', async () => {
    ensureProxyObject();
    const raw = hostEl.value.trim();
    const parsed = tryParseProxyUrl(raw);
    if (parsed) {
      state.proxy.host = parsed.host;
      if (parsed.port) state.proxy.port = parsed.port;
      if (parsed.scheme) state.proxy.scheme = parsed.scheme;
      if (parsed.user) state.proxy.user = parsed.user;
      if (parsed.pass !== undefined) state.proxy.pass = parsed.pass;
      await persist();
      renderSettings();
    } else {
      state.proxy.host = raw;
      await persist();
    }
  });

  const otherFields = [
    ['#cfg-port', 'port', (v) => parseInt(v, 10) || 0],
    ['#cfg-user', 'user', (v) => v],
    ['#cfg-pass', 'pass', (v) => v],
  ];
  for (const [sel, key, parse] of otherFields) {
    const el = $(sel);
    el.addEventListener('blur', async () => {
      ensureProxyObject();
      state.proxy[key] = parse(el.value);
      await persist();
    });
  }

  $('#test-proxy').addEventListener('click', () => runTest('TEST_PROXY'));
  $('#test-gemini').addEventListener('click', () => runTest('TEST_GEMINI'));
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

/**
 * Try to parse a proxy string. Supported formats:
 *   - socks5://user:pass@host:port  (URL style)
 *   - http://host:port
 *   - host:port:user:pass            (provider style, e.g. 196.16.109.114:8000:N0eT6k:UK2c2X)
 *   - host:port
 * Returns { scheme?, host, port?, user?, pass? } or null if it's just a plain hostname.
 */
function tryParseProxyUrl(input) {
  const SCHEMES = { http: 'http', https: 'https', socks5: 'socks5', socks4: 'socks4', socks: 'socks5' };

  // --- Provider format: host:port:user:pass ---
  // Detect by splitting on colons: 4 parts where part[1] is a number.
  const hasScheme = /^[a-z][a-z0-9]*:\/\//i.test(input);
  if (!hasScheme) {
    const parts = input.trim().split(':');
    if (parts.length === 4 && /^\d+$/.test(parts[1])) {
      // Provider format: no scheme → default HTTP (most provider proxies are HTTP)
      return {
        host: parts[0],
        port: parseInt(parts[1], 10),
        scheme: 'http',
        user: parts[2],
        pass: parts[3],
      };
    }
    // host:port only → default HTTP
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return { host: parts[0], port: parseInt(parts[1], 10), scheme: 'http' };
    }
  }

  // --- URL format: scheme://user:pass@host:port ---
  if (!hasScheme) return null;

  let scheme = null;
  let rest = input;

  const schemeMatch = input.match(/^([a-z][a-z0-9]*):\/\//i);
  if (schemeMatch) {
    scheme = SCHEMES[schemeMatch[1].toLowerCase()] || null;
    rest = input.slice(schemeMatch[0].length);
  }

  let user = null;
  let pass = undefined;
  const atIdx = rest.indexOf('@');
  if (atIdx !== -1) {
    const userinfo = rest.slice(0, atIdx);
    rest = rest.slice(atIdx + 1);
    const colonIdx = userinfo.indexOf(':');
    if (colonIdx !== -1) {
      user = decodeURIComponent(userinfo.slice(0, colonIdx));
      pass = decodeURIComponent(userinfo.slice(colonIdx + 1));
    } else {
      user = decodeURIComponent(userinfo);
    }
  }

  rest = rest.split(/[/?#]/)[0];
  let host = rest;
  let port = null;
  const portMatch = rest.match(/:(\d+)$/);
  if (portMatch) {
    port = parseInt(portMatch[1], 10);
    host = rest.slice(0, -portMatch[0].length);
  }

  if (!host) return null;

  const result = { host };
  if (scheme) result.scheme = scheme;
  if (port) result.port = port;
  if (user) result.user = user;
  if (pass !== undefined) result.pass = pass;
  return result;
}

function ensureProxyObject() {
  if (!state.proxy) {
    state.proxy = { host: '', port: 0, scheme: 'http', user: '', pass: '' };
  }
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
        result.innerHTML = `\u2713 Proxy reachable<br>IP: ${res.ip || '?'}<br>Country: ${res.country || '?'}<br>Latency: ${res.latencyMs} ms`;
      } else {
        result.innerHTML = `\u2713 Gemini reachable<br>HTTP ${res.httpStatus}<br>Latency: ${res.latencyMs} ms`;
      }
      state = await loadState();
    } else {
      result.className = 'result-block err';
      result.textContent = `\u2717 ${res.error}`;
    }
  } finally {
    btnProxy.disabled = false;
    btnGemini.disabled = false;
  }
}

// --- First-run screen ---

function bindFirstRun() {
  $('#firstrun-open-settings').addEventListener('click', () => {
    ensureProxyObject();
    showSettings();
  });
}

init();

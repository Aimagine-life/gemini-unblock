import { loadState, saveState } from '../lib/storage.js';
import { parseEntry, ValidationError } from '../lib/domain.js';
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

  // Custom list
  const list = $('#custom-list');
  list.innerHTML = '';
  for (const entry of state.customDomains) {
    const item = document.createElement('div');
    item.className = 'custom-item';
    const display = entry.mode === 'wildcard'
      ? `*.${entry.value}`
      : entry.mode === 'exact'
        ? `=${entry.value}`
        : entry.value;
    item.innerHTML = `
      <div class="dot"></div>
      <div class="value">${escapeHtml(display)}</div>
      <button class="remove" type="button" title="Remove">\u00d7</button>
    `;
    item.querySelector('.remove').addEventListener('click', () => removeCustom(entry));
    list.appendChild(item);
  }
}

function bindMain() {
  $('#master-toggle').addEventListener('change', async (e) => {
    state.enabled = e.target.checked;
    await persist();
    renderMain();
  });

  $('#open-settings').addEventListener('click', () => showSettings());

  $('#add-domain-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#add-domain-input');
    const errEl = $('#add-domain-error');
    errEl.hidden = true;
    try {
      const entry = parseEntry(input.value);
      // Dedupe
      const exists = state.customDomains.find(
        (x) => x.value === entry.value && x.mode === entry.mode
      );
      if (exists) {
        errEl.textContent = 'Already in list';
        errEl.hidden = false;
        return;
      }
      state.customDomains.push(entry);
      await persist();
      input.value = '';
      renderMain();
    } catch (err) {
      if (err instanceof ValidationError) {
        errEl.textContent = err.message;
        errEl.hidden = false;
      } else {
        throw err;
      }
    }
  });
}

async function togglePreset(key) {
  state.presets[key].enabled = !state.presets[key].enabled;
  await persist();
  renderMain();
}

async function removeCustom(entry) {
  state.customDomains = state.customDomains.filter(
    (x) => !(x.value === entry.value && x.mode === entry.mode)
  );
  await persist();
  renderMain();
}

async function persist() {
  await saveState(state);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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

  const fields = [
    ['#cfg-host', 'host', (v) => v.trim()],
    ['#cfg-port', 'port', (v) => parseInt(v, 10) || 0],
    ['#cfg-user', 'user', (v) => v],
    ['#cfg-pass', 'pass', (v) => v],
  ];
  for (const [sel, key, parse] of fields) {
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

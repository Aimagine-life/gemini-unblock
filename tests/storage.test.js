import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock chrome.storage.local for the duration of these tests.
let mockStore = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (key) => Promise.resolve(key in mockStore ? { [key]: mockStore[key] } : {}),
      set: (obj) => { Object.assign(mockStore, obj); return Promise.resolve(); },
      clear: () => { mockStore = {}; return Promise.resolve(); },
    },
  },
};

const { loadState, saveState, getDefaultState } = await import('../extension/lib/storage.js');

test('getDefaultState: schemaVersion is 1', () => {
  assert.equal(getDefaultState().schemaVersion, 1);
});

test('getDefaultState: enabled is false', () => {
  assert.equal(getDefaultState().enabled, false);
});

test('getDefaultState: proxy is null', () => {
  assert.equal(getDefaultState().proxy, null);
});

test('getDefaultState: gemini and aiStudio presets enabled by default', () => {
  const s = getDefaultState();
  assert.equal(s.presets.gemini.enabled, true);
  assert.equal(s.presets.aiStudio.enabled, true);
  assert.equal(s.presets.chatgpt.enabled, false);
});

test('getDefaultState: youtube preset includes preview/image domains', () => {
  const domains = getDefaultState().presets.youtube.domains;
  assert.equal(domains.includes('ytimg.com'), true);
  assert.equal(domains.includes('ggpht.com'), true);
});

test('loadState: returns default state when storage empty', async () => {
  await chrome.storage.local.clear();
  const s = await loadState();
  assert.equal(s.schemaVersion, 1);
  assert.equal(s.enabled, false);
});

test('loadState/saveState: round-trip preserves data', async () => {
  await chrome.storage.local.clear();
  const original = getDefaultState();
  original.enabled = true;
  original.proxy = { host: '1.2.3.4', port: 1080, scheme: 'http', user: '', pass: '' };
  await saveState(original);
  const loaded = await loadState();
  assert.deepEqual(loaded, original);
});

test('loadState: merges newly added domains into existing preset', async () => {
  await chrome.storage.local.clear();
  const oldState = getDefaultState();
  oldState.presets.youtube.domains = ['youtube.com', 'www.youtube.com', 'youtu.be', 'googlevideo.com'];
  await saveState(oldState);

  const loaded = await loadState();
  assert.equal(loaded.presets.youtube.domains.includes('ytimg.com'), true);
  assert.equal(loaded.presets.youtube.domains.includes('ggpht.com'), true);
});

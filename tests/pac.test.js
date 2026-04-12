import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPacScript } from '../extension/lib/pac.js';

function makeState(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    proxy: { host: '5.9.12.34', port: 1080, scheme: 'http', user: '', pass: '' },
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: true,  domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: ['notebooklm.google.com'] },
      chatgpt:    { enabled: false, domains: ['chatgpt.com'] },
      claude:     { enabled: false, domains: ['claude.ai'] },
      perplexity: { enabled: false, domains: ['perplexity.ai'] },
    },
    customDomains: [],
    ...overrides,
  };
}

test('buildPacScript: returns null when disabled', () => {
  assert.equal(buildPacScript(makeState({ enabled: false })), null);
});

test('buildPacScript: returns null when no proxy configured', () => {
  assert.equal(buildPacScript(makeState({ proxy: null })), null);
});

test('buildPacScript: HTTP proxy directive for gemini.google.com', () => {
  const pac = buildPacScript(makeState());
  assert.match(pac, /function FindProxyForURL/);
  assert.match(pac, /"gemini\.google\.com"/);
  assert.match(pac, /PROXY 5\.9\.12\.34:1080/);
  assert.match(pac, /return "DIRECT"/);
});

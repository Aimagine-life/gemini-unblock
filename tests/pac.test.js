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

test('buildPacScript: HTTPS scheme', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: 'p.example.com', port: 443, scheme: 'https' },
  }));
  assert.match(pac, /HTTPS p\.example\.com:443/);
});

test('buildPacScript: SOCKS5 scheme has fallback to SOCKS', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: '1.2.3.4', port: 1080, scheme: 'socks5' },
  }));
  assert.match(pac, /SOCKS5 1\.2\.3\.4:1080; SOCKS 1\.2\.3\.4:1080/);
});

test('buildPacScript: SOCKS4 scheme', () => {
  const pac = buildPacScript(makeState({
    proxy: { host: '1.2.3.4', port: 1080, scheme: 'socks4' },
  }));
  assert.match(pac, /SOCKS 1\.2\.3\.4:1080/);
});

test('buildPacScript: never includes ; DIRECT fallback after proxy directive', () => {
  const pac = buildPacScript(makeState());
  assert.equal(pac.includes('; DIRECT'), false);
});

test('buildPacScript: custom suffix domain routed', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'huggingface.co', mode: 'suffix' }],
  }));
  assert.match(pac, /"huggingface\.co"/);
  assert.match(pac, /var suffixes = \[.*"huggingface\.co".*\]/);
});

test('buildPacScript: custom wildcard domain in wildcards array', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'anthropic.com', mode: 'wildcard' }],
  }));
  assert.match(pac, /var wildcards = \["anthropic\.com"\]/);
});

test('buildPacScript: custom exact domain in exacts array', () => {
  const pac = buildPacScript(makeState({
    customDomains: [{ value: 'example.com', mode: 'exact' }],
  }));
  assert.match(pac, /var exacts = \["example\.com"\]/);
});

test('buildPacScript: googleAuth auto-coupled when AI preset enabled', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: true,  domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: false, domains: [] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
  }));
  assert.match(pac, /"accounts\.google\.com"/);
});

test('buildPacScript: googleAuth NOT included when no AI preset enabled', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: false, domains: ['gemini.google.com'] },
      aiStudio:   { enabled: false, domains: ['aistudio.google.com'] },
      googleAuth: { enabled: false, domains: ['accounts.google.com'] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: true,  domains: ['chatgpt.com'] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
    customDomains: [],
  }));
  assert.equal(pac.includes('accounts.google.com'), false);
});

test('buildPacScript: returns null when no domains routed', () => {
  const pac = buildPacScript(makeState({
    presets: {
      gemini:     { enabled: false, domains: [] },
      aiStudio:   { enabled: false, domains: [] },
      googleAuth: { enabled: false, domains: [] },
      notebookLM: { enabled: false, domains: [] },
      chatgpt:    { enabled: false, domains: [] },
      claude:     { enabled: false, domains: [] },
      perplexity: { enabled: false, domains: [] },
    },
    customDomains: [],
  }));
  assert.equal(pac, null);
});

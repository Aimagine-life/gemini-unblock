import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, ValidationError } from '../extension/lib/domain.js';

test('normalizeDomain: lowercases', () => {
  assert.equal(normalizeDomain('GEMINI.Google.COM'), 'gemini.google.com');
});

test('normalizeDomain: trims whitespace', () => {
  assert.equal(normalizeDomain('  example.com  '), 'example.com');
});

test('normalizeDomain: strips http scheme', () => {
  assert.equal(normalizeDomain('http://example.com'), 'example.com');
});

test('normalizeDomain: strips https scheme', () => {
  assert.equal(normalizeDomain('https://example.com'), 'example.com');
});

test('normalizeDomain: strips protocol-relative scheme', () => {
  assert.equal(normalizeDomain('//example.com'), 'example.com');
});

test('normalizeDomain: strips path', () => {
  assert.equal(normalizeDomain('example.com/foo/bar'), 'example.com');
});

test('normalizeDomain: strips query', () => {
  assert.equal(normalizeDomain('example.com?x=1'), 'example.com');
});

test('normalizeDomain: strips fragment', () => {
  assert.equal(normalizeDomain('example.com#anchor'), 'example.com');
});

test('normalizeDomain: strips port', () => {
  assert.equal(normalizeDomain('example.com:8080'), 'example.com');
});

test('normalizeDomain: strips userinfo', () => {
  assert.equal(normalizeDomain('user:pass@example.com'), 'example.com');
});

test('normalizeDomain: strips trailing dot', () => {
  assert.equal(normalizeDomain('example.com.'), 'example.com');
});

test('normalizeDomain: full URL with everything', () => {
  assert.equal(
    normalizeDomain('  HTTPS://user:pass@HuggingFace.co:443/spaces/foo?x=1#hash  '),
    'huggingface.co'
  );
});

test('normalizeDomain: throws on empty', () => {
  assert.throws(() => normalizeDomain(''), ValidationError);
  assert.throws(() => normalizeDomain('   '), ValidationError);
});

test('normalizeDomain: IDN to punycode', () => {
  assert.equal(normalizeDomain('яндекс.рф'), 'xn--d1acpjx3f.xn--p1ai');
});

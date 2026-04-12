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

import { validateNormalized } from '../extension/lib/domain.js';

test('validateNormalized: rejects empty', () => {
  assert.equal(validateNormalized(''), false);
});

test('validateNormalized: rejects bare label (no dot)', () => {
  assert.equal(validateNormalized('localhost'), false);
  assert.equal(validateNormalized('example'), false);
});

test('validateNormalized: accepts plain domain', () => {
  assert.equal(validateNormalized('example.com'), true);
  assert.equal(validateNormalized('a.b.c.example.com'), true);
});

test('validateNormalized: accepts IPv4', () => {
  assert.equal(validateNormalized('192.168.1.1'), true);
  assert.equal(validateNormalized('10.0.0.1'), true);
});

test('validateNormalized: rejects bad IPv4', () => {
  assert.equal(validateNormalized('999.0.0.1'), false);
  assert.equal(validateNormalized('1.2.3'), false);
});

test('validateNormalized: rejects label too long', () => {
  const longLabel = 'a'.repeat(64);
  assert.equal(validateNormalized(`${longLabel}.com`), false);
});

test('validateNormalized: rejects label with leading hyphen', () => {
  assert.equal(validateNormalized('-bad.com'), false);
});

test('validateNormalized: rejects label with trailing hyphen', () => {
  assert.equal(validateNormalized('bad-.com'), false);
});

test('validateNormalized: accepts punycode (xn--)', () => {
  assert.equal(validateNormalized('xn--d1acpjx3f.xn--p1ai'), true);
});

test('validateNormalized: rejects total length > 253', () => {
  const longDomain = ('a'.repeat(60) + '.').repeat(5) + 'com';
  assert.equal(validateNormalized(longDomain), false);
});

import { parseEntry } from '../extension/lib/domain.js';

test('parseEntry: plain domain → suffix mode', () => {
  assert.deepEqual(parseEntry('example.com'), { value: 'example.com', mode: 'suffix' });
});

test('parseEntry: leading *. → wildcard mode', () => {
  assert.deepEqual(parseEntry('*.example.com'), { value: 'example.com', mode: 'wildcard' });
});

test('parseEntry: leading = → exact mode', () => {
  assert.deepEqual(parseEntry('=example.com'), { value: 'example.com', mode: 'exact' });
});

test('parseEntry: normalizes URL form', () => {
  assert.deepEqual(parseEntry('https://Example.COM/foo'), { value: 'example.com', mode: 'suffix' });
});

test('parseEntry: normalizes wildcard URL form', () => {
  assert.deepEqual(parseEntry('*.https://Example.COM'), { value: 'example.com', mode: 'wildcard' });
});

test('parseEntry: throws on garbage', () => {
  assert.throws(() => parseEntry(''), ValidationError);
  assert.throws(() => parseEntry('not a domain'), ValidationError);
  assert.throws(() => parseEntry('localhost'), ValidationError);
});

test('parseEntry: rejects wildcard-of-exact (*.=...)', () => {
  assert.throws(() => parseEntry('*.=foo.com'), ValidationError);
});

test('parseEntry: rejects exact-of-wildcard (=*...)', () => {
  assert.throws(() => parseEntry('=*.foo.com'), ValidationError);
});

test('parseEntry: rejects double wildcard (*.*...)', () => {
  assert.throws(() => parseEntry('*.*.foo.com'), ValidationError);
});

test('parseEntry: rejects bare *.', () => {
  assert.throws(() => parseEntry('*.'), ValidationError);
});

test('parseEntry: rejects bare =', () => {
  assert.throws(() => parseEntry('='), ValidationError);
});

test('normalizeDomain: rejects IPv6 literal in brackets', () => {
  assert.throws(() => normalizeDomain('[::1]'), ValidationError);
  assert.throws(() => normalizeDomain('http://[::1]/'), ValidationError);
});

test('parseEntry: rejects IPv6 literal', () => {
  assert.throws(() => parseEntry('[::1]'), ValidationError);
});

test('validateNormalized: rejects IPv4 with leading zeros', () => {
  assert.equal(validateNormalized('01.02.03.04'), false);
  assert.equal(validateNormalized('192.168.001.001'), false);
});

test('validateNormalized: accepts IPv4 0.0.0.0 and 255.255.255.255', () => {
  assert.equal(validateNormalized('0.0.0.0'), true);
  assert.equal(validateNormalized('255.255.255.255'), true);
});

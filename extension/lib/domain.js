// Pure module — no chrome.* APIs allowed.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Normalize a user-entered hostname. Strips scheme, path, query, port, userinfo.
 * Lowercases. Converts IDN labels to punycode. Throws ValidationError if input
 * cannot be reduced to a hostname.
 */
export function normalizeDomain(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) throw new ValidationError('empty input');

  // Strip scheme: anything matching scheme:// or just //
  s = s.replace(/^[a-z][a-z0-9+.\-]*:\/\//, '');
  s = s.replace(/^\/\//, '');

  // Strip userinfo (user:pass@). Note: must run AFTER scheme strip and BEFORE path strip.
  // Match anything up to and including @, but only if there's no / before it.
  const atIdx = s.indexOf('@');
  const slashIdx = s.indexOf('/');
  if (atIdx !== -1 && (slashIdx === -1 || atIdx < slashIdx)) {
    s = s.slice(atIdx + 1);
  }

  // Strip path / query / fragment — anything from first /, ?, or #
  s = s.split(/[/?#]/, 1)[0];

  // Strip port (:digits at end)
  s = s.replace(/:\d+$/, '');

  // Trailing dot
  s = s.replace(/\.+$/, '');

  if (!s) throw new ValidationError('empty after normalization');

  // IDN to punycode via the URL parser
  try {
    const u = new URL('http://' + s + '/');
    s = u.hostname;
  } catch {
    throw new ValidationError(`not a valid hostname: ${input}`);
  }

  // The URL parser accepts IPv6 literals and returns them in bracket form
  // (e.g. "[::1]"). We don't support IPv6 in v1 — reject explicitly so the
  // caller doesn't see a bracketed string sneak through as "normalized".
  if (s.startsWith('[')) {
    throw new ValidationError('IPv6 literals are not supported');
  }

  return s;
}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function isIPv4(s) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return false;
  return s.split('.').every((n) => {
    if (n.length > 1 && n.startsWith('0')) return false;
    const v = Number(n);
    return v >= 0 && v <= 255;
  });
}

/**
 * Returns true if the (already normalized) hostname is structurally valid:
 * non-empty, ≤ 253 chars, contains a dot, every label conforms to DNS rules
 * (or it's an IPv4 literal).
 *
 * Special-case: if the input contains only digits and dots, it must parse
 * as a valid IPv4 — otherwise it's almost certainly a typo'd IP attempt
 * (e.g. "999.0.0.1", "1.2.3") and we reject it. Without this guard, those
 * inputs would slip through as "valid hostnames" since digit-only labels
 * are technically legal DNS labels, leaving the user with broken routing
 * that silently never matches anything.
 */
export function validateNormalized(domain) {
  if (!domain || typeof domain !== 'string') return false;
  if (domain.length > 253) return false;

  // Looks IPv4-ish? Must be a real IPv4 then.
  if (/^[\d.]+$/.test(domain)) {
    return isIPv4(domain);
  }

  if (!domain.includes('.')) return false;

  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return false;
    if (!LABEL_RE.test(label)) return false;
  }
  return true;
}

/**
 * Parse a user-entered entry into { value, mode }. Recognizes leading *.  and =
 * prefixes for wildcard and exact match modes; otherwise defaults to suffix mode.
 * Normalizes and validates the resulting hostname. Throws ValidationError on bad input.
 */
export function parseEntry(input) {
  let raw = String(input ?? '').trim();
  if (!raw) throw new ValidationError('empty input');

  let mode = 'suffix';
  if (raw.startsWith('*.')) {
    mode = 'wildcard';
    raw = raw.slice(2);
  } else if (raw.startsWith('=')) {
    mode = 'exact';
    raw = raw.slice(1);
  }

  const value = normalizeDomain(raw);
  if (!validateNormalized(value)) {
    throw new ValidationError(`invalid hostname: ${input}`);
  }
  return { value, mode };
}

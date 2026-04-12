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

  return s;
}

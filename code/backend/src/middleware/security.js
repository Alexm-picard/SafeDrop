// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: helmet headers incl. HSTS (SR-5); JSON-only + Origin/Referer/Fetch-Metadata check for state-changing requests (SDD §6.3)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import helmet from 'helmet';
import { ForbiddenError, UnsupportedMediaTypeError } from '../utils/errors.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The API only serves JSON, so the CSP can be as tight as it gets. HSTS is on by default in helmet. */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
});

/**
 * Chain step 3: state-changing requests must declare `Content-Type: application/json`.
 * A cross-site HTML form cannot send that content type, which closes the classic CSRF vector
 * alongside SameSite=Lax cookies and the origin check below.
 */
export function requireJsonForStateChanges(req, _res, next) {
  if (!STATE_CHANGING.has(req.method)) {
    return next();
  }
  const contentType = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    return next(new UnsupportedMediaTypeError());
  }
  return next();
}

function originOfReferer(referer) {
  try {
    return new URL(referer).origin;
  } catch (_err) {
    return null;
  }
}

/**
 * Chain step 3 (second half). For state-changing requests the browser-supplied origin must be ours:
 *  1. `Origin` header present → must be in the allowlist (`null` is never allowed).
 *  2. Otherwise `Referer` present → its origin must be in the allowlist.
 *  3. Otherwise `Sec-Fetch-Site: cross-site` → rejected.
 *  4. Otherwise (no browser metadata at all: curl, server-to-server, tests) → allowed.
 * @param {string[]} allowlist
 */
export function createOriginCheck(allowlist) {
  const allowed = new Set(allowlist);
  return function verifyOrigin(req, _res, next) {
    if (!STATE_CHANGING.has(req.method)) {
      return next();
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      return allowed.has(origin) ? next() : next(new ForbiddenError('Origin not allowed'));
    }
    const referer = req.headers.referer;
    if (referer !== undefined) {
      const refererOrigin = originOfReferer(referer);
      return refererOrigin && allowed.has(refererOrigin)
        ? next()
        : next(new ForbiddenError('Origin not allowed'));
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      return next(new ForbiddenError('Origin not allowed'));
    }
    return next();
  };
}

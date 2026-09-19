// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: helmet headers incl. HSTS (SR-5); JSON-only + Origin/Referer/Fetch-Metadata check for state-changing requests (SDD §6.3)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Chain step 3: security response headers and the two CSRF defences that do not need a token.
 *
 * SafeDrop keeps its session in cookies, so it needs an answer to cross-site request forgery. Rather
 * than a synchroniser token, three cheap layers are combined: `SameSite=Lax` on the cookies
 * (see utils/tokens.js), a required JSON content type, and an origin check. A cross-site HTML form —
 * the classic CSRF vector — can send neither `Content-Type: application/json` nor a same-origin
 * `Origin` header, so it is refused twice over.
 *
 * Exports:
 *  - `securityHeaders` — the helmet configuration.
 *  - `requireJsonForStateChanges` — reject state-changing requests that are not JSON.
 *  - `createOriginCheck(allowlist)` — reject state-changing requests from a foreign origin.
 */
import helmet from 'helmet';
import { ForbiddenError, UnsupportedMediaTypeError } from '../utils/errors.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Helmet configuration for a JSON-only API.
 *
 * Because the API never serves HTML, the CSP can be as tight as it gets: nothing may load, nothing
 * may frame it, no form may target it. HSTS is set for a year including subdomains, the referrer is
 * never sent, and resources are same-origin only.
 */
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
 * Require `Content-Type: application/json` on POST, PUT, PATCH and DELETE.
 *
 * An HTML form can only send `application/x-www-form-urlencoded`, `multipart/form-data` or
 * `text/plain`, so demanding JSON means a form on an attacker's page cannot reach a state-changing
 * endpoint at all. Safe methods pass through untouched. Parameters after the media type (`; charset=utf-8`)
 * are stripped before comparison, so a legitimate client is not rejected on a technicality.
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 * @returns {void} calls `next(UnsupportedMediaTypeError)` (415) when the type is wrong
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

/**
 * Extract the origin from a Referer header, or null if it will not parse.
 *
 * A malformed Referer must not throw — and must not be treated as trusted either, hence null rather
 * than a fallback.
 * @param {string} referer
 * @returns {string|null}
 */
function originOfReferer(referer) {
  try {
    return new URL(referer).origin;
  } catch (_err) {
    return null;
  }
}

/**
 * Build the origin check for state-changing requests.
 *
 * The browser-supplied origin, when there is one, must be ours. The checks are tried in descending
 * order of trustworthiness:
 *
 *  1. `Origin` present → must be in the allowlist. The literal string `null` (sandboxed iframe,
 *     some redirects) is never in the allowlist, so it is refused.
 *  2. Otherwise `Referer` present → its origin must be in the allowlist.
 *  3. Otherwise `Sec-Fetch-Site: cross-site` → refused.
 *  4. Otherwise no browser metadata at all (curl, server-to-server, tests) → allowed.
 *
 * Step 4 is deliberate: a non-browser client is not subject to CSRF, because there is no ambient
 * cookie for an attacker to ride on. Safe methods skip the check entirely.
 * @param {string[]} allowlist exact origins to accept
 * @returns {import('express').RequestHandler} calls `next(ForbiddenError)` (403) on a foreign origin
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

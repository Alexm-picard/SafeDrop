// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: access-cookie verification with pinned algorithm; req.auth = { userId, orgId, role } (SDD §6.2)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Chain step 5: turn the access cookie into a verified identity, or refuse the request.
 *
 * Mounted under `/api`. The three public routes (login, refresh, first-admin bootstrap) pass through
 * untouched; everything else must present a valid access token. What this middleware writes to
 * `req.auth` is the *only* source of identity, tenant and role for the rest of the request — nothing
 * downstream may take any of those from the URL, the query string or the body.
 *
 * `req.auth` is frozen precisely so a later handler cannot quietly promote the caller.
 */
import { AuthError } from '../utils/errors.js';
import { isPublicRoute, normalizePath } from '../utils/permissions.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../utils/tokens.js';

/**
 * Build the authenticate middleware.
 *
 * The token is read from an `httpOnly` cookie rather than an `Authorization` header, so it is not
 * reachable from JavaScript and XSS cannot exfiltrate the session. Any verification failure becomes
 * a 401 `AuthError` with the reason kept in `cause` for the logs.
 *
 * The public-route test uses `req.originalUrl`, not `req.url`: Express rewrites `req.url` relative
 * to the mount point, so matching on it would compare a path that no longer has the `/api` prefix
 * the allowlist is written in.
 *
 * The factory exists so unit tests can inject a verifier instead of minting real JWTs.
 * @param {{ verify?: typeof verifyAccessToken }} [deps] injectable for unit tests
 * @returns {import('express').RequestHandler}
 */
export function createAuthenticate({ verify = verifyAccessToken } = {}) {
  return function authenticate(req, _res, next) {
    const fullPath = normalizePath(req.originalUrl ?? req.url ?? '');
    if (isPublicRoute(req.method, fullPath)) {
      return next();
    }
    const token = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      return next(new AuthError('Authentication required'));
    }
    let claims;
    try {
      claims = verify(token);
    } catch (err) {
      return next(err instanceof AuthError ? err : new AuthError('Invalid access token', err));
    }
    req.auth = Object.freeze({ userId: claims.userId, orgId: claims.orgId, role: claims.role });
    return next();
  };
}

export const authenticate = createAuthenticate();

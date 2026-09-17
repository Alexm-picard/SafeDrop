// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: access-cookie verification with pinned algorithm; req.auth = { userId, orgId, role } (SDD §6.2)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { AuthError } from '../utils/errors.js';
import { isPublicRoute, normalizePath } from '../utils/permissions.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../utils/tokens.js';

/**
 * Chain step 5. Mounted under /api. The three public routes (login, refresh, first-admin bootstrap)
 * pass through untouched; every other request must carry a valid access cookie.
 * The verified claims are the ONLY source of identity and tenant for the rest of the request.
 * @param {{ verify?: typeof verifyAccessToken }} [deps] injectable for unit tests
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

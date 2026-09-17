// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: deny-by-default permission gate enforced at response time; per-route authorize(permission) from utils/permissions.js (SDD §6.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

import { AuthError, ForbiddenError } from '../utils/errors.js';
import { isKnownPermission, roleHasPermission } from '../utils/permissions.js';

export const GATE = Object.freeze({ DENIED: 'denied', GRANTED: 'granted', PUBLIC: 'public' });

const GATE_MESSAGE = 'No authorization decision was made for this route';

/**
 * Chain step 7 (global half). Every /api request starts denied. Only a route-level authorize() or
 * markPublic() flips the gate. The response methods are wrapped so that ANY handler that tries to
 * send a success response while the gate is still denied (a rogue `router.use()`, a route registered
 * without defineRoute(), a mounted sub-app) gets a 403 instead — deny-by-default holds at runtime,
 * not only by convention. Error responses (status >= 400) always pass so 401/404/500 still work.
 */
export function denyByDefault(req, res, next) {
  res.locals.permissionGate = GATE.DENIED;
  res.locals.permission = null;

  const original = { json: res.json, send: res.send, end: res.end };
  const intercept = (name) =>
    function gatedResponse(...args) {
      if (
        !res.locals.permissionGateTripped &&
        res.statusCode < 400 &&
        res.locals.permissionGate === GATE.DENIED
      ) {
        res.locals.permissionGateTripped = true;
        res.status(403);
        return original.json.call(res, {
          error: { code: 'FORBIDDEN', message: GATE_MESSAGE, requestId: req.id },
        });
      }
      return original[name].apply(res, args);
    };
  res.json = intercept('json');
  res.send = intercept('send');
  res.end = intercept('end');
  next();
}

/**
 * Chain step 7 (route half). Built once per route by routes/define.js. Throws at registration time
 * for an unknown/missing permission so a route without a declared permission cannot even boot.
 * @param {string} permission one of utils/permissions.js PERMISSIONS
 */
export function authorize(permission) {
  if (!isKnownPermission(permission)) {
    throw new TypeError(
      `authorize(): "${permission}" is not a declared permission. Add it to utils/permissions.js ROLE_PERMISSIONS.`,
    );
  }
  const middleware = function authorize(req, res, next) {
    if (!req.auth) {
      return next(new AuthError('Authentication required'));
    }
    if (!roleHasPermission(req.auth.role, permission)) {
      return next(new ForbiddenError('You do not have permission to do that'));
    }
    res.locals.permissionGate = GATE.GRANTED;
    res.locals.permission = permission;
    return next();
  };
  middleware.permission = permission;
  return middleware;
}

/** Marks one of the three public routes; used by routes/define.js for `public: true`. */
export function markPublic() {
  const middleware = function markPublic(_req, res, next) {
    res.locals.permissionGate = GATE.PUBLIC;
    next();
  };
  middleware.isPublic = true;
  return middleware;
}

/** Helper for route listing: reads the permission a route's middleware declares, if any. */
export function readDeclaredPermission(handler) {
  if (!handler) {
    return { permission: null, isPublic: false };
  }
  return { permission: handler.permission ?? null, isPublic: handler.isPublic === true };
}

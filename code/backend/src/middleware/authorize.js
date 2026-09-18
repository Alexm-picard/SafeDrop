// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: deny-by-default permission gate enforced at response time; per-route authorize(permission) from utils/permissions.js (SDD §6.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Chain step 7: the authorization gate, in two halves.
 *
 * The *global* half (`denyByDefault`) starts every `/api` request in a denied state. The *route* half
 * (`authorize(permission)` or `markPublic()`) is the only thing that can flip it. A route that forgets
 * to declare a permission therefore fails closed instead of being open — the mistake that quietly
 * exposes an endpoint becomes a 403 rather than a leak (SR-1).
 *
 * This is enforced twice over: routes/define.js refuses at boot to register a route with no
 * declaration, and `denyByDefault` catches at response time anything that got registered some other
 * way.
 *
 * Exports:
 *  - `GATE` — the three gate states kept on `res.locals`.
 *  - `denyByDefault` — the global gate; wraps the response methods.
 *  - `authorize(permission)` — grant when the caller's role holds `permission`.
 *  - `markPublic()` — mark one of the three public routes.
 *  - `readDeclaredPermission(handler)` — read a route's declaration back, for route listings.
 */
import { AuthError, ForbiddenError } from '../utils/errors.js';
import { isKnownPermission, roleHasPermission } from '../utils/permissions.js';

export const GATE = Object.freeze({ DENIED: 'denied', GRANTED: 'granted', PUBLIC: 'public' });

const GATE_MESSAGE = 'No authorization decision was made for this route';

/**
 * Start the request denied, and enforce that at the moment a response is sent.
 *
 * `res.json`, `res.send` and `res.end` are wrapped so that any handler trying to send a *success*
 * response while the gate is still denied gets a 403 instead. That covers the cases boot-time
 * checking cannot see: a stray `router.use()`, a route registered without `defineRoute()`, a mounted
 * sub-app.
 *
 * Two carve-outs keep this from breaking the rest of the API. Responses with status >= 400 always
 * pass, so 401, 404 and 500 still reach the client — an error is not something an unauthorized
 * caller can exploit. And `permissionGateTripped` guards against recursion, since the 403 it sends
 * is itself a `res.json` call.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
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
 * Build the per-route guard for one permission, and open the gate when the caller holds it.
 *
 * The permission is validated *at registration time*, not per request: a typo throws while the route
 * table is being built, so the server refuses to boot rather than running with a route nobody can
 * ever reach. The permission is also attached to the returned middleware so route listings and the
 * boot-time assertion can read back what each route declared.
 *
 * At request time it needs `req.auth` — authenticate() must have run first — and consults the role
 * matrix in utils/permissions.js. Missing identity is a 401, insufficient role a 403.
 * @param {string} permission one of utils/permissions.js PERMISSIONS
 * @returns {import('express').RequestHandler & { permission: string }}
 * @throws {TypeError} at registration time when the permission is not declared
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

/**
 * Build the marker for a route that may be called without a session.
 *
 * Used by routes/define.js for `public: true`, on the three routes in `PUBLIC_ROUTES`. It opens the
 * gate without any permission check, so that `denyByDefault` does not turn a legitimate public
 * response into a 403. Being explicit is the point: a route is public because someone wrote it down.
 * @returns {import('express').RequestHandler & { isPublic: true }}
 */
export function markPublic() {
  const middleware = function markPublic(_req, res, next) {
    res.locals.permissionGate = GATE.PUBLIC;
    next();
  };
  middleware.isPublic = true;
  return middleware;
}

/**
 * Read back what a route's middleware declared.
 *
 * Used by the boot-time route assertion and by route listings to answer "what does this route
 * require?" without re-deriving it. An absent handler answers as neither public nor permitted.
 * @param {Function} [handler] a middleware built by `authorize()` or `markPublic()`
 * @returns {{ permission: string|null, isPublic: boolean }}
 */
export function readDeclaredPermission(handler) {
  if (!handler) {
    return { permission: null, isPublic: false };
  }
  return { permission: handler.permission ?? null, isPublic: handler.isPublic === true };
}

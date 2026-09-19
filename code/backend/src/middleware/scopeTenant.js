// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: req.orgId from the verified token only; client-supplied orgId is stripped everywhere (SR-2, SDD §6.4)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Chain step 6: fix the tenant from the verified token, and delete any tenant the client supplied.
 *
 * This is the single mechanism behind tenant isolation (SR-2). `req.orgId` is copied from the
 * verified access token and becomes the first argument to every repository call, while `orgId`,
 * `organizationId` and `org` are stripped from params, query and body — so a request that tries to
 * name another organisation does not get a 403, it simply has that input erased before any handler
 * can read it.
 *
 * The complement to this is in routes/define.js, which refuses to register a route with an `:orgId`
 * parameter at all.
 */
const TENANT_KEYS = ['orgId', 'organizationId', 'org'];

/**
 * Return a shallow copy of `obj` without any of the tenant keys.
 *
 * A copy rather than an in-place delete, because `req.query` in Express 5 is not necessarily a
 * plain, writable object.
 * @param {unknown} obj
 * @returns {unknown} the object without tenant keys, or the input unchanged when it is not an object
 */
function stripKeys(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  const copy = { ...obj };
  for (const key of TENANT_KEYS) {
    delete copy[key];
  }
  return copy;
}

/**
 * Strip client-supplied tenant keys, then set `req.orgId` from the verified token.
 *
 * `req.query` needs `Object.defineProperty` rather than assignment: Express 5 exposes it through a
 * prototype getter, so a plain assignment would be silently dropped and the smuggled key would
 * survive. `req.body` is only rewritten when it is a non-array object, since an array body has no
 * keys to strip.
 *
 * `req.orgId` is set only when `req.auth` exists, so a public route never acquires a tenant it did
 * not authenticate for.
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
export function scopeTenant(req, _res, next) {
  if (req.params && typeof req.params === 'object') {
    req.params = stripKeys(req.params);
  }
  if (req.query && typeof req.query === 'object') {
    // Express 5 exposes req.query through a prototype getter; an own property shadows it.
    Object.defineProperty(req, 'query', {
      value: stripKeys(req.query),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body = stripKeys(req.body);
  }
  if (req.auth) {
    req.orgId = req.auth.orgId;
  }
  next();
}

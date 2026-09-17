// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: req.orgId from the verified token only; client-supplied orgId is stripped everywhere (SR-2, SDD §6.4)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

const TENANT_KEYS = ['orgId', 'organizationId', 'org'];

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
 * Chain step 6. Copies the tenant from the verified token to `req.orgId` and removes any tenant
 * identifier the client tried to smuggle in params, query or body. Repositories receive `req.orgId`
 * as their first argument; nothing downstream ever reads a tenant from user input.
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

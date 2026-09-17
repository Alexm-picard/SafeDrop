// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: role → permission matrix from SDD §6.4 / SR-1; public-route allowlist
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
//
// This file is the single authorization policy. Routes declare a permission (never a role); the
// authorize middleware answers "does this role hold this permission?". Deny by default: a permission
// missing from this map is unknown and authorize() refuses to build a route for it.

export const ROLES = Object.freeze({
  MEMBER: 'MEMBER',
  APPROVER: 'APPROVER',
  ORG_ADMIN: 'ORG_ADMIN',
});
export const ROLE_LIST = Object.freeze(Object.values(ROLES));

export const PERMISSIONS = Object.freeze({
  ASSETS_READ: 'assets:read',
  ASSETS_WRITE: 'assets:write',
  REQUESTS_CREATE: 'requests:create',
  REQUESTS_READ_OWN: 'requests:read:own',
  REQUESTS_DECIDE: 'requests:decide',
  REQUESTS_HANDOFF: 'requests:handoff',
  USERS_MANAGE: 'users:manage',
  AUDIT_READ: 'audit:read',
  DASHBOARD_READ: 'dashboard:read',
  /** Any authenticated user may read/end their own session (GET /api/auth/me, POST /api/auth/logout). */
  SESSION_SELF: 'session:self',
});
export const PERMISSION_LIST = Object.freeze(Object.values(PERMISSIONS));
export const ALL_PERMISSIONS = new Set(PERMISSION_LIST);

const MEMBER_PERMISSIONS = [
  PERMISSIONS.ASSETS_READ,
  PERMISSIONS.REQUESTS_CREATE,
  PERMISSIONS.REQUESTS_READ_OWN,
  PERMISSIONS.SESSION_SELF,
];
const APPROVER_PERMISSIONS = [
  ...MEMBER_PERMISSIONS,
  PERMISSIONS.REQUESTS_DECIDE,
  PERMISSIONS.REQUESTS_HANDOFF,
];
const ORG_ADMIN_PERMISSIONS = [
  ...APPROVER_PERMISSIONS,
  PERMISSIONS.ASSETS_WRITE,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.DASHBOARD_READ,
];

/** SDD §6.4 permission matrix. */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.MEMBER]: Object.freeze(new Set(MEMBER_PERMISSIONS)),
  [ROLES.APPROVER]: Object.freeze(new Set(APPROVER_PERMISSIONS)),
  [ROLES.ORG_ADMIN]: Object.freeze(new Set(ORG_ADMIN_PERMISSIONS)),
});

/**
 * @param {string} role
 * @param {string} permission
 * @returns {boolean} false for unknown roles or permissions (deny by default)
 */
export function roleHasPermission(role, permission) {
  const granted = ROLE_PERMISSIONS[role];
  return Boolean(granted) && granted.has(permission);
}

export function isKnownPermission(permission) {
  return ALL_PERMISSIONS.has(permission);
}

/**
 * The only routes that skip authenticate → scopeTenant → authorize (SDD §3 chain, step 5).
 * Everything else under /api requires a valid access token.
 */
export const PUBLIC_ROUTES = Object.freeze([
  Object.freeze({ method: 'POST', path: '/api/auth/login' }),
  Object.freeze({ method: 'POST', path: '/api/auth/refresh' }),
  Object.freeze({ method: 'POST', path: '/api/organizations' }),
]);

export function normalizePath(path) {
  const withoutQuery = String(path).split('?')[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}

/**
 * @param {string} method
 * @param {string} path full path including the /api prefix
 */
export function isPublicRoute(method, path) {
  const m = String(method).toUpperCase();
  const p = normalizePath(path);
  return PUBLIC_ROUTES.some((route) => route.method === m && route.path === p);
}

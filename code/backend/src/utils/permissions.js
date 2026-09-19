// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: role → permission matrix from SDD §6.4 / SR-1; public-route allowlist; password:self permission
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog; extended for the emailed-invitation work. Must be reviewed and tested by the owning team member before merge.
//
// This file is the single authorization policy. Routes declare a permission (never a role); the
// authorize middleware answers "does this role hold this permission?". Deny by default: a permission
// missing from this map is unknown and authorize() refuses to build a route for it.

/**
 * The single authorization policy: roles, permissions, the role → permission matrix, and the
 * public-route allowlist (SDD §6.4, SR-1).
 *
 * Routes declare a *permission*, never a role, and the authorize middleware asks this module whether
 * the caller's role holds it. Keeping the matrix in one file means a role gains an ability by
 * editing one list here, and reviewers can read the whole policy in one place.
 *
 * The design is deny-by-default in both directions: an unknown role or permission answers `false`,
 * and a permission that is not in `PERMISSIONS` is rejected by `authorize()` when the route is built,
 * so a typo fails at boot rather than silently granting access.
 *
 * Roles are cumulative — APPROVER holds every MEMBER permission, ORG_ADMIN every APPROVER one.
 *
 * Exports:
 *  - `ROLES` / `ROLE_LIST` — the three roles.
 *  - `PERMISSIONS` / `PERMISSION_LIST` / `ALL_PERMISSIONS` — every permission a route may declare.
 *  - `ROLE_PERMISSIONS` — the matrix itself, role → Set of permissions.
 *  - `roleHasPermission(role, permission)` — the authorization question.
 *  - `isKnownPermission(permission)` — guard against a misspelled declaration.
 *  - `PUBLIC_ROUTES` / `isPublicRoute(method, path)` — the routes that skip authentication.
 *  - `normalizePath(path)` — path normalisation shared by the allowlist check.
 */
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
  /** Any authenticated user may change their own password (POST /api/auth/change-password). */
  PASSWORD_SELF: 'password:self',
});
export const PERMISSION_LIST = Object.freeze(Object.values(PERMISSIONS));
export const ALL_PERMISSIONS = new Set(PERMISSION_LIST);

const MEMBER_PERMISSIONS = [
  PERMISSIONS.ASSETS_READ,
  PERMISSIONS.REQUESTS_CREATE,
  PERMISSIONS.REQUESTS_READ_OWN,
  PERMISSIONS.SESSION_SELF,
  PERMISSIONS.PASSWORD_SELF,
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
 * Answer the authorization question: does `role` hold `permission`?
 *
 * This is the only place that consults the matrix. Unknown roles and unknown permissions both
 * answer `false`, so a corrupt token role or a typo in a route declaration denies rather than
 * grants.
 * @param {string} role role from the caller's access token
 * @param {string} permission permission declared by the route
 * @returns {boolean} false for unknown roles or permissions (deny by default)
 */
export function roleHasPermission(role, permission) {
  const granted = ROLE_PERMISSIONS[role];
  return Boolean(granted) && granted.has(permission);
}

/**
 * Is this string one of the permissions defined above?
 *
 * `authorize()` calls this while the route table is being built, so a route declaring a permission
 * that no role can ever hold — usually a typo — throws at boot instead of returning 403 forever.
 * @param {string} permission
 * @returns {boolean}
 */
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
  // The invitation token in the body is the credential: the invitee has no account yet (OD-3).
  Object.freeze({ method: 'POST', path: '/api/auth/accept-invite' }),
]);

/**
 * Reduce a request path to the form used for allowlist comparison.
 *
 * The query string is dropped and a trailing slash removed (except for the root path), so
 * `/api/auth/login?next=/x` and `/api/auth/login/` both match the allowlisted
 * `/api/auth/login` — and, just as importantly, cannot be used to *dodge* a check that the
 * unnormalised path would have matched.
 * @param {string} path
 * @returns {string} path without query string or trailing slash
 */
export function normalizePath(path) {
  const withoutQuery = String(path).split('?')[0];
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, '') : withoutQuery;
}

/**
 * Is this method + path one of the four routes that may be called without a session?
 *
 * The comparison is on the exact normalised path, not a prefix, so nothing under
 * `/api/auth/...` becomes public by accident.
 * @param {string} method HTTP method, any case
 * @param {string} path full path including the /api prefix
 * @returns {boolean}
 */
export function isPublicRoute(method, path) {
  const m = String(method).toUpperCase();
  const p = normalizePath(path);
  return PUBLIC_ROUTES.some((route) => route.method === m && route.path === p);
}

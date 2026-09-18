/**
 * Values shared across the SPA: the app name, roles and their labels, route paths, and ticket ids.
 *
 * The point is that no component hard-codes a path or a role string. `ROUTES` in particular means a
 * URL can change in one place instead of in every `<Link>`; the role names mirror the backend's, since
 * they arrive in the session.
 */
export const APP_NAME = 'SafeDrop';
/**
 * The three roles, mirroring the backend's `utils/permissions.js`.
 *
 * These are the values the API sends in the session, so they must stay identical to it. The frontend
 * uses them only for showing and hiding UI — every permission is enforced server-side (SR-1).
 */
export const ROLES = Object.freeze({
  MEMBER: 'MEMBER',
  APPROVER: 'APPROVER',
  ORG_ADMIN: 'ORG_ADMIN',
});
/**
 * Display names for the roles, so `ORG_ADMIN` is never shown to a user as-is.
 */
export const ROLE_LABELS = Object.freeze({
  MEMBER: 'Member',
  APPROVER: 'Approver',
  ORG_ADMIN: 'Organization admin',
});
/**
 * Every route the SPA serves, as paths or path builders.
 *
 * One definition per URL, so a link cannot drift from the route table in router.jsx.
 */
export const ROUTES = Object.freeze({
  home: '/',
  login: '/login',
  setup: '/setup',
  catalog: '/',
  asset: (id) => `/assets/${id}`,
  myRequests: '/requests',
  admin: '/admin',
  approvals: '/admin/approvals',
  auditLog: '/admin/audit',
});
/**
 * The ticket that owns each not-yet-implemented screen.
 *
 * Mirrors the `details.ticket` the backend's 501 responses carry, so a placeholder screen can name
 * the same ticket the API does, and the two stay recognisably about the same piece of work.
 *
 * The audit log is absent because it is no longer a placeholder: SCRUM-46 shipped the endpoint and
 * SCRUM-51 the screen. An entry removed from here is the signal that a feature actually landed.
 */
export const TICKETS = Object.freeze({
  catalog: 'SCRUM-assets-list',
  assetDetail: 'SCRUM-assets-read',
  myRequests: 'SCRUM-requests-list',
  approvalQueue: 'SCRUM-requests-approve',
});
/**
 * The audit actions the API will accept as a filter, mirroring the backend's `AUDIT_ACTION_LIST`.
 *
 * These drive the filter dropdown, and the route's Zod schema rejects anything outside the set with a
 * 400 — so a value that drifts from the backend's list becomes a failed request rather than an empty
 * table. Kept in the same order as the backend for reviewability.
 */
export const AUDIT_ACTIONS = Object.freeze([
  'REQUEST_SUBMITTED',
  'REQUEST_APPROVED',
  'REQUEST_DENIED',
  'REQUEST_CANCELLED',
  'ASSET_CHECKED_OUT',
  'ASSET_RETURNED',
  'ASSET_CREATED',
  'ASSET_UPDATED',
  'ASSET_RETIRED',
  'USER_ROLE_CHANGED',
  'USER_INVITED',
  'ORG_CREATED',
]);
/**
 * The target types an audit event can point at, mirroring the backend's `AUDIT_TARGET_TYPE_LIST`.
 */
export const AUDIT_TARGET_TYPES = Object.freeze([
  'Organization',
  'User',
  'Asset',
  'AssetUnit',
  'CheckoutRequest',
]);
/**
 * Rows per page on the audit log.
 *
 * Below the API's `limit` ceiling of 100 (see the backend's `pagination` schema), and small enough
 * that a page is scannable without scrolling on a laptop.
 */
export const AUDIT_PAGE_SIZE = 25;

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
  members: '/admin/members',
  auditLog: '/admin/audit',
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
 * Every checkout-request state, mirroring the backend's `REQUEST_STATE_LIST`.
 *
 * Drives the approval queue's state filter, in the same order as the backend for reviewability.
 */
export const REQUEST_STATES = Object.freeze([
  'PENDING',
  'APPROVED',
  'DENIED',
  'CANCELLED',
  'CHECKED_OUT',
  'OVERDUE',
  'RETURNED',
  'LOST',
]);
/**
 * Rows per page on the audit log.
 *
 * Below the API's `limit` ceiling of 100 (see the backend's `pagination` schema), and small enough
 * that a page is scannable without scrolling on a laptop.
 */
export const AUDIT_PAGE_SIZE = 25;
/**
 * Rows per page on the members list.
 *
 * Within the API's `limit` ceiling of 100. Organisations are small, so most will only ever see one page.
 */
export const MEMBERS_PAGE_SIZE = 25;

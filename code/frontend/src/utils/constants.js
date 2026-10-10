// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: roles, route paths and the Sprint 1 ticket ids that own each placeholder page
// Human Contributions: reviewed and approved by Amber Rastella (PR #7, 2026-09-18); latest changes reviewed and approved by Alex Picard (PR #61, 2026-10-03); CI passed on merge: lint, format, unit + integration tests, npm audit, Docker build, CodeQL
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Reviewed before merge; see Human Contributions. Header restored for SCRUM-216 (removed by mistake in 59f009f).

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
  // Not a role anyone holds: the label for an audit event no person caused (SCRUM-205: an expired
  // approval), which the API records with no actor id.
  SYSTEM: 'Automatic',
});
/** The roles an admin can invite as or change to, least privileged first. */
export const ROLE_OPTIONS = Object.freeze(Object.values(ROLES));
/**
 * Every route the SPA serves, as paths or path builders.
 *
 * One definition per URL, so a link cannot drift from the route table in router.jsx.
 */
export const ROUTES = Object.freeze({
  // The public landing page. Everything a signed-in user does lives under its own path, so that `/`
  // can stay the page a first-time visitor lands on.
  home: '/',
  login: '/login',
  forgotPassword: '/forgot-password',
  // The API builds the mailed link on this path, so the two must agree (backend APP_BASE_URL).
  resetPassword: '/reset-password',
  changePassword: '/change-password',
  setup: '/setup',
  catalog: '/catalog',
  asset: (id) => `/assets/${id}`,
  assetNew: '/admin/assets/new',
  assetEdit: (id) => `/assets/${id}/edit`,
  myRequests: '/requests',
  request: (id) => `/requests/${id}`,
  admin: '/admin',
  approvals: '/admin/approvals',
  users: '/admin/users',
  // SCRUM-167: user groups, the access tiers restricted equipment points to (SCRUM-150).
  groups: '/admin/groups',
  group: (id) => `/admin/groups/${id}`,
  auditLog: '/admin/audit',
  settings: '/admin/settings',
});

/**
 * Where each role lands after signing in (SCRUM-21).
 *
 * Signing in should end on the screen the role exists for: a member on their own requests, so the
 * first thing they see is the status of what they asked for; an approver on the queue waiting for
 * them; an admin on the dashboard. The catalogue is a click away in the navigation for all of them.
 *
 * This is only the default. A visitor who was sent to the login page from a guarded URL returns to
 * that URL instead, because what they asked for beats what their role usually wants.
 */
export const LANDING_BY_ROLE = Object.freeze({
  [ROLES.MEMBER]: ROUTES.myRequests,
  [ROLES.APPROVER]: ROUTES.approvals,
  [ROLES.ORG_ADMIN]: ROUTES.admin,
});

/**
 * The path to land on for a role, falling back to the catalogue.
 *
 * The fallback matters: a role added on the backend before this map is updated must still land
 * somewhere every signed-in user may see, rather than on `undefined`. It is the catalogue rather than
 * `/`, because `/` is the public landing page — signing in should end inside the application.
 * @param {string|null|undefined} role
 * @returns {string}
 */
export function landingFor(role) {
  return LANDING_BY_ROLE[role] ?? ROUTES.catalog;
}

/**
 * The audit actions the API will accept as a filter, mirroring the backend's `AUDIT_ACTION_LIST`.
 *
 * These drive the filter dropdown, and the route's Zod schema rejects anything outside the set with a
 * 400 — so a value that drifts from the backend's list becomes a failed request rather than an empty
 * table. Kept in the same order as the backend for reviewability. (SCRUM-148 also caught it up with
 * USER_PASSWORD_RESET and the two maintenance actions, which had been added on the backend only.)
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
  'USER_PASSWORD_RESET',
  'ORG_CREATED',
  'UNIT_MAINTENANCE_STARTED',
  'UNIT_MAINTENANCE_ENDED',
  // SCRUM-148: a request approved by the organisation's rule rather than a person, and a change to
  // that rule.
  'REQUEST_AUTO_APPROVED',
  'ORG_SETTINGS_UPDATED',
  // The user-groups actions (SCRUM-149) the backend also accepts.
  'GROUP_CREATED',
  'GROUP_UPDATED',
  'GROUP_DELETED',
  'GROUP_MEMBER_ADDED',
  'GROUP_MEMBER_REMOVED',
  // SCRUM-205: custody confirmation.
  'REQUEST_EXPIRED',
  'RETURN_INITIATED',
  'RETURN_REJECTED',
]);

/**
 * Whether a checkout request needs an approver (SCRUM-148), mirroring the backend's `APPROVAL_MODE`.
 *
 * Each entry pairs the API value with the words an admin reads. An organisation chooses between
 * REQUIRED and AUTO; an asset can also INHERIT the organisation's choice, which is every asset's
 * starting point.
 */
export const APPROVAL_MODE = Object.freeze({
  INHERIT: 'INHERIT',
  REQUIRED: 'REQUIRED',
  AUTO: 'AUTO',
});

/** The organisation-wide choices, in the order the settings page offers them. */
export const ORG_APPROVAL_OPTIONS = Object.freeze([
  Object.freeze({
    value: APPROVAL_MODE.REQUIRED,
    label: 'Require an approver',
    hint: 'Every request waits in the approval queue until an approver decides.',
  }),
  Object.freeze({
    value: APPROVAL_MODE.AUTO,
    label: 'Approve automatically',
    hint: 'Requests are approved as soon as they are submitted. The item is still handed over in person.',
  }),
]);

/** The per-asset choices, in the order the asset form offers them. */
export const ASSET_APPROVAL_OPTIONS = Object.freeze([
  Object.freeze({ value: APPROVAL_MODE.INHERIT, label: 'Use the organization default' }),
  Object.freeze({ value: APPROVAL_MODE.REQUIRED, label: 'Always require an approver' }),
  Object.freeze({ value: APPROVAL_MODE.AUTO, label: 'Always approve automatically' }),
]);

/**
 * The label for an asset's approval mode, for read-only display.
 * @param {string|undefined} mode
 * @returns {string}
 */
export function assetApprovalLabel(mode) {
  return (
    ASSET_APPROVAL_OPTIONS.find((option) => option.value === mode) ?? ASSET_APPROVAL_OPTIONS[0]
  ).label;
}
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
  'RETURN_PENDING',
  'RETURNED',
  'LOST',
  'EXPIRED',
]);
/**
 * The conditions a physical unit can be in, mirroring the backend's `ASSET_CONDITION_LIST`.
 *
 * Drives the add-unit form's dropdown. The route's `unitBody` schema rejects anything outside this
 * set with a 400, so a value that drifts from the backend becomes a failed request rather than a
 * silently wrong record. Kept in the backend's order, best first.
 */
export const ASSET_CONDITIONS = Object.freeze(['NEW', 'GOOD', 'FAIR', 'POOR']);
/**
 * The condition a new unit starts in, matching `unitBody`'s default.
 *
 * Named rather than inlined so the form's initial value and the server's default cannot drift apart.
 */
export const DEFAULT_ASSET_CONDITION = 'GOOD';
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

/**
 * Every asset unit condition, mirroring the backend's `returnBody` enum.
 *
 * Drives the return action's condition selector on the approval queue.
 */
export const UNIT_CONDITIONS = Object.freeze(['NEW', 'GOOD', 'FAIR', 'POOR']);

/**
 * The pickup grace period's default and ceiling, in hours, mirroring the backend's
 * `DEFAULT_PICKUP_GRACE_HOURS` / `MAX_PICKUP_GRACE_HOURS` (SCRUM-205).
 */
export const DEFAULT_PICKUP_GRACE_HOURS = 48;
export const MAX_PICKUP_GRACE_HOURS = 720;

/**
 * The physical-unit lifecycle, mirroring the backend's `UNIT_STATUS` (SDD §2.4 AssetUnit.status).
 *
 * `REQUESTED` means a PENDING request already exists for this unit — it is what keeps a second
 * member from requesting the same unit while the first request is undecided. It is read the same
 * way `AVAILABLE` is: the "Request this" button and the retire guard both key off it via `humanize`
 * and a direct equality check, not a bespoke label map.
 */
export const UNIT_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  OUT: 'OUT',
  RETIRED: 'RETIRED',
  REQUESTED: 'REQUESTED',
  // SCRUM-141. Reversible, unlike RETIRED: the unit is being repaired and will come back. Nothing
  // here needs a label for it — `humanize` renders "Maintenance" — and the existing AVAILABLE check
  // on "Request this" already keeps a unit in the shop from being requested.
  MAINTENANCE: 'MAINTENANCE',
});

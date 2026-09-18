// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: roles, route paths and the Sprint 1 ticket ids that own each placeholder page
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

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
 */
export const TICKETS = Object.freeze({
  catalog: 'SCRUM-assets-list',
  assetDetail: 'SCRUM-assets-read',
  myRequests: 'SCRUM-requests-list',
  approvalQueue: 'SCRUM-requests-approve',
  auditLog: 'SCRUM-audit-log',
});

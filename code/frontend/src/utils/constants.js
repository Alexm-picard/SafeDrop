// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: roles, route paths and the Sprint 1 ticket ids that own each placeholder page
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.
export const APP_NAME = 'SafeDrop';
export const ROLES = Object.freeze({
  MEMBER: 'MEMBER',
  APPROVER: 'APPROVER',
  ORG_ADMIN: 'ORG_ADMIN',
});
export const ROLE_LABELS = Object.freeze({
  MEMBER: 'Member',
  APPROVER: 'Approver',
  ORG_ADMIN: 'Organization admin',
});
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
/** Ticket that owns each not-yet-implemented screen; mirrors the backend stubs' `details.ticket`. */
export const TICKETS = Object.freeze({
  catalog: 'SCRUM-assets-list',
  assetDetail: 'SCRUM-assets-read',
  myRequests: 'SCRUM-requests-list',
  approvalQueue: 'SCRUM-requests-approve',
  auditLog: 'SCRUM-audit-log',
});

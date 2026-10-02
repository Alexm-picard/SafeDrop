// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed call for POST /api/organizations (SCRUM-100); approval settings calls (SCRUM-148)
// Human Contributions: reviewed by Amber Rastella (PR #7, 2026-09-18)
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog.

/**
 * Organisation endpoints: creation (the sign-up path) and the caller's own organisation's approval
 * settings (SCRUM-148).
 */
import { apiRequest } from './api';
/**
 * Create an organisation with its first administrator.
 *
 * Public: the caller has no session yet, which is why `retryOn401` is off — a 401 here means the
 * request was rejected, and there is no session to refresh. The response includes the new user and
 * organisation *and* sets the session cookies, so the app can adopt the session through
 * `setSession()` and go straight to the dashboard.
 * @param {{ orgName: string, adminName: string, adminEmail: string, adminPassword: string }} input
 * @returns {Promise<{ organization: object, user: object }>}
 */
export const createOrganization = (input) =>
  apiRequest('/api/organizations', {
    method: 'POST',
    body: input,
    retryOn401: false,
  });

/**
 * Read the caller's organisation's approval default (`GET /api/organizations/me/approval-settings`).
 *
 * ORG_ADMIN only (`org:settings`). "me" because the organisation always comes from the session.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ defaultMode: 'REQUIRED'|'AUTO' }>}
 */
export const getApprovalSettings = (signal) =>
  apiRequest('/api/organizations/me/approval-settings', { signal });

/**
 * Change the approval default (`PATCH /api/organizations/me/approval-settings`).
 *
 * Applies to requests submitted from now on; requests already waiting stay in the queue.
 * @param {{ defaultMode: 'REQUIRED'|'AUTO' }} input
 * @returns {Promise<{ defaultMode: 'REQUIRED'|'AUTO' }>}
 */
export const updateApprovalSettings = (input) =>
  apiRequest('/api/organizations/me/approval-settings', { method: 'PATCH', body: input });

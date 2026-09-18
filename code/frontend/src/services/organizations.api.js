// AI-USAGE SUMMARY
// Tools: Claude Code
// Overall AI Contribution: ~90% (skeleton generated from team design documents)
// AI-Assisted Areas: typed call for POST /api/organizations (SCRUM-101)
// Human Contributions: pending team review
// Notes: Generated from SDD v0.1, SPPP, NFR doc, Sprint 1 backlog. Must be reviewed and tested by the owning team member before merge.

/**
 * Organisation creation endpoint — the sign-up path.
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
